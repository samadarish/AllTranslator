import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ProviderError,
  Sub2ApiClient,
  extractChatContent,
  imageDataUrlByteLength,
  parseDraftTranslation,
  parseImageTranslation,
  parseModels,
  parseTranslations,
} from '../lib/api';
import { DEFAULT_REQUEST_TIMEOUT_MS, IMAGE_REQUEST_TIMEOUT_MS } from '../lib/constants';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('provider response parsing', () => {
  it('extracts and sorts model IDs', () => {
    expect(
      parseModels({ data: [{ id: 'gpt-5-mini' }, { id: 'gpt-5-nano' }, { id: 'gpt-5-mini' }] }),
    ).toEqual(['gpt-5-mini', 'gpt-5-nano']);
  });

  it('extracts chat completion content', () => {
    expect(
      extractChatContent({ choices: [{ message: { content: '{"translations":{}}' } }] }),
    ).toBe('{"translations":{}}');
  });

  it('accepts fenced JSON and validates IDs independently', () => {
    const result = parseTranslations(
      '```json\n{"translations":{"s1":"Hello","s2":"World"}}\n```',
      [
        { id: 's1', text: 'Bonjour' },
        { id: 's2', text: 'Monde' },
      ],
    );
    expect(result).toEqual({ s1: 'Hello', s2: 'World' });
  });

  it('preserves valid translations when other IDs are missing', () => {
    expect(
      parseTranslations('{"translations":{"s1":"Hello"}}', [
        { id: 's1', text: 'Bonjour' },
        { id: 's2', text: 'Monde' },
      ]),
    ).toEqual({ s1: 'Hello' });
  });

  it('omits Chinese text copied back as a translation', () => {
    expect(
      parseTranslations('{"translations":{"s1":"大量出售官方账号"}}', [
        { id: 's1', text: '大量出售官方账号' },
      ]),
    ).toEqual({});
  });

  it('parses writing translations without applying English-only validation', () => {
    expect(parseDraftTranslation('{"translation":"வணக்கம்"}')).toBe('வணக்கம்');
  });

  it('parses image translations and the no-readable-text result', () => {
    expect(
      parseImageTranslation(
        '{"has_text":true,"source_language":"French","translation":"Hello"}',
      ),
    ).toEqual({ hasText: true, sourceLanguage: 'French', translation: 'Hello' });
    expect(
      parseImageTranslation(
        '{"has_text":false,"source_language":"Unknown","translation":""}',
      ),
    ).toEqual({ hasText: false, sourceLanguage: 'Unknown' });
  });

  it('validates supported base64 image data URLs', () => {
    expect(imageDataUrlByteLength('data:image/png;base64,YQ==')).toBe(1);
    expect(imageDataUrlByteLength('https://example.com/image.png')).toBeUndefined();
    expect(imageDataUrlByteLength('data:image/svg+xml;base64,YQ==')).toBeUndefined();
  });
});

describe('Sub2API client', () => {
  it('sends a bearer-authenticated chat completion request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"translations":{"s1":"Hello"}}' } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new Sub2ApiClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'secret-test-key',
      model: 'gpt-5-nano',
      reasoningEffort: 'high',
    });
    const result = await client.translate({
      mode: 'page',
      payload: {
        requestId: 'request-1',
        generation: 1,
        pageTitle: 'Example',
        pageLanguage: 'fr',
        targetLanguage: 'English',
        segments: [{ id: 's1', text: 'Bonjour' }],
      },
    });

    expect(result).toEqual({ s1: 'Hello' });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-test-key');
    expect(init.body).toContain('gpt-5-nano');
    expect(JSON.parse(init.body as string)).toMatchObject({ reasoning_effort: 'high' });
  });

  it('surfaces rate-limit retry timing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('slow down', { status: 429, headers: { 'Retry-After': '2' } }),
      ),
    );
    const client = new Sub2ApiClient({
      apiBaseUrl: 'https://api.example.com/v1',
      apiKey: 'key',
      model: 'model',
    });

    await expect(
      client.translate({
        mode: 'page',
        payload: {
          requestId: 'request-1',
          generation: 1,
          pageTitle: '',
          pageLanguage: 'fr',
          targetLanguage: 'English',
          segments: [{ id: 's1', text: 'Bonjour' }],
        },
      }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfterMs: 2_000 });
  });

  it('uses the selected writing target and a writing-specific prompt', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: '{"translation":"வணக்கம்"}' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new Sub2ApiClient({
      apiBaseUrl: 'https://api.example.com/v1',
      apiKey: 'key',
      model: 'model',
    });

    await expect(
      client.translate({
        mode: 'writing',
        payload: {
          requestId: 'draft-1',
          text: 'Hello',
          targetLanguage: { code: 'ta', name: 'Tamil' },
        },
      }),
    ).resolves.toBe('வணக்கம்');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.messages[0]?.content).toContain('writing translation engine');
    expect(JSON.parse(body.messages[1]!.content)).toMatchObject({
      target_language: { code: 'ta', name: 'Tamil' },
      text: 'Hello',
    });
  });

  it('sends image input with high detail and an image-specific prompt', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"has_text":true,"source_language":"Spanish","translation":"Hello"}',
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new Sub2ApiClient({
      apiBaseUrl: 'https://api.example.com/v1',
      apiKey: 'key',
      model: 'gpt-5.6-luna',
    });

    await expect(
      client.translate({
        mode: 'image',
        payload: {
          requestId: 'image-1',
          imageDataUrl: 'data:image/png;base64,YQ==',
          targetLanguage: { code: 'en', name: 'English' },
        },
      }),
    ).resolves.toEqual({
      hasText: true,
      sourceLanguage: 'Spanish',
      translation: 'Hello',
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      model: string;
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(body.model).toBe('gpt-5.6-luna');
    expect(body.messages[0]?.content).toContain('OCR translation engine');
    expect(body.messages[1]?.content).toEqual([
      {
        type: 'text',
        text: JSON.stringify({ target_language: { code: 'en', name: 'English' } }),
      },
      {
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,YQ==', detail: 'high' },
      },
    ]);
  });

  it('allows image OCR 45 seconds while keeping page requests at 12 seconds', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(new DOMException('Aborted', 'AbortError'));
        if (init.signal?.aborted) abort();
        else init.signal?.addEventListener('abort', abort, { once: true });
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new Sub2ApiClient({
      apiBaseUrl: 'https://api.example.com/v1',
      apiKey: 'key',
      model: 'gpt-5.6-luna',
    });
    const imagePending = client.translate({
      mode: 'image',
      payload: {
        requestId: 'slow-image',
        imageDataUrl: 'data:image/png;base64,YQ==',
        targetLanguage: { code: 'en', name: 'English' },
      },
    });
    const imageRejection = expect(imagePending).rejects.toMatchObject({ code: 'TIMEOUT' });
    const imageSignal = (fetchMock.mock.calls[0]?.[1] as RequestInit).signal;

    await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS);
    expect(imageSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(
      IMAGE_REQUEST_TIMEOUT_MS - DEFAULT_REQUEST_TIMEOUT_MS,
    );
    await imageRejection;
    expect(imageSignal?.aborted).toBe(true);

    fetchMock.mockClear();
    const pagePending = client.translate({
      mode: 'page',
      payload: {
        requestId: 'slow-page',
        generation: 1,
        pageTitle: '',
        pageLanguage: 'fr',
        targetLanguage: 'English',
        segments: [{ id: 's1', text: 'Bonjour' }],
      },
    });
    const pageRejection = expect(pagePending).rejects.toMatchObject({ code: 'TIMEOUT' });

    await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS);
    await pageRejection;
  });

  it('honors an external cancellation signal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(init.signal?.reason ?? new DOMException('Aborted', 'AbortError')),
          );
        }),
      ),
    );
    const client = new Sub2ApiClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      model: 'model',
    });
    const controller = new AbortController();
    const pending = client.translate(
      {
        mode: 'page',
        payload: {
          requestId: 'request-1',
          generation: 1,
          pageTitle: '',
          pageLanguage: 'fr',
          targetLanguage: 'English',
          segments: [{ id: 's1', text: 'Bonjour' }],
        },
      },
      controller.signal,
    );

    controller.abort(new Error('The page navigated.'));
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});
