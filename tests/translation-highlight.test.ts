import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TRANSLATION_HIGHLIGHT_COLOR,
  TRANSLATION_PENDING_COLOR,
  TranslationHighlightFeedback,
} from '../lib/translation-highlight';
import type { TranslationCandidate, TranslatableAttribute } from '../lib/extractor';

class MockHighlight extends Set<AbstractRange> {
  priority = 0;
  type: HighlightType = 'highlight';
}

function textCandidate(node: Text, translated: string): TranslationCandidate {
  node.nodeValue = `  ${translated}  `;
  return {
    id: 'text-candidate',
    source: 'Bonjour',
    prefix: '  ',
    suffix: '  ',
    target: { kind: 'text', node },
    observedElement: node.parentElement!,
    translated: node.nodeValue,
  };
}

function pendingTextCandidate(node: Text): TranslationCandidate {
  node.nodeValue = '  Bonjour  ';
  return {
    id: 'pending-text',
    source: 'Bonjour',
    prefix: '  ',
    suffix: '  ',
    target: { kind: 'text', node },
    observedElement: node.parentElement!,
  };
}

function attributeCandidate(
  element: Element,
  attribute: TranslatableAttribute,
  translated: string,
  id = 'attribute-candidate',
): TranslationCandidate {
  element.setAttribute(attribute, translated);
  return {
    id,
    source: 'Bonjour',
    prefix: '',
    suffix: '',
    target: { kind: 'attribute', element, attribute },
    observedElement: element,
    translated,
  };
}

describe('translation highlight feedback', () => {
  let registry: Map<string, Highlight>;

  beforeEach(() => {
    vi.useFakeTimers();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    registry = new Map<string, Highlight>();
    vi.stubGlobal('CSS', { highlights: registry });
    vi.stubGlobal('Highlight', MockHighlight);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('highlights only translated text and removes the range after 1200 ms', () => {
    document.body.innerHTML = '<p>Bonjour</p>';
    const node = document.querySelector('p')!.firstChild as Text;
    const candidate = textCandidate(node, 'Hello');
    const feedback = new TranslationHighlightFeedback(document);

    expect(feedback.flash(candidate)).toBe(true);
    const highlight = [...registry.values()][0]!;
    const range = [...highlight][0] as Range;
    expect(range.startContainer).toBe(node);
    expect(range.startOffset).toBe(2);
    expect(range.endOffset).toBe(7);
    expect(document.querySelector('span')).toBeNull();

    const style = document.head.querySelector('style[data-fast-ai-translator]');
    expect(style?.textContent).toContain(TRANSLATION_HIGHLIGHT_COLOR);
    expect(style?.textContent).toContain('::highlight(fast-ai-translator-feedback-');

    vi.advanceTimersByTime(1_199);
    expect(highlight.size).toBe(1);
    vi.advanceTimersByTime(1);
    expect(highlight.size).toBe(0);
    expect(registry.size).toBe(0);
    expect(node.nodeValue).toBe('  Hello  ');
  });

  it('pulses confirmed pending text red until success replaces it with green', () => {
    document.body.innerHTML = '<p>Bonjour</p>';
    const node = document.querySelector('p')!.firstChild as Text;
    const candidate = pendingTextCandidate(node);
    const feedback = new TranslationHighlightFeedback(document);

    expect(feedback.markPending(candidate)).toBe(true);
    expect([...registry.keys()]).toEqual([
      expect.stringMatching(/^fast-ai-translator-feedback-\d+-pending$/),
    ]);
    const style = document.head.querySelector('style[data-fast-ai-translator]');
    expect(style?.textContent).toContain(TRANSLATION_PENDING_COLOR);
    expect(style?.textContent).toContain('@keyframes fast-ai-translator-feedback-');
    vi.advanceTimersByTime(450);
    expect(registry.size).toBe(0);
    vi.advanceTimersByTime(450);
    expect(registry.size).toBe(1);

    node.nodeValue = '  Hello  ';
    candidate.translated = node.nodeValue;
    expect(feedback.flash(candidate)).toBe(true);
    expect([...registry.keys()]).toEqual([
      expect.stringMatching(/^fast-ai-translator-feedback-\d+$/),
    ]);
    expect(style?.textContent).toContain(TRANSLATION_HIGHLIGHT_COLOR);
  });

  it('restores pending attribute markers exactly on failure cleanup', () => {
    document.body.innerHTML = '<input placeholder="Bonjour" data-fast-ai-translator-pending="site">';
    const input = document.querySelector('input')!;
    const candidate: TranslationCandidate = {
      id: 'pending-placeholder',
      source: 'Bonjour',
      prefix: '',
      suffix: '',
      target: { kind: 'attribute', element: input, attribute: 'placeholder' },
      observedElement: input,
    };
    const feedback = new TranslationHighlightFeedback(document);

    expect(feedback.markPending(candidate)).toBe(true);
    expect(input.getAttribute('data-fast-ai-translator-pending')).toMatch(
      /^fast-ai-translator-feedback-/,
    );
    feedback.removePending(candidate);
    expect(input).toHaveAttribute('data-fast-ai-translator-pending', 'site');
  });

  it('does nothing when the CSS Custom Highlight API is unavailable', () => {
    vi.stubGlobal('CSS', {});
    vi.stubGlobal('Highlight', undefined);
    document.body.innerHTML = '<p>Hello</p>';
    const node = document.querySelector('p')!.firstChild as Text;
    const feedback = new TranslationHighlightFeedback(document);

    expect(feedback.flash(textCandidate(node, 'Hello'))).toBe(false);
    expect(document.querySelector('[data-fast-ai-translator-highlight]')).toBeNull();
    expect(document.querySelector('style[data-fast-ai-translator]')).toBeNull();
  });

  it('marks attribute targets temporarily and restores a previous marker exactly', () => {
    document.body.innerHTML = '<button data-fast-ai-translator-highlight="website">Bonjour</button>';
    const button = document.querySelector('button')!;
    button.setAttribute('style', 'background-color: red');
    const candidate = attributeCandidate(button, 'title', 'Hello');
    const feedback = new TranslationHighlightFeedback(document);

    expect(feedback.flash(candidate)).toBe(true);
    expect(button.getAttribute('data-fast-ai-translator-highlight')).toMatch(
      /^fast-ai-translator-feedback-/,
    );
    expect(button.getAttribute('style')).toBe('background-color: red');

    vi.advanceTimersByTime(1_200);
    expect(button.getAttribute('data-fast-ai-translator-highlight')).toBe('website');
    expect(button.getAttribute('style')).toBe('background-color: red');
  });

  it('keeps a shared element marked until all attribute feedback is removed', () => {
    document.body.innerHTML = '<img alt="Hello" title="Greeting">';
    const image = document.querySelector('img')!;
    const first = attributeCandidate(image, 'alt', 'Hello', 'alt');
    const second = attributeCandidate(image, 'title', 'Greeting', 'title');
    const feedback = new TranslationHighlightFeedback(document);

    expect(feedback.flash(first)).toBe(true);
    expect(feedback.flash(second)).toBe(true);
    feedback.remove(first);
    expect(image).toHaveAttribute('data-fast-ai-translator-highlight');
    feedback.remove(second);
    expect(image).not.toHaveAttribute('data-fast-ai-translator-highlight');
  });

  it('injects owned styles into open shadow roots and removes them on destroy', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const paragraph = document.createElement('p');
    paragraph.textContent = 'Bonjour';
    shadow.append(paragraph);
    const node = paragraph.firstChild as Text;
    const candidate = textCandidate(node, 'Hello');
    const feedback = new TranslationHighlightFeedback(document);

    expect(feedback.flash(candidate)).toBe(true);
    expect(shadow.querySelector('style[data-fast-ai-translator="translation-highlight"]')).not.toBeNull();
    expect(document.head.querySelector('style[data-fast-ai-translator]')).toBeNull();

    feedback.destroy();
    expect(shadow.querySelector('style[data-fast-ai-translator]')).toBeNull();
    expect(registry.size).toBe(0);
    expect(feedback.flash(candidate)).toBe(false);
  });

  it('clears timers, ranges, and markers without changing translated values', () => {
    document.body.innerHTML = '<p>Bonjour</p><button title="Bonjour">Send</button>';
    const node = document.querySelector('p')!.firstChild as Text;
    const button = document.querySelector('button')!;
    const text = textCandidate(node, 'Hello');
    const attribute = attributeCandidate(button, 'title', 'Hello');
    const feedback = new TranslationHighlightFeedback(document);

    feedback.flash(text);
    feedback.flash(attribute);
    feedback.clear();
    vi.runAllTimers();

    expect(registry.size).toBe(0);
    expect(button).not.toHaveAttribute('data-fast-ai-translator-highlight');
    expect(node.nodeValue).toBe('  Hello  ');
    expect(button).toHaveAttribute('title', 'Hello');
  });
});
