import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyCandidate,
  createVisibleCandidateCollector,
  extractCandidates,
  findVisibleMainContentRoots,
  isCandidateInViewport,
  restoreCandidate,
} from '../lib/extractor';

let sequence = 0;
const nextId = () => `s${sequence++}`;

function domRect(top: number, left: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  };
}

function setRect(element: Element, top: number, left: number, width: number, height: number): void {
  element.getBoundingClientRect = () => domRect(top, left, width, height);
}

function mockTextRects(rectsByText: Record<string, DOMRect[]>): void {
  vi.spyOn(document, 'createRange').mockImplementation(() => {
    let selected: Node | undefined;
    return {
      selectNodeContents: (node: Node) => {
        selected = node;
      },
      getClientRects: () => rectsByText[selected?.textContent ?? ''] ?? [],
    } as unknown as Range;
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  sequence = 0;
  document.documentElement.lang = 'fr';
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

describe('DOM extraction', () => {
  it('translates dropdown labels while preserving values, text, selection, and original attributes', () => {
    document.body.innerHTML = `<form><select name="direction">
      <option value="api">API 中转</option>
      <optgroup label="订阅渠道"><option selected>其他源头</option>
      <option label="卡网" value="cards">Internal text</option><option label="">默认标签</option></optgroup>
    </select></form>`;
    const select = document.querySelector('select')!;
    const originalText = [...select.options].map((option) => option.textContent);
    const originalValues = [...select.options].map((option) => option.value);
    const candidates = extractCandidates(document, 'zh', nextId).filter((candidate) => candidate.target.kind === 'select-label');
    expect(candidates.map((candidate) => candidate.source)).toEqual(['API 中转', '订阅渠道', '其他源头', '卡网', '默认标签']);
    for (const candidate of candidates) expect(applyCandidate(candidate, 'Translated label')).toBe(true);
    expect([...select.options].map((option) => option.getAttribute('label'))).toEqual(Array(4).fill('Translated label'));
    expect([...select.options].map((option) => option.textContent)).toEqual(originalText);
    expect([...select.options].map((option) => option.value)).toEqual(originalValues);
    expect(select.selectedIndex).toBe(1);
    expect(new FormData(document.querySelector('form')!).get('direction')).toBe('其他源头');
    for (const candidate of candidates) expect(restoreCandidate(candidate)).toBe(true);
    expect(select.options[0]!.hasAttribute('label')).toBe(false);
    expect(select.options[1]!.hasAttribute('label')).toBe(false);
    expect(select.options[2]!.getAttribute('label')).toBe('卡网');
    expect(select.options[3]!.getAttribute('label')).toBe('');
    expect(select.querySelector('optgroup')!.getAttribute('label')).toBe('订阅渠道');
  });

  it('uses the visible select for collapsed option visibility in both collectors', async () => {
    document.body.innerHTML = `<select><option>其他源头</option><option hidden>隐藏选项</option></select>
      <select hidden><option>秘密选项</option></select><textarea>不自动更改草稿</textarea>`;
    const select = document.querySelector('select')!;
    setRect(select, 100, 40, 240, 40);
    const candidates = extractCandidates(document, 'zh', nextId, true, { visibleOnly: true, textOnly: true });
    expect(candidates.map((candidate) => candidate.source)).toEqual(['其他源头']);
    expect(isCandidateInViewport(candidates[0]!, document)).toBe(true);
    const collector = createVisibleCandidateCollector(document, 'zh', nextId, true);
    const sources: string[] = [];
    let done = false;
    while (!done) {
      const slice = await collector.nextSlice();
      sources.push(...slice.candidates.map((candidate) => candidate.source));
      done = slice.done;
    }
    expect(sources).toEqual(['其他源头']);
    expect(document.querySelector('textarea')!.value).toBe('不自动更改草稿');
    setRect(select, 2000, 40, 240, 40);
    expect(isCandidateInViewport(candidates[0]!, document)).toBe(false);
  });

  it('rejects stale option translations and preserves website changes on restore', () => {
    document.body.innerHTML = '<select><option>其他源头</option></select>';
    const option = document.querySelector('option')!;
    const [candidate] = extractCandidates(document, 'zh', nextId);
    option.textContent = '网站已更新';
    expect(applyCandidate(candidate!, 'Other source')).toBe(false);
    const [updated] = extractCandidates(document, 'zh', nextId);
    expect(applyCandidate(updated!, 'Updated by site')).toBe(true);
    option.setAttribute('label', 'Website label');
    expect(restoreCandidate(updated!)).toBe(false);
    expect(option.getAttribute('label')).toBe('Website label');
  });

  it('extracts visible text and safe display attributes', () => {
    document.body.innerHTML = `
      <main>
        <p>Bonjour le monde</p>
        <button title="Envoyer le formulaire">Envoyer</button>
        <input value="private value" placeholder="Nom complet" />
        <input type="password" placeholder="Mot de passe" />
        <code>const secret = true;</code>
        <p translate="no">Ne pas traduire</p>
        <img alt="Photo de montagne" />
      </main>
    `;

    const sources = extractCandidates(document, 'fr', nextId).map((candidate) => candidate.source);
    expect(sources).toEqual(
      expect.arrayContaining([
        'Bonjour le monde',
        'Envoyer',
        'Envoyer le formulaire',
        'Nom complet',
        'Photo de montagne',
      ]),
    );
    expect(sources).not.toContain('private value');
    expect(sources).not.toContain('Mot de passe');
    expect(sources).not.toContain('const secret = true;');
    expect(sources).not.toContain('Ne pas traduire');
  });

  it('preserves surrounding whitespace during apply and restore', () => {
    document.body.innerHTML = '<p>  Bonjour  </p>';
    const [candidate] = extractCandidates(document.body, 'fr', nextId);
    expect(candidate).toBeDefined();
    expect(applyCandidate(candidate!, 'Hello')).toBe(true);
    expect(document.querySelector('p')?.textContent).toBe('  Hello  ');
    expect(restoreCandidate(candidate!)).toBe(true);
    expect(document.querySelector('p')?.textContent).toBe('  Bonjour  ');
  });

  it('does not overwrite content changed by the website', () => {
    document.body.innerHTML = '<p>Bonjour</p>';
    const [candidate] = extractCandidates(document.body, 'fr', nextId);
    expect(applyCandidate(candidate!, 'Hello')).toBe(true);
    document.querySelector('p')!.textContent = 'Updated by site';
    expect(restoreCandidate(candidate!)).toBe(false);
    expect(document.querySelector('p')?.textContent).toBe('Updated by site');
  });

  it('skips English text on English pages but keeps non-Latin text', () => {
    document.body.innerHTML = '<p>Hello world</p><p>こんにちは世界</p>';
    const sources = extractCandidates(document.body, 'en', nextId).map(
      (candidate) => candidate.source,
    );
    expect(sources).toEqual(['こんにちは世界']);
  });

  it('finds mixed-language messages but skips Telegram-style editable composers', () => {
    document.documentElement.lang = 'en';
    document.body.innerHTML = `
      <section class="messages-container">
        <div class="message"><span class="text-content">Bonjour tout le monde</span></div>
        <div role="textbox" contenteditable="plaintext-only">Escribe un mensaje</div>
      </section>
    `;

    const sources = extractCandidates(document.body, 'en', nextId, true).map(
      (candidate) => candidate.source,
    );

    expect(sources).toContain('Bonjour tout le monde');
    expect(sources).not.toContain('Escribe un mensaje');
  });

  it('does not let app-wide browser translation markers hide visible messages', () => {
    document.documentElement.lang = 'en';
    document.body.innerHTML = `
      <main translate="no" aria-hidden="true">
        <div class="message"><span class="text-content">大量出售官方账号</span></div>
      </main>
    `;

    const sources = extractCandidates(document.body, 'en', nextId, true).map(
      (candidate) => candidate.source,
    );

    expect(sources).toContain('大量出售官方账号');
  });

  it('prioritizes main content without dropping visible navigation', () => {
    document.documentElement.lang = 'zh';
    document.body.innerHTML = `
      <nav>Account settings</nav>
      <main><article><p>这是需要翻译的主要内容</p></article></main>
    `;
    const main = document.querySelector('main')!;
    const article = document.querySelector('article')!;
    setRect(main, 0, 100, 800, 700);
    setRect(article, 50, 120, 760, 600);
    mockTextRects({
      'Account settings': [domRect(20, 20, 120, 20)],
      这是需要翻译的主要内容: [domRect(100, 150, 300, 24)],
    });

    const sources = extractCandidates(document, 'zh', nextId, true, {
      mainContentOnly: true,
      textOnly: true,
      visibleOnly: true,
    }).map((candidate) => candidate.source);

    expect(findVisibleMainContentRoots(document)).toEqual([main]);
    expect(sources).toEqual(['Account settings', '这是需要翻译的主要内容']);
  });

  it('falls back to the nearest central vertical scroll pane without semantic roots', () => {
    document.body.innerHTML = `
      <div id="shell"><section id="feed"><p>动态消息内容</p></section></div>
    `;
    const shell = document.querySelector('#shell') as HTMLElement;
    const feed = document.querySelector('#feed')!;
    shell.style.overflowY = 'auto';
    setRect(shell, 20, 50, 900, 700);
    setRect(feed, 40, 80, 840, 650);
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(feed);

    expect(findVisibleMainContentRoots(document)).toEqual([shell]);
  });

  it('includes visible controls and form labels but excludes editors and metadata', () => {
    document.body.innerHTML = `
      <main>
        <p>需要翻译的文章正文</p>
        <button title="发送按钮标题">发送按钮</button>
        <form><label>电子邮件地址</label><input placeholder="输入电子邮件" /></form>
        <div role="toolbar">格式化工具</div>
        <div contenteditable="true">可编辑的草稿</div>
        <img alt="山景照片" />
      </main>
    `;
    const main = document.querySelector('main')!;
    setRect(main, 0, 0, 900, 700);
    mockTextRects({
      需要翻译的文章正文: [domRect(80, 100, 260, 24)],
      发送按钮: [domRect(120, 100, 100, 24)],
      电子邮件地址: [domRect(160, 100, 120, 24)],
      格式化工具: [domRect(200, 100, 100, 24)],
      可编辑的草稿: [domRect(240, 100, 120, 24)],
    });

    const sources = extractCandidates(document, 'zh', nextId, true, {
      mainContentOnly: true,
      textOnly: true,
      visibleOnly: true,
    }).map((candidate) => candidate.source);

    expect(sources).toEqual([
      '需要翻译的文章正文',
      '发送按钮',
      '电子邮件地址',
      '格式化工具',
    ]);
    expect(sources).not.toContain('发送按钮标题');
    expect(sources).not.toContain('输入电子邮件');
    expect(sources).not.toContain('山景照片');
  });

  it('uses text range geometry instead of a large visible parent', () => {
    document.body.innerHTML = `
      <main><div id="large"><p>屏幕外的内容</p><p>屏幕内的内容</p></div></main>
    `;
    const main = document.querySelector('main')!;
    const large = document.querySelector('#large')!;
    setRect(main, 0, 0, 900, 2_000);
    setRect(large, 0, 0, 900, 2_000);
    mockTextRects({
      屏幕外的内容: [domRect(1_200, 100, 180, 24)],
      屏幕内的内容: [domRect(120, 100, 180, 24)],
    });

    const candidates = extractCandidates(document, 'zh', nextId, true, {
      mainContentOnly: true,
      textOnly: true,
      visibleOnly: true,
    });

    expect(candidates.map((candidate) => candidate.source)).toEqual(['屏幕内的内容']);
    expect(isCandidateInViewport(candidates[0]!, document)).toBe(true);
  });

  it('falls back to observed-element geometry when text rects are unavailable', () => {
    document.body.innerHTML = '<p>Bonjour le monde</p>';
    const paragraph = document.querySelector('p')!;
    setRect(paragraph, 100, 100, 240, 24);
    const [candidate] = extractCandidates(document.body, 'fr', nextId);

    expect(candidate).toBeDefined();
    expect(isCandidateInViewport(candidate!, document)).toBe(true);
  });

  it('orders candidates by screen position and respects segment and character caps', () => {
    document.body.innerHTML = `
      <main>
        <p>第三段文字</p>
        <p>第一段文字</p>
        <p>第二段文字</p>
      </main>
    `;
    setRect(document.querySelector('main')!, 0, 0, 900, 700);
    mockTextRects({
      第三段文字: [domRect(300, 100, 120, 24)],
      第一段文字: [domRect(100, 100, 120, 24)],
      第二段文字: [domRect(200, 100, 120, 24)],
    });

    const segmentLimited = extractCandidates(document, 'zh', nextId, true, {
      mainContentOnly: true,
      textOnly: true,
      visibleOnly: true,
      maxSegments: 2,
    });
    expect(segmentLimited.map((candidate) => candidate.source)).toEqual([
      '第一段文字',
      '第二段文字',
    ]);

    const characterLimited = extractCandidates(document, 'zh', nextId, true, {
      mainContentOnly: true,
      textOnly: true,
      visibleOnly: true,
      maxCharacters: '第一段文字'.length,
    });
    expect(characterLimited.map((candidate) => candidate.source)).toEqual(['第一段文字']);
  });

  it('excludes hidden, transparent, content-hidden, clipped, and offscreen text', () => {
    document.body.innerHTML = `
      <main>
        <p>可见内容</p>
        <p hidden>隐藏属性内容</p>
        <div style="opacity: 0"><p>透明内容</p></div>
        <div style="content-visibility: hidden"><p>内容不可见</p></div>
        <div id="clip" style="overflow: hidden"><p>裁剪内容</p></div>
        <p>屏幕外内容</p>
      </main>
    `;
    const main = document.querySelector('main')!;
    const clip = document.querySelector('#clip')!;
    setRect(main, 0, 0, 900, 1_500);
    setRect(clip, 0, 0, 500, 100);
    mockTextRects({
      可见内容: [domRect(40, 100, 120, 20)],
      隐藏属性内容: [domRect(70, 100, 120, 20)],
      透明内容: [domRect(100, 100, 120, 20)],
      内容不可见: [domRect(130, 100, 120, 20)],
      裁剪内容: [domRect(120, 100, 120, 20)],
      屏幕外内容: [domRect(1_200, 100, 120, 20)],
    });

    const sources = extractCandidates(document, 'zh', nextId, true, {
      mainContentOnly: true,
      textOnly: true,
      visibleOnly: true,
    }).map((candidate) => candidate.source);

    expect(sources).toEqual(['可见内容']);
  });

  it('includes only placeholders that are actually visible and currently displayed', () => {
    document.body.innerHTML = `
      <main>
        <input id="empty" placeholder="输入姓名" />
        <input id="filled" value="Anwar" placeholder="输入城市" />
        <input id="password" type="password" placeholder="输入密码" />
        <input id="transparent" style="opacity: 0" placeholder="隐藏提示" />
        <input id="offscreen" placeholder="屏幕外提示" />
        <button title="不可见标题" aria-label="不可见标签">确认</button>
        <img alt="不可见图片说明" />
      </main>
    `;
    setRect(document.querySelector('main')!, 0, 0, 900, 1_500);
    setRect(document.querySelector('#empty')!, 80, 100, 220, 32);
    setRect(document.querySelector('#filled')!, 130, 100, 220, 32);
    setRect(document.querySelector('#password')!, 180, 100, 220, 32);
    setRect(document.querySelector('#transparent')!, 230, 100, 220, 32);
    setRect(document.querySelector('#offscreen')!, 1_200, 100, 220, 32);
    mockTextRects({ 确认: [domRect(280, 100, 80, 24)] });

    const sources = extractCandidates(document, 'zh', nextId, true, {
      mainContentOnly: true,
      textOnly: true,
      visibleOnly: true,
    }).map((candidate) => candidate.source);

    expect(sources).toEqual(['输入姓名', '确认']);
    expect(sources).not.toEqual(
      expect.arrayContaining(['输入城市', '输入密码', '隐藏提示', '屏幕外提示']),
    );
    expect(sources).not.toEqual(
      expect.arrayContaining(['不可见标题', '不可见标签', '不可见图片说明']),
    );
  });

  it('progressively scans a large DOM and still reaches a late fixed sidebar', async () => {
    document.body.innerHTML = `
      <main>${Array.from(
        { length: 1_000 },
        (_, index) => `<p data-index="${index}">消息内容 ${index}</p>`,
      ).join('')}</main>
      <aside id="sidebar">侧边栏消息</aside>
    `;
    setRect(document.querySelector('main')!, 0, 0, 900, 100_000);
    setRect(document.querySelector('#sidebar')!, 20, 900, 120, 300);
    vi.spyOn(document, 'createRange').mockImplementation(() => {
      let selected: Node | undefined;
      return {
        selectNodeContents: (node: Node) => {
          selected = node;
        },
        getClientRects: () => {
          if (selected?.textContent === '侧边栏消息') {
            return [domRect(30, 910, 100, 20)];
          }
          const index = Number(selected?.parentElement?.getAttribute('data-index') ?? -1);
          return [domRect(index < 8 ? 10 + index * 24 : 2_000 + index * 24, 100, 200, 20)];
        },
      } as unknown as Range;
    });

    const collector = createVisibleCandidateCollector(document, 'zh', nextId, true, {
      mainContentOnly: true,
      textOnly: true,
      sliceSize: 6,
      nodesPerSlice: 40,
      timeBudgetMs: 100,
    });
    const first = await collector.nextSlice();
    expect(first.done).toBe(false);
    expect(first.candidates.map((candidate) => candidate.source)).toContain('消息内容 0');

    let timerFired = false;
    setTimeout(() => {
      timerFired = true;
    }, 0);
    const second = await collector.nextSlice();
    expect(timerFired).toBe(true);

    const sources = [...first.candidates, ...second.candidates].map(
      (candidate) => candidate.source,
    );
    expect(sources).toContain('侧边栏消息');
    expect(sources.filter((source) => source === '消息内容 0')).toHaveLength(1);
  });

  it('emits a four-item priority slice followed by a dense continuation slice', async () => {
    document.body.innerHTML = `<main>${Array.from(
      { length: 45 },
      (_, index) => `<p id="dense-${index}">消息内容 ${index}</p>`,
    ).join('')}</main>`;
    setRect(document.querySelector('main')!, 0, 0, 900, 700);
    for (let index = 0; index < 45; index += 1) {
      setRect(document.querySelector(`#dense-${index}`)!, 5 + index * 15, 20, 600, 14);
    }

    const collector = createVisibleCandidateCollector(document, 'zh', nextId, true, {
      maxSegments: Number.POSITIVE_INFINITY,
      maxCharacters: Number.POSITIVE_INFINITY,
      sliceSize: 30,
      nodesPerSlice: 250,
      timeBudgetMs: 8,
    });
    const first = await collector.nextSlice();
    const second = await collector.nextSlice();

    expect(first.candidates).toHaveLength(4);
    expect(second.candidates).toHaveLength(30);
  });

  it('traverses visible text inside open shadow roots', async () => {
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.querySelector('#host')!;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<main><p>影子根内容</p></main>';
    setRect(host, 0, 0, 900, 700);
    setRect(shadow.querySelector('main')!, 0, 0, 900, 700);
    mockTextRects({ 影子根内容: [domRect(100, 100, 160, 24)] });

    const collector = createVisibleCandidateCollector(document, 'zh', nextId, true, {
      nodesPerSlice: 50,
      timeBudgetMs: 100,
    });
    const sources: string[] = [];
    let result;
    do {
      result = await collector.nextSlice();
      sources.push(...result.candidates.map((candidate) => candidate.source));
    } while (!result.done);

    expect(sources).toContain('影子根内容');
  });
});
