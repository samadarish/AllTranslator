import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_DRAFT_CHARACTERS } from '../lib/constants';
import {
  captureDraftSnapshot,
  findWritingEditor,
  isEligibleWritingEditor,
  replaceDraftSnapshot,
} from '../lib/writing-editor';

describe('writing editor safety and replacement', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('accepts normal controls and Telegram-style editing hosts', () => {
    document.body.innerHTML = `
      <input id="input" type="text">
      <textarea id="textarea"></textarea>
      <div id="editable" contenteditable="true"></div>
      <div id="telegram" role="textbox" contenteditable="true"></div>
    `;

    for (const id of ['input', 'textarea', 'editable', 'telegram']) {
      expect(isEligibleWritingEditor(document.querySelector(`#${id}`)!)).toBe(true);
    }
  });

  it('rejects protected fields, code editors, extension UI, and oversized drafts', () => {
    document.body.innerHTML = `
      <input id="password" type="password">
      <input id="email" type="email">
      <input id="url" type="url">
      <input id="number" type="number">
      <input id="otp" type="text" autocomplete="one-time-code">
      <input id="readonly" type="text" readonly>
      <div class="monaco-editor"><textarea id="code"></textarea></div>
      <div data-fast-ai-translator><textarea id="owned"></textarea></div>
      <div id="false-textbox" role="textbox" contenteditable="false">Read only</div>
      <textarea id="long"></textarea>
    `;
    (document.querySelector('#long') as HTMLTextAreaElement).value = 'x'.repeat(
      MAX_DRAFT_CHARACTERS + 1,
    );

    for (const id of [
      'password',
      'email',
      'url',
      'number',
      'otp',
      'readonly',
      'code',
      'owned',
      'false-textbox',
      'long',
    ]) {
      expect(isEligibleWritingEditor(document.querySelector(`#${id}`)!)).toBe(false);
    }
  });

  it('translates a control selection, emits compatible events, and never submits', () => {
    document.body.innerHTML = '<form><textarea>Hello world</textarea></form>';
    const textarea = document.querySelector('textarea')!;
    textarea.setSelectionRange(6, 11);
    const snapshot = captureDraftSnapshot(textarea)!;
    const events: string[] = [];
    textarea.addEventListener('beforeinput', (event) => {
      events.push(`${event.type}:${(event as InputEvent).inputType}`);
    });
    textarea.addEventListener('input', (event) => {
      events.push(`${event.type}:${(event as InputEvent).inputType}`);
    });
    const submit = vi.fn((event: Event) => event.preventDefault());
    document.querySelector('form')!.addEventListener('submit', submit);

    expect(snapshot.source).toBe('world');
    expect(replaceDraftSnapshot(snapshot, 'mundo')).toEqual({ ok: true });
    expect(textarea.value).toBe('Hello mundo');
    expect(textarea.selectionStart).toBe(11);
    expect(events).toEqual([
      'beforeinput:insertReplacementText',
      'input:insertReplacementText',
    ]);
    expect(submit).not.toHaveBeenCalled();
  });

  it('falls back to the complete draft and rejects stale replacement', () => {
    document.body.innerHTML = '<input value="Hello world">';
    const input = document.querySelector('input')!;
    input.setSelectionRange(3, 3);
    const snapshot = captureDraftSnapshot(input)!;
    expect(snapshot.source).toBe('Hello world');

    input.value = 'Hello changed';
    expect(replaceDraftSnapshot(snapshot, 'Bonjour le monde')).toMatchObject({
      ok: false,
      error: expect.stringContaining('draft changed'),
    });
    expect(input.value).toBe('Hello changed');
  });

  it('replaces a contenteditable selection without touching surrounding text', () => {
    document.body.innerHTML = '<div role="textbox" contenteditable="true">Hello world</div>';
    const editor = document.querySelector('[role="textbox"]') as HTMLElement;
    const text = editor.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 6);
    range.setEnd(text, 11);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);

    const snapshot = captureDraftSnapshot(editor)!;
    expect(snapshot.source).toBe('world');
    expect(replaceDraftSnapshot(snapshot, 'monde')).toEqual({ ok: true });
    expect(editor).toHaveTextContent('Hello monde');
  });

  it('discovers eligible editors from an open shadow-root event path', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const textarea = document.createElement('textarea');
    shadow.append(textarea);

    expect(findWritingEditor([textarea, shadow, host, document])).toBe(textarea);
  });

  it('honors a framework cancelling beforeinput', () => {
    document.body.innerHTML = '<textarea>Hello</textarea>';
    const textarea = document.querySelector('textarea')!;
    const snapshot = captureDraftSnapshot(textarea)!;
    textarea.addEventListener('beforeinput', (event) => event.preventDefault());

    expect(replaceDraftSnapshot(snapshot, 'Bonjour')).toMatchObject({
      ok: false,
      error: expect.stringContaining('prevented'),
    });
    expect(textarea.value).toBe('Hello');
  });
});
