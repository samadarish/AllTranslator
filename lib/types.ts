export type TranslationState =
  | 'idle'
  | 'scanning'
  | 'translating'
  | 'complete'
  | 'restored'
  | 'error';

export type EnglishPagePolicy = 'strong-evidence' | 'strict';
export type ReasoningEffort = '' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface TranslatorSettings {
  enabled: boolean;
  autoTranslate: boolean;
  englishPagePolicy: EnglishPagePolicy;
  writingTranslatorEnabled: boolean;
  imageTranslatorEnabled: boolean;
  apiBaseUrl: string;
  model: string;
  imageModel: string;
  reasoningEffort: ReasoningEffort;
  targetLanguage: 'English';
  concurrency: number;
  useCache: boolean;
  cacheTtlDays: number;
  excludedDomains: string[];
}

export interface TranslatorSecrets {
  apiKey: string;
}

export interface TranslationSegment {
  id: string;
  text: string;
}

export interface TranslationBatchRequest {
  requestId: string;
  generation: number;
  pageTitle: string;
  pageLanguage: string;
  targetLanguage: 'English';
  segments: TranslationSegment[];
}

export interface TranslationBatchError {
  code: string;
  message: string;
  status?: number;
  retryAfterMs?: number;
}

export interface TranslationBatchResponse {
  requestId: string;
  generation: number;
  translations: Record<string, string>;
  failedIds: string[];
  retryableIds: string[];
  error?: TranslationBatchError;
  providerMs: number;
  requestCount: number;
}

export interface TranslationLookupResponse {
  translations: Record<string, string>;
  cachedIds: string[];
  cacheMs: number;
}

export interface TargetLanguage {
  code: string;
  name: string;
}

export interface DraftTranslationRequest {
  requestId: string;
  text: string;
  targetLanguage: TargetLanguage;
}

export interface DraftTranslationResponse {
  requestId: string;
  translation?: string;
  error?: TranslationBatchError;
  providerMs: number;
  requestCount: number;
}

export interface ImageCaptureArea {
  left: number;
  top: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
}

export interface ImageCaptureRequest {
  requestId: string;
  area: ImageCaptureArea;
}

export interface ImageCaptureResponse {
  requestId: string;
  imageDataUrl?: string;
  width?: number;
  height?: number;
  error?: TranslationBatchError;
}

export interface ImageTranslationResult {
  hasText: boolean;
  sourceLanguage?: string;
  translation?: string;
}

export interface ImageTranslationRequest {
  requestId: string;
  imageDataUrl: string;
  targetLanguage: TargetLanguage;
}

export interface ImageTranslationResponse extends ImageTranslationResult {
  requestId: string;
  error?: TranslationBatchError;
  providerMs: number;
  requestCount: number;
}

export type ProviderTranslationRequest =
  | { mode: 'page'; payload: TranslationBatchRequest }
  | { mode: 'writing'; payload: DraftTranslationRequest }
  | { mode: 'image'; payload: ImageTranslationRequest };

export interface PageTranslationStatus {
  state: TranslationState;
  total: number;
  translated: number;
  cached: number;
  failed: number;
  pending: number;
  scanMs: number;
  cacheMs: number;
  firstResultMs: number;
  totalMs: number;
  providerMs: number;
  requestCount: number;
  lastError?: string;
}

export interface ProviderStatus {
  configured: boolean;
  connected: boolean;
  message: string;
  models?: string[];
}

export interface PublicSettingsResponse {
  settings: TranslatorSettings;
  configured: boolean;
}

export type BackgroundRequest =
  | { type: 'GET_PUBLIC_SETTINGS' }
  | { type: 'LIST_MODELS'; draft?: ProviderDraft }
  | { type: 'TEST_CONNECTION'; draft?: ProviderDraft }
  | { type: 'LOOKUP_TRANSLATIONS'; segments: TranslationSegment[] }
  | { type: 'TRANSLATE_BATCH'; payload: TranslationBatchRequest }
  | { type: 'CANCEL_TRANSLATION_BATCH'; requestId: string; generation: number }
  | { type: 'TRANSLATE_DRAFT'; payload: DraftTranslationRequest }
  | { type: 'CANCEL_DRAFT_TRANSLATION'; requestId: string }
  | { type: 'CAPTURE_IMAGE'; payload: ImageCaptureRequest }
  | { type: 'TRANSLATE_IMAGE'; payload: ImageTranslationRequest }
  | { type: 'CANCEL_IMAGE_TRANSLATION'; requestId: string }
  | { type: 'TEST_IMAGE_MODEL'; draft?: ProviderDraft }
  | { type: 'CLEAR_CACHE' };

export type PageRequest =
  | { type: 'TRANSLATE_PAGE' }
  | { type: 'RESTORE_PAGE' }
  | { type: 'GET_PAGE_STATUS' };

export interface ProviderDraft {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
}

export interface ModelsResponse {
  models: string[];
}

export interface TestConnectionResponse {
  ok: boolean;
  message: string;
  models: string[];
  modelsLatencyMs: number;
  translationLatencyMs?: number;
}

export interface TestImageModelResponse {
  ok: boolean;
  message: string;
  latencyMs: number;
}
