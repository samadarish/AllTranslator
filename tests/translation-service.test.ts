import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCache,
  invalidateTranslationContext,
  lookupTranslations,
  testConnection,
  translateBatch,
  translateDraft,
  translateImage,
} from '../lib/translation-service';

const { getStorage, setStorage } = vi.hoisted(() => ({
  getStorage: vi.fn(async (key: string): Promise<Record<string, unknown>> => {
    if (key === 'fastAiTranslator.settings') {
      return {
        [key]: {
          apiBaseUrl: 'https://api.example.com/v1',
          model: 'fast-model',
          useCache: true,
        },
      };
    }
    return { [key]: { apiKey: 'test-key' } };
  }),
  setStorage: vi.fn(async () => undefined),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    storage: { local: { get: getStorage, set: setStorage } },
  },
}));

function batch(segments = [{ id: 's1', text: 'Bonjour' }]) {
  return {
    requestId: 'request-1',
    generation: 4,
    pageTitle: 'Example',
    pageLanguage: 'fr',
    targetLanguage: 'English' as const,
    segments,
  };
}

function imageRequest(requestId = 'image-1') {
  return {
    requestId,
    imageDataUrl: 'data:image/png;base64,YQ==',
    targetLanguage: { code: 'en', name: 'English' },
  };
}

describe('translation service scheduling contract', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    getStorage.mockClear();
    setStorage.mockClear();
    invalidateTranslationContext();
    await clearCache();
  });

  it('returns valid IDs immediately and marks only missing IDs retryable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"translations":{"s1":"Hello"}}' } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    const response = await translateBatch(
      batch([
        { id: 's1', text: 'Bonjour' },
        { id: 's2', text: 'Monde' },
      ]),
    );

    expect(response).toMatchObject({
      requestId: 'request-1',
      generation: 4,
      translations: { s1: 'Hello' },
      failedIds: ['s2'],
      retryableIds: ['s2'],
      error: { code: 'PARTIAL_RESPONSE' },
      requestCount: 1,
    });
  });

  it('returns rate limits as structured errors without retrying internally', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('slow down', { status: 429, headers: { 'Retry-After': '1' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await translateBatch(batch());

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(response).toMatchObject({
      translations: {},
      failedIds: ['s1'],
      retryableIds: ['s1'],
      error: { code: 'RATE_LIMITED', status: 429, retryAfterMs: 1_000 },
      requestCount: 1,
    });
  });

  it('looks up a whole visible set without calling the provider', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"translations":{"s1":"Hello"}}' } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    await translateBatch(batch());
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();

    const result = await lookupTranslations([
      { id: 'cached-copy', text: 'Bonjour' },
      { id: 'miss', text: 'Au revoir' },
    ]);

    expect(result.translations).toEqual({ 'cached-copy': 'Hello' });
    expect(result.cachedIds).toEqual(['cached-copy']);
    expect(result.cacheMs).toBeGreaterThanOrEqual(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports model-list and translation latency separately', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [{ id: 'fast-model' }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: '{"translations":{"probe":"Hello, world"}}' } }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        ),
    );

    const result = await testConnection();

    expect(result).toMatchObject({ ok: true, models: ['fast-model'] });
    expect(result.modelsLatencyMs).toBeGreaterThanOrEqual(0);
    expect(result.translationLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it('reuses provider settings until storage invalidates the context', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"translations":{"s1":"Hello"}}' } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    await translateBatch(batch());
    await translateBatch({ ...batch(), requestId: 'request-2' });
    expect(getStorage).toHaveBeenCalledTimes(2);

    invalidateTranslationContext();
    await translateBatch({ ...batch(), requestId: 'request-3' });
    expect(getStorage).toHaveBeenCalledTimes(4);
  });

  it('keeps target-specific draft translations in memory only', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: '{"translation":"வணக்கம்"}' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const request = {
      requestId: 'draft-1',
      text: 'Private draft text',
      targetLanguage: { code: 'ta', name: 'Tamil' },
    };

    await expect(translateDraft(request)).resolves.toMatchObject({
      requestId: 'draft-1',
      translation: 'வணக்கம்',
      requestCount: 1,
    });
    await expect(translateDraft({ ...request, requestId: 'draft-2' })).resolves.toMatchObject({
      requestId: 'draft-2',
      translation: 'வணக்கம்',
      requestCount: 0,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.stringify(setStorage.mock.calls)).not.toContain('Private draft text');
  });

  it('rejects oversized drafts before provider dispatch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      translateDraft({
        requestId: 'too-long',
        text: 'x'.repeat(8_001),
        targetLanguage: { code: 'en', name: 'English' },
      }),
    ).resolves.toMatchObject({
      error: { code: 'DRAFT_TOO_LONG' },
      requestCount: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the dedicated image model and caches image results only in memory', async () => {
    getStorage.mockImplementation(async (key: string) => {
      if (key === 'fastAiTranslator.settings') {
        return {
          [key]: {
            apiBaseUrl: 'https://api.example.com/v1',
            model: 'text-model',
            imageModel: 'gpt-5.6-luna',
            _schemaVersion: 4,
          },
        };
      }
      return { [key]: { apiKey: 'test-key' } };
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"has_text":true,"source_language":"Spanish","translation":"Private image text"}',
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(translateImage(imageRequest())).resolves.toMatchObject({
      requestId: 'image-1',
      hasText: true,
      sourceLanguage: 'Spanish',
      translation: 'Private image text',
      requestCount: 1,
    });
    await expect(translateImage(imageRequest('image-2'))).resolves.toMatchObject({
      requestId: 'image-2',
      translation: 'Private image text',
      requestCount: 0,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { model: string };
    expect(body.model).toBe('gpt-5.6-luna');
    expect(JSON.stringify(setStorage.mock.calls)).not.toContain('data:image');
    expect(JSON.stringify(setStorage.mock.calls)).not.toContain('Private image text');
  });

  it('rejects invalid images before reading provider settings or dispatching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      translateImage({ ...imageRequest(), imageDataUrl: 'https://example.com/image.png' }),
    ).resolves.toMatchObject({
      hasText: false,
      error: { code: 'INVALID_IMAGE' },
      requestCount: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getStorage).not.toHaveBeenCalled();
  });

  it('returns image rate limits with the provider cooldown', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('slow down', { status: 429, headers: { 'Retry-After': '2' } }),
      ),
    );

    await expect(translateImage(imageRequest())).resolves.toMatchObject({
      hasText: false,
      error: { code: 'RATE_LIMITED', status: 429, retryAfterMs: 2_000 },
      requestCount: 1,
    });
  });

  it('propagates image request cancellation as a structured error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        const signal = init?.signal;
        return new Promise<Response>((_resolve, reject) => {
          const abort = () => reject(new DOMException('Aborted', 'AbortError'));
          if (signal?.aborted) abort();
          else signal?.addEventListener('abort', abort, { once: true });
        });
      }),
    );
    const controller = new AbortController();
    const result = translateImage(imageRequest(), controller.signal);
    controller.abort();

    await expect(result).resolves.toMatchObject({
      hasText: false,
      error: { code: 'CANCELLED' },
      requestCount: 1,
    });
  });
});
