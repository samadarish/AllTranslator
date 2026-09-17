import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageTranslator } from '../lib/page-translator';
import { DEFAULT_SETTINGS } from '../lib/settings';
import type { TranslationBatchRequest, TranslationBatchResponse } from '../lib/types';

const { detectLanguage, sendMessage } = vi.hoisted(() => ({
  detectLanguage: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    i18n: { detectLanguage },
    runtime: { sendMessage },
  },
}));

class MockIntersectionObserver {
  static latest?: MockIntersectionObserver;

  private readonly observed = new Set<Element>();

  constructor(private readonly callback: IntersectionObserverCallback) {
    MockIntersectionObserver.latest = this;
  }

  observe(element: Element) {
    this.observed.add(element);
  }

  unobserve(element: Element) {
    this.observed.delete(element);
  }

  disconnect() {
    this.observed.clear();
  }

  emit(element: Element, isIntersecting: boolean) {
    expect(this.observed.has(element)).toBe(true);
    this.callback(
      [
        {
          target: element,
          isIntersecting,
          intersectionRatio: isIntersecting ? 1 : 0,
        } as IntersectionObserverEntry,
      ],
      this as unknown as IntersectionObserver,
    );
  }
}

class MockHighlight extends Set<AbstractRange> {
  priority = 0;
  type: HighlightType = 'highlight';
}

interface RuntimeRequest {
  type: string;
  segments?: Array<{ id: string; text: string }>;
  payload?: TranslationBatchRequest;
  requestId?: string;
  generation?: number;
}

const settings = {
  ...DEFAULT_SETTINGS,
  apiBaseUrl: 'http://127.0.0.1:8080/v1',
  model: 'fast-model',
};

function setRect(
  element: Element,
  top: number,
  left = 40,
  width = 600,
  height = 36,
): void {
  element.getBoundingClientRect = () =>
    ({
      x: left,
      y: top,
      width,
      height,
      top,
      right: left + width,
      bottom: top + height,
      left,
      toJSON: () => ({}),
    }) as DOMRect;
}

function providerRequests(): RuntimeRequest[] {
  return sendMessage.mock.calls
    .map(([request]) => request as RuntimeRequest)
    .filter((request) => request.type === 'TRANSLATE_BATCH');
}

function requestsOfType(type: string): RuntimeRequest[] {
  return sendMessage.mock.calls
    .map(([request]) => request as RuntimeRequest)
    .filter((request) => request.type === type);
}

function successResponse(
  request: TranslationBatchRequest,
  translation: (text: string) => string,
): TranslationBatchResponse {
  return {
    requestId: request.requestId,
    generation: request.generation,
    translations: Object.fromEntries(
      request.segments.map((segment) => [segment.id, translation(segment.text)]),
    ),
    failedIds: [],
    retryableIds: [],
    providerMs: 25,
    requestCount: 1,
  };
}

function mockEmptyCacheAndProvider(translation: (text: string) => string): void {
  sendMessage.mockImplementation(async (request: RuntimeRequest) => {
    if (request.type === 'LOOKUP_TRANSLATIONS') {
      return { translations: {}, cachedIds: [], cacheMs: 1 };
    }
    if (request.type === 'TRANSLATE_BATCH' && request.payload) {
      return successResponse(request.payload, translation);
    }
    if (request.type === 'CANCEL_TRANSLATION_BATCH') return { cancelled: true };
    throw new Error(`Unexpected request: ${request.type}`);
  });
}

describe('viewport translation', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'IntersectionObserver',
      MockIntersectionObserver as unknown as typeof IntersectionObserver,
    );
    MockIntersectionObserver.latest = undefined;
    detectLanguage.mockReset();
    sendMessage.mockReset();
    document.documentElement.lang = 'en';
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('translates dynamic dropdown labels without changing values or repeatedly translating its own updates', async () => {
    document.body.innerHTML = '<form><select name="direction"><option selected>其他源头</option></select></form>';
    const select = document.querySelector('select')!;
    const option = select.options[0]!;
    select.selectedIndex = 0;
    setRect(select, 100);
    const labels: Record<string, string> = {
      '其他源头': 'Other source', '卡网': 'Card network', '订阅渠道': 'Subscription channel', '网站更新': 'Site update',
    };
    mockEmptyCacheAndProvider((text) => labels[text] ?? 'Translated');
    const translator = new PageTranslator(settings, document);
    try {
      await translator.start();
      await vi.waitFor(() => expect(option.getAttribute('label')).toBe('Other source'));
      expect(option.textContent).toBe('其他源头');
      expect(new FormData(document.querySelector('form')!).get('direction')).toBe('其他源头');

      const dynamicOption = document.createElement('option');
      dynamicOption.textContent = '卡网';
      dynamicOption.value = 'cards';
      select.append(dynamicOption);
      await vi.waitFor(() => expect(dynamicOption.getAttribute('label')).toBe('Card network'));
      expect(dynamicOption.value).toBe('cards');

      option.textContent = '订阅渠道';
      await vi.waitFor(() => expect(option.getAttribute('label')).toBe('Subscription channel'));
      option.setAttribute('label', '网站更新');
      await vi.waitFor(() => expect(option.getAttribute('label')).toBe('Site update'));
      expect(select.selectedIndex).toBe(0);
      expect(providerRequests().flatMap((request) => request.payload!.segments.map((segment) => segment.text)))
        .toEqual(['其他源头', '卡网', '订阅渠道', '网站更新']);

      dynamicOption.remove();
      await vi.waitFor(() => expect(dynamicOption.hasAttribute('label')).toBe(false));
      select.append(dynamicOption);
      await vi.waitFor(() => expect(dynamicOption.getAttribute('label')).toBe('Card network'));
      translator.restore();
      expect(option.getAttribute('label')).toBe('网站更新');
      expect(dynamicOption.hasAttribute('label')).toBe(false);
    } finally {
      translator.restore();
    }
  });

  it('translates only foreign content currently on screen', async () => {
    document.body.innerHTML = `
      <header><button>Open settings</button></header>
      <main id="content">
        <p id="french">Bonjour tout le monde</p>
        <p id="english">Account settings</p>
        <p id="spanish">Hola a todos</p>
      </main>
    `;
    const main = document.querySelector('#content')!;
    const french = document.querySelector('#french')!;
    const english = document.querySelector('#english')!;
    const spanish = document.querySelector('#spanish')!;
    setRect(main, 0, 20, 800, 700);
    setRect(french, 100);
    setRect(english, 150);
    setRect(spanish, 900);

    detectLanguage.mockImplementation(async (text: string) => ({
      isReliable: true,
      languages: [
        {
          language: text.startsWith('Bonjour') ? 'fr' : text.startsWith('Hola') ? 'es' : 'en',
          percentage: 99,
        },
      ],
    }));
    mockEmptyCacheAndProvider((text) =>
      text.startsWith('Bonjour') ? 'Hello everyone' : 'Hello all',
    );

    const translator = new PageTranslator(settings, document);
    await translator.start();

    await vi.waitFor(() => expect(french).toHaveTextContent('Hello everyone'));
    expect(english).toHaveTextContent('Account settings');
    expect(spanish).toHaveTextContent('Hola a todos');
    expect(providerRequests()).toHaveLength(1);
    expect(providerRequests()[0]?.payload?.segments).toEqual([
      expect.objectContaining({ text: 'Bonjour tout le monde' }),
    ]);

    setRect(french, -100);
    setRect(spanish, 100);
    document.dispatchEvent(new Event('scroll'));

    await vi.waitFor(() => expect(spanish).toHaveTextContent('Hello all'));
    expect(providerRequests()).toHaveLength(2);
    translator.restore();
  });

  it('does not send name-like English page text when detection mislabels it', async () => {
    const labels = [
      'AI SYSTEM',
      'Anthropic',
      'Claude Opus 5 (High)',
      'Thinking Machines',
      'GPT-5.6 Sol (Low)',
    ];
    document.body.innerHTML = `<main>${labels
      .map((label, index) => `<p id="label-${index}">${label}</p>`)
      .join('')}</main>`;
    setRect(document.querySelector('main')!, 0, 20, 800, 700);
    labels.forEach((_label, index) =>
      setRect(document.querySelector(`#label-${index}`)!, 40 + index * 50),
    );
    detectLanguage.mockResolvedValue({
      isReliable: true,
      languages: [{ language: 'fr', percentage: 99 }],
    });

    const translator = new PageTranslator(settings, document);
    await translator.start();
    await vi.waitFor(() => expect(translator.getStatus().state).toBe('complete'));

    expect(sendMessage).not.toHaveBeenCalled();
    for (const [index, label] of labels.entries()) {
      expect(document.querySelector(`#label-${index}`)).toHaveTextContent(label);
    }
    translator.restore();
  });

  it('strict English mode skips Latin text but still translates non-Latin text', async () => {
    document.body.innerHTML = `
      <main>
        <p id="french">Bonjour tout le monde</p>
        <p id="chinese">大量出售官方账号</p>
      </main>
    `;
    setRect(document.querySelector('main')!, 0, 20, 800, 700);
    setRect(document.querySelector('#french')!, 100);
    setRect(document.querySelector('#chinese')!, 150);
    mockEmptyCacheAndProvider(() => 'Official accounts for sale');

    const translator = new PageTranslator(
      { ...settings, englishPagePolicy: 'strict' },
      document,
    );
    await translator.start();

    await vi.waitFor(() =>
      expect(document.querySelector('#chinese')).toHaveTextContent('Official accounts for sale'),
    );
    expect(document.querySelector('#french')).toHaveTextContent('Bonjour tout le monde');
    expect(providerRequests()).toHaveLength(1);
    expect(providerRequests()[0]?.payload?.segments.map(({ text }) => text)).toEqual([
      '大量出售官方账号',
    ]);
    expect(detectLanguage).not.toHaveBeenCalled();
    translator.restore();
  });

  it('translates visible sidebar, navigation, button, header, and footer text', async () => {
    document.body.innerHTML = `
      <header><button id="tools">设置工具</button></header>
      <aside>
        <nav>
          <a id="category">技术交流</a>
          <a id="market">账号交易</a>
          <a id="new">新</a>
        </nav>
      </aside>
      <main><p id="english-main">Account settings</p></main>
      <footer id="help">帮助中心</footer>
    `;
    const positions: Array<[string, number, number]> = [
      ['tools', 20, 720],
      ['category', 90, 20],
      ['market', 130, 20],
      ['new', 170, 20],
      ['english-main', 90, 260],
      ['help', 700, 20],
    ];
    for (const [id, top, left] of positions) setRect(document.querySelector(`#${id}`)!, top, left);
    setRect(document.querySelector('main')!, 60, 240, 700, 600);
    setRect(document.querySelector('aside')!, 60, 0, 220, 600);
    detectLanguage.mockResolvedValue({
      isReliable: true,
      languages: [{ language: 'en', percentage: 99 }],
    });
    const translations: Record<string, string> = {
      设置工具: 'Settings tools',
      技术交流: 'Technical discussion',
      账号交易: 'Account marketplace',
      新: 'New',
      帮助中心: 'Help center',
    };
    mockEmptyCacheAndProvider((text) => translations[text] ?? text);

    const translator = new PageTranslator(settings, document);
    await translator.start();

    await vi.waitFor(() => expect(document.querySelector('#help')).toHaveTextContent('Help center'));
    expect(document.querySelector('#tools')).toHaveTextContent('Settings tools');
    expect(document.querySelector('#category')).toHaveTextContent('Technical discussion');
    expect(document.querySelector('#market')).toHaveTextContent('Account marketplace');
    expect(document.querySelector('#new')).toHaveTextContent('New');
    expect(document.querySelector('#english-main')).toHaveTextContent('Account settings');
    expect(
      providerRequests().flatMap((request) => request.payload?.segments.map(({ text }) => text) ?? []),
    ).not.toContain('Account settings');
    translator.restore();
  });

  it('starts obvious non-Latin translation before pending Latin detection finishes', async () => {
    document.body.innerHTML = `
      <main><p id="english-main">Account settings</p></main>
      <aside><a id="category">技术交流</a></aside>
    `;
    setRect(document.querySelector('main')!, 0, 240, 700, 700);
    setRect(document.querySelector('#english-main')!, 100, 260);
    setRect(document.querySelector('aside')!, 0, 0, 220, 700);
    setRect(document.querySelector('#category')!, 100, 20);
    let resolveDetection: ((value: unknown) => void) | undefined;
    detectLanguage.mockReturnValue(
      new Promise((resolve) => {
        resolveDetection = resolve;
      }),
    );
    mockEmptyCacheAndProvider(() => 'Technical discussion');

    const translator = new PageTranslator(settings, document);
    await translator.start();

    await vi.waitFor(() => expect(document.querySelector('#category')).toHaveTextContent('Technical discussion'));
    expect(providerRequests()[0]?.payload?.segments.map(({ text }) => text)).toContain('技术交流');
    resolveDetection?.({
      isReliable: true,
      languages: [{ language: 'en', percentage: 99 }],
    });
    translator.restore();
  });

  it('does not bypass language filtering during manual translation', async () => {
    document.body.innerHTML = `
      <main id="content">
        <p id="message">大量出售官方账号</p>
        <p id="english">Open settings</p>
      </main>
    `;
    const main = document.querySelector('#content')!;
    const message = document.querySelector('#message')!;
    const english = document.querySelector('#english')!;
    setRect(main, 0, 20, 800, 700);
    setRect(message, 900);
    setRect(english, 950);
    detectLanguage.mockResolvedValue({
      isReliable: true,
      languages: [{ language: 'en', percentage: 99 }],
    });
    mockEmptyCacheAndProvider(() => 'Official accounts for sale');

    const translator = new PageTranslator(settings, document);
    await translator.start();
    expect(providerRequests()).toHaveLength(0);

    setRect(message, 100);
    setRect(english, 150);
    await translator.start(true);

    await vi.waitFor(() => expect(message).toHaveTextContent('Official accounts for sale'));
    expect(english).toHaveTextContent('Open settings');
    expect(providerRequests()).toHaveLength(1);
    expect(providerRequests()[0]?.payload?.segments.map(({ text }) => text)).toEqual([
      '大量出售官方账号',
    ]);
    translator.restore();
  });

  it('drops language-check work when content leaves the viewport', async () => {
    document.body.innerHTML = `
      <main id="content"><p id="message">Bonjour tout le monde</p></main>
    `;
    const main = document.querySelector('#content')!;
    const message = document.querySelector('#message')!;
    setRect(main, 0, 20, 800, 700);
    setRect(message, 100);
    let resolveDetection: ((value: unknown) => void) | undefined;
    detectLanguage.mockReturnValue(
      new Promise((resolve) => {
        resolveDetection = resolve;
      }),
    );
    mockEmptyCacheAndProvider(() => 'Hello everyone');

    const translator = new PageTranslator(settings, document);
    const startPromise = translator.start();
    setRect(message, 900);
    resolveDetection?.({
      isReliable: true,
      languages: [{ language: 'fr', percentage: 99 }],
    });
    await startPromise;

    expect(requestsOfType('LOOKUP_TRANSLATIONS')).toHaveLength(0);
    expect(providerRequests()).toHaveLength(0);
    expect(message).toHaveTextContent('Bonjour tout le monde');
    translator.restore();
  });

  it('applies all viewport cache hits before making provider requests', async () => {
    document.body.innerHTML = `
      <main id="content"><p id="message">大量出售官方账号</p></main>
    `;
    const main = document.querySelector('#content')!;
    const message = document.querySelector('#message')!;
    setRect(main, 0, 20, 800, 700);
    setRect(message, 100);
    sendMessage.mockImplementation(async (request: RuntimeRequest) => {
      if (request.type !== 'LOOKUP_TRANSLATIONS') {
        throw new Error('The provider should not be called for a cache hit.');
      }
      const id = request.segments?.[0]?.id ?? '';
      return {
        translations: { [id]: 'Official accounts for sale' },
        cachedIds: [id],
        cacheMs: 2,
      };
    });

    const translator = new PageTranslator(settings, document);
    await translator.start();

    expect(message).toHaveTextContent('Official accounts for sale');
    expect(providerRequests()).toHaveLength(0);
    expect(translator.getStatus()).toMatchObject({ cached: 1, translated: 1, requestCount: 0 });
    translator.restore();
  });

  it('keeps confirmed foreign text pending red until green success feedback replaces it', async () => {
    document.body.innerHTML = '<main><p id="message">新消息内容</p></main>';
    const main = document.querySelector('main')!;
    const message = document.querySelector('#message')!;
    setRect(main, 0, 20, 800, 700);
    setRect(message, 100);
    const registry = new Map<string, Highlight>();
    vi.stubGlobal('CSS', { highlights: registry });
    vi.stubGlobal('Highlight', MockHighlight);
    let resolveTranslation: ((response: TranslationBatchResponse) => void) | undefined;
    sendMessage.mockImplementation((request: RuntimeRequest) => {
      if (request.type === 'LOOKUP_TRANSLATIONS') {
        return Promise.resolve({ translations: {}, cachedIds: [], cacheMs: 1 });
      }
      if (request.type === 'TRANSLATE_BATCH') {
        return new Promise<TranslationBatchResponse>((resolve) => {
          resolveTranslation = resolve;
        });
      }
      return Promise.resolve({ cancelled: true });
    });

    const translator = new PageTranslator(settings, document);
    await translator.start();
    await vi.waitFor(() =>
      expect([...registry.keys()].some((key) => key.endsWith('-pending'))).toBe(true),
    );
    await vi.waitFor(() => expect(providerRequests()).toHaveLength(1));
    expect(document.head.querySelector('style[data-fast-ai-translator]')?.textContent).toContain(
      '#ff3b30',
    );

    const payload = providerRequests()[0]!.payload!;
    resolveTranslation?.(successResponse(payload, () => 'New message'));
    await vi.waitFor(() => expect(message).toHaveTextContent('New message'));
    expect([...registry.keys()].some((key) => key.endsWith('-pending'))).toBe(false);
    expect([...registry.keys()].some((key) => /^fast-ai-translator-feedback-\d+$/.test(key))).toBe(
      true,
    );

    translator.restore();
    expect(registry.size).toBe(0);
  });

  it('clears pending feedback immediately when a translated node is removed', async () => {
    document.body.innerHTML = '<main><p id="message">新消息内容</p></main>';
    const main = document.querySelector('main')!;
    const message = document.querySelector('#message')!;
    setRect(main, 0, 20, 800, 700);
    setRect(message, 100);
    const registry = new Map<string, Highlight>();
    vi.stubGlobal('CSS', { highlights: registry });
    vi.stubGlobal('Highlight', MockHighlight);
    sendMessage.mockImplementation((request: RuntimeRequest) => {
      if (request.type === 'LOOKUP_TRANSLATIONS') {
        return Promise.resolve({ translations: {}, cachedIds: [], cacheMs: 1 });
      }
      if (request.type === 'TRANSLATE_BATCH') return new Promise(() => undefined);
      return Promise.resolve({ cancelled: true });
    });

    const translator = new PageTranslator(settings, document);
    await translator.start();
    await vi.waitFor(() => expect(registry.size).toBe(1));
    message.remove();
    await vi.waitFor(() => expect(registry.size).toBe(0));
    translator.restore();
  });

  it('dispatches turbo batches that use parallel request capacity', async () => {
    document.body.innerHTML = `<main id="content">${Array.from(
      { length: 30 },
      (_, index) => `<p id="message-${index}">消息内容 ${index}</p>`,
    ).join('')}</main>`;
    const main = document.querySelector('#content')!;
    setRect(main, 0, 20, 800, 700);
    for (let index = 0; index < 30; index += 1) {
      setRect(document.querySelector(`#message-${index}`)!, 10 + index * 20);
    }

    const resolvers: Array<(response: TranslationBatchResponse) => void> = [];
    sendMessage.mockImplementation((request: RuntimeRequest) => {
      if (request.type === 'LOOKUP_TRANSLATIONS') {
        return Promise.resolve({ translations: {}, cachedIds: [], cacheMs: 1 });
      }
      if (request.type === 'TRANSLATE_BATCH' && request.payload) {
        return new Promise<TranslationBatchResponse>((resolve) => resolvers.push(resolve));
      }
      return Promise.resolve({ cancelled: true });
    });

    const translator = new PageTranslator(settings, document);
    await translator.start();
    await vi.waitFor(() => expect(providerRequests()).toHaveLength(6));
    expect(providerRequests().map((request) => request.payload?.segments.length)).toEqual([
      4,
      6,
      6,
      6,
      6,
      2,
    ]);

    const second = providerRequests()[1]!.payload!;
    resolvers[1]?.(successResponse(second, (text) => `English ${text.split(' ').at(-1)}`));
    await vi.waitFor(() => expect(document.querySelector('#message-4')).toHaveTextContent('English 4'));
    expect(document.querySelector('#message-0')).toHaveTextContent('消息内容 0');

    const first = providerRequests()[0]!.payload!;
    resolvers[0]?.(successResponse(first, (text) => `English ${text.split(' ').at(-1)}`));
    await vi.waitFor(() => expect(document.querySelector('#message-0')).toHaveTextContent('English 0'));
    expect(translator.getStatus()).toMatchObject({ providerMs: 50, requestCount: 2 });
    translator.restore();
  });

  it('uses all twenty-four request slots when enough visible batches exist', async () => {
    document.body.innerHTML = `<main id="content">${Array.from(
      { length: 150 },
      (_, index) => `<p id="slot-${index}">消息内容 ${index}</p>`,
    ).join('')}</main>`;
    const main = document.querySelector('#content')!;
    setRect(main, 0, 0, 900, 760);
    for (let index = 0; index < 150; index += 1) {
      setRect(document.querySelector(`#slot-${index}`)!, 2 + index * 5, 20, 700, 5);
    }
    sendMessage.mockImplementation((request: RuntimeRequest) => {
      if (request.type === 'LOOKUP_TRANSLATIONS') {
        return Promise.resolve({ translations: {}, cachedIds: [], cacheMs: 1 });
      }
      if (request.type === 'TRANSLATE_BATCH') return new Promise(() => undefined);
      return Promise.resolve({ cancelled: true });
    });

    const translator = new PageTranslator({ ...settings, concurrency: 24 }, document);
    await translator.start();
    await vi.waitFor(() => expect(providerRequests()).toHaveLength(24), { timeout: 3_000 });
    expect(providerRequests().every((request) => (request.payload?.segments.length ?? 0) <= 6)).toBe(
      true,
    );
    translator.restore();
  });

  it('continues with another bounded pass when more than thirty items are visible', async () => {
    document.body.innerHTML = `<main id="content">${Array.from(
      { length: 45 },
      (_, index) => `<p id="message-${index}">消息内容 ${index}</p>`,
    ).join('')}</main>`;
    const main = document.querySelector('#content')!;
    setRect(main, 0, 20, 800, 700);
    for (let index = 0; index < 45; index += 1) {
      setRect(document.querySelector(`#message-${index}`)!, 5 + index * 15, 40, 600, 14);
    }
    mockEmptyCacheAndProvider((text) => `English ${text.split(' ').at(-1)}`);

    const translator = new PageTranslator(settings, document);
    await translator.start();

    await vi.waitFor(
      () => expect(document.querySelector('#message-44')).toHaveTextContent('English 44'),
      { timeout: 2_000 },
    );
    expect(providerRequests().map((request) => request.payload?.segments.length)).toEqual([
      4,
      6,
      6,
      6,
      6,
      6,
      6,
      5,
    ]);
    expect(requestsOfType('LOOKUP_TRANSLATIONS').length).toBeGreaterThan(1);
    translator.restore();
  });

  it('cancels an in-flight batch after every segment scrolls offscreen', async () => {
    document.body.innerHTML = `
      <main id="content"><p id="message">大量出售官方账号</p></main>
    `;
    const main = document.querySelector('#content')!;
    const message = document.querySelector('#message')!;
    setRect(main, 0, 20, 800, 700);
    setRect(message, 100);
    const registry = new Map<string, Highlight>();
    vi.stubGlobal('CSS', { highlights: registry });
    vi.stubGlobal('Highlight', MockHighlight);
    let resolveTranslation: ((response: TranslationBatchResponse) => void) | undefined;
    sendMessage.mockImplementation((request: RuntimeRequest) => {
      if (request.type === 'LOOKUP_TRANSLATIONS') {
        return Promise.resolve({ translations: {}, cachedIds: [], cacheMs: 1 });
      }
      if (request.type === 'TRANSLATE_BATCH') {
        return new Promise<TranslationBatchResponse>((resolve) => {
          resolveTranslation = resolve;
        });
      }
      if (request.type === 'CANCEL_TRANSLATION_BATCH') return Promise.resolve({ cancelled: true });
      throw new Error(`Unexpected request: ${request.type}`);
    });

    const translator = new PageTranslator(settings, document);
    await translator.start();
    await vi.waitFor(() => expect(providerRequests()).toHaveLength(1));
    expect(registry.size).toBe(1);
    const payload = providerRequests()[0]!.payload!;

    setRect(message, 900);
    document.dispatchEvent(new Event('scroll'));
    await vi.waitFor(() => expect(requestsOfType('CANCEL_TRANSLATION_BATCH')).toHaveLength(1));
    expect(registry.size).toBe(0);
    resolveTranslation?.(successResponse(payload, () => 'Official accounts for sale'));
    await vi.waitFor(() => expect(translator.getStatus().pending).toBe(0));

    expect(message).toHaveTextContent('大量出售官方账号');
    translator.restore();
  });

  it('translates newly inserted Telegram-style messages', async () => {
    document.body.innerHTML = `
      <main id="content">
        <div class="message"><span id="first-message">第一条消息</span></div>
      </main>
    `;
    const main = document.querySelector('#content')!;
    const firstMessage = document.querySelector('#first-message')!;
    setRect(main, 0, 20, 800, 700);
    setRect(firstMessage, 100);
    mockEmptyCacheAndProvider((text) =>
      text.includes('第一') ? 'First message' : 'New message',
    );

    const translator = new PageTranslator(settings, document);
    await translator.start();
    await vi.waitFor(() => expect(firstMessage).toHaveTextContent('First message'));

    const nextMessage = document.createElement('div');
    nextMessage.className = 'message';
    nextMessage.innerHTML = '<span id="next-message">新消息内容</span>';
    main.append(nextMessage);
    const nextText = document.querySelector('#next-message')!;
    setRect(nextMessage, 150);
    setRect(nextText, 150);

    await vi.waitFor(() => expect(nextText).toHaveTextContent('New message'));
    expect(providerRequests()).toHaveLength(2);
    translator.restore();
  });

  it('reduces scheduling pressure after a provider rate limit', async () => {
    document.body.innerHTML = `<main id="content">${Array.from(
      { length: 30 },
      (_, index) => `<p id="message-${index}">消息内容 ${index}</p>`,
    ).join('')}</main>`;
    const main = document.querySelector('#content')!;
    setRect(main, 0, 20, 800, 700);
    for (let index = 0; index < 30; index += 1) {
      setRect(document.querySelector(`#message-${index}`)!, 10 + index * 20);
    }
    const registry = new Map<string, Highlight>();
    vi.stubGlobal('CSS', { highlights: registry });
    vi.stubGlobal('Highlight', MockHighlight);
    let resolveLargeBatch: ((response: TranslationBatchResponse) => void) | undefined;
    sendMessage.mockImplementation((request: RuntimeRequest) => {
      if (request.type === 'LOOKUP_TRANSLATIONS') {
        return Promise.resolve({ translations: {}, cachedIds: [], cacheMs: 1 });
      }
      if (request.type === 'TRANSLATE_BATCH' && request.payload) {
        if (request.payload.segments.length === 4 && providerRequests().length === 1) {
          return Promise.resolve({
            requestId: request.payload.requestId,
            generation: request.payload.generation,
            translations: {},
            failedIds: request.payload.segments.map(({ id }) => id),
            retryableIds: request.payload.segments.map(({ id }) => id),
            error: { code: 'RATE_LIMITED', message: 'Slow down', retryAfterMs: 0 },
            providerMs: 10,
            requestCount: 1,
          });
        }
        return new Promise<TranslationBatchResponse>((resolve) => {
          resolveLargeBatch = resolve;
        });
      }
      return Promise.resolve({ cancelled: true });
    });

    const translator = new PageTranslator({ ...settings, concurrency: 2 }, document);
    await translator.start();
    await vi.waitFor(() => expect(providerRequests()).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(providerRequests()).toHaveLength(1);
    expect([...registry.keys()].some((key) => key.endsWith('-pending'))).toBe(true);

    await vi.waitFor(() => expect(providerRequests()).toHaveLength(2), { timeout: 1_000 });
    expect(providerRequests()[1]?.payload?.segments.map(({ text }) => text)).toEqual(
      providerRequests()[0]?.payload?.segments.map(({ text }) => text),
    );

    const largeBatch = providerRequests()[1]!.payload!;
    resolveLargeBatch?.(successResponse(largeBatch, (text) => `English ${text.split(' ').at(-1)}`));
    await vi.waitFor(() => expect(providerRequests()).toHaveLength(3), { timeout: 1_500 });
    expect(providerRequests()[2]?.payload?.segments).toHaveLength(6);
    translator.restore();
  });

  it('restores one adaptive slot after each sustained successful streak', () => {
    const translator = new PageTranslator({ ...settings, concurrency: 4 }, document);
    const adaptive = translator as unknown as {
      effectiveConcurrency: number;
      adjustConcurrency: (response: TranslationBatchResponse) => void;
    };
    const base: TranslationBatchResponse = {
      requestId: 'adaptive',
      generation: 1,
      translations: {},
      failedIds: [],
      retryableIds: [],
      providerMs: 1,
      requestCount: 1,
    };

    adaptive.adjustConcurrency({
      ...base,
      error: { code: 'RATE_LIMITED', message: 'Slow down', retryAfterMs: 500 },
    });
    expect(adaptive.effectiveConcurrency).toBe(2);
    for (let index = 0; index < 10; index += 1) adaptive.adjustConcurrency(base);
    expect(adaptive.effectiveConcurrency).toBe(3);
    for (let index = 0; index < 10; index += 1) adaptive.adjustConcurrency(base);
    expect(adaptive.effectiveConcurrency).toBe(4);
  });
});
