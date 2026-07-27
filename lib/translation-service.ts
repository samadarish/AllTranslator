import { imageDataUrlByteLength, ProviderError, Sub2ApiClient } from './api';
import { translationCache } from './cache';
import { IMAGE_CAPTURE_MAX_BYTES, MAX_DRAFT_CHARACTERS } from './constants';
import { draftCacheKey, draftTranslationCache } from './draft-cache';
import { imageCacheKey, imageTranslationCache } from './image-cache';
import { loadSecrets, loadSettings, sanitizeSettings } from './settings';
import type {
  DraftTranslationRequest,
  DraftTranslationResponse,
  ImageTranslationRequest,
  ImageTranslationResponse,
  ProviderDraft,
  TestImageModelResponse,
  TestConnectionResponse,
  TranslationBatchError,
  TranslationBatchRequest,
  TranslationBatchResponse,
  TranslationLookupResponse,
  TranslationSegment,
  TranslatorSettings,
} from './types';
import { validateTargetLanguage } from './writing-languages';

interface ProviderContext {
  draft: ProviderDraft;
  client: Sub2ApiClient;
}

let settingsPromise: Promise<TranslatorSettings> | undefined;
let providerContextPromise: Promise<ProviderContext> | undefined;
let imageProviderContextPromise: Promise<ProviderContext> | undefined;

const IMAGE_MODEL_TEST_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function currentSettings(): Promise<TranslatorSettings> {
  settingsPromise ??= loadSettings();
  return settingsPromise;
}

function currentProviderContext(): Promise<ProviderContext> {
  providerContextPromise ??= Promise.all([currentSettings(), loadSecrets()]).then(
    ([settings, secrets]) => {
      const draft = {
        apiBaseUrl: settings.apiBaseUrl,
        apiKey: secrets.apiKey,
        model: settings.model,
      };
      return { draft, client: new Sub2ApiClient(draft) };
    },
  );
  return providerContextPromise;
}

function currentImageProviderContext(): Promise<ProviderContext> {
  imageProviderContextPromise ??= Promise.all([currentSettings(), loadSecrets()]).then(
    ([settings, secrets]) => {
      const draft = {
        apiBaseUrl: settings.apiBaseUrl,
        apiKey: secrets.apiKey,
        model: settings.imageModel || settings.model,
      };
      return { draft, client: new Sub2ApiClient(draft) };
    },
  );
  return imageProviderContextPromise;
}

async function clientForDraft(draft?: ProviderDraft): Promise<Sub2ApiClient> {
  return draft ? new Sub2ApiClient(draft) : (await currentProviderContext()).client;
}

function isRetryable(error: unknown): boolean {
  return (
    error instanceof ProviderError &&
    (error.code === 'RATE_LIMITED' ||
      error.code === 'TIMEOUT' ||
      error.code === 'NETWORK_ERROR' ||
      error.code === 'INVALID_RESPONSE' ||
      (error.status !== undefined && error.status >= 500))
  );
}

function structuredError(error: unknown): TranslationBatchError {
  if (error instanceof ProviderError) {
    return {
      code: error.code ?? 'PROVIDER_ERROR',
      message: error.message,
      ...(error.status === undefined ? {} : { status: error.status }),
      ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
    };
  }
  return {
    code: 'UNKNOWN_ERROR',
    message: error instanceof Error ? error.message : String(error),
  };
}

function deduplicateSegments(segments: TranslationSegment[]): {
  unique: TranslationSegment[];
  aliases: Map<string, string[]>;
} {
  const byText = new Map<string, TranslationSegment>();
  const aliases = new Map<string, string[]>();
  for (const segment of segments) {
    const key = segment.text.trim().replace(/\s+/g, ' ');
    const existing = byText.get(key);
    if (existing) {
      aliases.set(existing.id, [...(aliases.get(existing.id) ?? []), segment.id]);
    } else {
      byText.set(key, segment);
    }
  }
  return { unique: [...byText.values()], aliases };
}

export function failedTranslationBatch(
  batch: TranslationBatchRequest,
  error: unknown,
  providerMs = 0,
  requestCount = 0,
): TranslationBatchResponse {
  const failedIds = batch.segments.map((segment) => segment.id);
  return {
    requestId: batch.requestId,
    generation: batch.generation,
    translations: {},
    failedIds,
    retryableIds: isRetryable(error) ? failedIds : [],
    error: structuredError(error),
    providerMs,
    requestCount,
  };
}

export async function lookupTranslations(
  segments: TranslationSegment[],
): Promise<TranslationLookupResponse> {
  const startedAt = performance.now();
  const translations = await translationCache.getMany(segments, await currentSettings());
  return {
    translations,
    cachedIds: segments
      .filter((segment) => Boolean(translations[segment.id]))
      .map((segment) => segment.id),
    cacheMs: elapsedMilliseconds(startedAt),
  };
}

export async function translateBatch(
  batch: TranslationBatchRequest,
  signal?: AbortSignal,
): Promise<TranslationBatchResponse> {
  if (batch.segments.length === 0) {
    return {
      requestId: batch.requestId,
      generation: batch.generation,
      translations: {},
      failedIds: [],
      retryableIds: [],
      providerMs: 0,
      requestCount: 0,
    };
  }

  let client: Sub2ApiClient;
  try {
    client = await clientForDraft();
  } catch (error) {
    return failedTranslationBatch(batch, error);
  }

  const { unique, aliases } = deduplicateSegments(batch.segments);
  const providerStartedAt = performance.now();
  let providerTranslations: Record<string, string>;
  try {
    providerTranslations = await client.translate(
      { mode: 'page', payload: { ...batch, segments: unique } },
      signal,
    );
  } catch (error) {
    return failedTranslationBatch(batch, error, elapsedMilliseconds(providerStartedAt), 1);
  }
  const providerMs = elapsedMilliseconds(providerStartedAt);
  const translations = { ...providerTranslations };

  for (const [sourceId, aliasIds] of aliases) {
    const translation = providerTranslations[sourceId];
    if (!translation) continue;
    for (const aliasId of aliasIds) translations[aliasId] = translation;
  }

  const failedIds = batch.segments
    .filter((segment) => !translations[segment.id])
    .map((segment) => segment.id);
  const settings = await currentSettings();
  try {
    await translationCache.putMany(batch.segments, translations, settings);
  } catch {
    // A cache failure must not discard a completed provider response.
  }

  return {
    requestId: batch.requestId,
    generation: batch.generation,
    translations,
    failedIds,
    retryableIds: failedIds,
    ...(failedIds.length === 0
      ? {}
      : {
          error: {
            code: 'PARTIAL_RESPONSE',
            message: `The provider omitted or failed to translate ${failedIds.length} segment(s).`,
          },
        }),
    providerMs,
    requestCount: 1,
  };
}

export function failedDraftTranslation(
  request: DraftTranslationRequest,
  error: unknown,
  providerMs = 0,
  requestCount = 0,
): DraftTranslationResponse {
  return {
    requestId: request.requestId,
    error: structuredError(error),
    providerMs,
    requestCount,
  };
}

export async function translateDraft(
  request: DraftTranslationRequest,
  signal?: AbortSignal,
): Promise<DraftTranslationResponse> {
  if (!request.text.trim()) {
    return failedDraftTranslation(
      request,
      new ProviderError('Enter text to translate.', { code: 'EMPTY_DRAFT' }),
    );
  }
  if (request.text.length > MAX_DRAFT_CHARACTERS) {
    return failedDraftTranslation(
      request,
      new ProviderError(`Drafts are limited to ${MAX_DRAFT_CHARACTERS.toLocaleString()} characters.`, {
        code: 'DRAFT_TOO_LONG',
      }),
    );
  }
  const targetLanguage = validateTargetLanguage(request.targetLanguage);
  if (!targetLanguage) {
    return failedDraftTranslation(
      request,
      new ProviderError('Choose a valid target language.', { code: 'INVALID_TARGET' }),
    );
  }

  let context: ProviderContext;
  try {
    context = await currentProviderContext();
  } catch (error) {
    return failedDraftTranslation(request, error);
  }
  const normalizedRequest = { ...request, targetLanguage };
  const cacheKey = draftCacheKey(
    normalizedRequest,
    `${context.draft.apiBaseUrl}\u0000${context.draft.model}`,
  );
  const cached = draftTranslationCache.get(cacheKey);
  if (cached !== undefined) {
    return {
      requestId: request.requestId,
      translation: cached,
      providerMs: 0,
      requestCount: 0,
    };
  }

  const providerStartedAt = performance.now();
  let translation: string;
  try {
    translation = await context.client.translate(
      { mode: 'writing', payload: normalizedRequest },
      signal,
    );
  } catch (error) {
    return failedDraftTranslation(
      request,
      error,
      elapsedMilliseconds(providerStartedAt),
      1,
    );
  }
  draftTranslationCache.set(cacheKey, translation);
  return {
    requestId: request.requestId,
    translation,
    providerMs: elapsedMilliseconds(providerStartedAt),
    requestCount: 1,
  };
}

export function failedImageTranslation(
  request: ImageTranslationRequest,
  error: unknown,
  providerMs = 0,
  requestCount = 0,
): ImageTranslationResponse {
  return {
    requestId: request.requestId,
    hasText: false,
    error: structuredError(error),
    providerMs,
    requestCount,
  };
}

export async function translateImage(
  request: ImageTranslationRequest,
  signal?: AbortSignal,
): Promise<ImageTranslationResponse> {
  const imageBytes = imageDataUrlByteLength(request.imageDataUrl);
  if (imageBytes === undefined || imageBytes < 1 || imageBytes > IMAGE_CAPTURE_MAX_BYTES) {
    return failedImageTranslation(
      request,
      new ProviderError('The captured image is invalid or too large.', {
        code: 'INVALID_IMAGE',
      }),
    );
  }
  const targetLanguage = validateTargetLanguage(request.targetLanguage);
  if (!targetLanguage) {
    return failedImageTranslation(
      request,
      new ProviderError('Choose a valid target language.', { code: 'INVALID_TARGET' }),
    );
  }

  let context: ProviderContext;
  try {
    context = await currentImageProviderContext();
  } catch (error) {
    return failedImageTranslation(request, error);
  }
  const normalizedRequest = { ...request, targetLanguage };
  const cacheKey = await imageCacheKey(
    normalizedRequest,
    `${context.draft.apiBaseUrl}\u0000${context.draft.model}`,
  );
  const cached = imageTranslationCache.get(cacheKey);
  if (cached) {
    return {
      requestId: request.requestId,
      ...cached,
      providerMs: 0,
      requestCount: 0,
    };
  }

  const providerStartedAt = performance.now();
  try {
    const result = await context.client.translate(
      { mode: 'image', payload: normalizedRequest },
      signal,
    );
    imageTranslationCache.set(cacheKey, result);
    return {
      requestId: request.requestId,
      ...result,
      providerMs: elapsedMilliseconds(providerStartedAt),
      requestCount: 1,
    };
  } catch (error) {
    return failedImageTranslation(
      request,
      error,
      elapsedMilliseconds(providerStartedAt),
      1,
    );
  }
}

export async function listModels(draft?: ProviderDraft): Promise<string[]> {
  return (await clientForDraft(draft)).listModels();
}

export async function testConnection(draft?: ProviderDraft): Promise<TestConnectionResponse> {
  const client = await clientForDraft(draft);
  const resolved = draft ?? (await currentProviderContext()).draft;
  const modelsStartedAt = performance.now();
  const models = await client.listModels();
  const modelsLatencyMs = elapsedMilliseconds(modelsStartedAt);
  if (!resolved.model) {
    return {
      ok: true,
      message: `Connected. ${models.length} models available.`,
      models,
      modelsLatencyMs,
    };
  }

  const translationStartedAt = performance.now();
  const translations = await client.translate({
    mode: 'page',
    payload: {
      requestId: 'connection-test',
      generation: 0,
      pageTitle: 'Connection test',
      pageLanguage: 'zh',
      targetLanguage: 'English',
      segments: [{ id: 'probe', text: '你好，世界' }],
    },
  });
  const translationLatencyMs = elapsedMilliseconds(translationStartedAt);
  if (!translations.probe) throw new ProviderError('The test translation was empty.');
  return {
    ok: true,
    message: 'Connection and translation succeeded.',
    models,
    modelsLatencyMs,
    translationLatencyMs,
  };
}

export async function testImageModel(draft?: ProviderDraft): Promise<TestImageModelResponse> {
  const client = draft ? new Sub2ApiClient(draft) : (await currentImageProviderContext()).client;
  const startedAt = performance.now();
  await client.translate({
    mode: 'image',
    payload: {
      requestId: 'image-model-test',
      imageDataUrl: IMAGE_MODEL_TEST_DATA_URL,
      targetLanguage: { code: 'en', name: 'English' },
    },
  });
  return {
    ok: true,
    message: 'Image input succeeded.',
    latencyMs: elapsedMilliseconds(startedAt),
  };
}

export function invalidateTranslationContext(): void {
  settingsPromise = undefined;
  providerContextPromise = undefined;
  imageProviderContextPromise = undefined;
  draftTranslationCache.clear();
  imageTranslationCache.clear();
}

export async function pruneCache(): Promise<void> {
  await translationCache.prune(await currentSettings());
}

export async function clearCache(): Promise<void> {
  draftTranslationCache.clear();
  imageTranslationCache.clear();
  await translationCache.clear();
}

export function settingsFromDraft(
  draft: ProviderDraft,
  current: TranslatorSettings,
): TranslatorSettings {
  return sanitizeSettings({ ...current, apiBaseUrl: draft.apiBaseUrl, model: draft.model });
}
