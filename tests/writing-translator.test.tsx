import { cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WritingTranslator } from '../lib/writing-translator';

const { getStorage, sendMessage, setStorage } = vi.hoisted(() => ({
  getStorage: vi.fn(async (key: string) => ({ [key]: undefined })),
  sendMessage: vi.fn(),
  setStorage: vi.fn(async () => undefined),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { sendMessage },
    storage: { local: { get: getStorage, set: setStorage } },
  },
}));

function writingShadow(): ShadowRoot {
  return document.querySelector('[data-fast-ai-translator="writing-ui"]')!.shadowRoot!;
}

function shortcut(editor: Element, slot = 1, extra: KeyboardEventInit = {}): boolean {
  return fireEvent.keyDown(editor, { code: `Digit${slot}`, key: '!', altKey: true, shiftKey: true, ...extra });
}

function delayDraftResponses(): Array<(translation: string) => void> {
  const responses: Array<(translation: string) => void> = [];
  sendMessage.mockImplementation((request: { type: string; payload?: { requestId: string } }) => {
    if (request.type !== 'TRANSLATE_DRAFT') return Promise.resolve({ cancelled: true });
    return new Promise((resolve) => responses.push((translation) => resolve({
      requestId: request.payload!.requestId, translation, providerMs: 5, requestCount: 1,
    })));
  });
  return responses;
}

describe('writing translator controller', () => {
  let translator: WritingTranslator | undefined;

  beforeEach(() => {
    document.body.innerHTML = '';
    sendMessage.mockReset();
    getStorage.mockClear();
    setStorage.mockClear();
    sendMessage.mockImplementation(async (request: { type: string; payload?: { requestId: string } }) => {
      if (request.type === 'TRANSLATE_DRAFT') {
        return {
          requestId: request.payload!.requestId,
          translation: 'mundo',
          providerMs: 5,
          requestCount: 1,
        };
      }
      return { cancelled: true };
    });
  });

  afterEach(() => {
    translator?.destroy();
    translator = undefined;
    cleanup();
  });

  it('translates the current selection, previews it, and replaces only after confirmation', async () => {
    document.body.innerHTML = '<form><textarea>Hello world</textarea></form>';
    const textarea = document.querySelector('textarea')!;
    textarea.setSelectionRange(6, 11);
    const submit = vi.fn((event: Event) => event.preventDefault());
    document.querySelector('form')!.addEventListener('submit', submit);
    translator = new WritingTranslator(document);
    translator.setEnabled(true);

    fireEvent.focusIn(textarea);
    await vi.waitFor(() =>
      expect(writingShadow().querySelector('[aria-label="Translate writing"]')).not.toBeNull(),
    );
    const icon = writingShadow().querySelector('[aria-label="Translate writing"]')!;
    fireEvent.pointerDown(icon);
    fireEvent.click(icon);

    await vi.waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith({
        type: 'TRANSLATE_DRAFT',
        payload: expect.objectContaining({
          text: 'world',
          targetLanguage: { code: 'en', name: 'English' },
        }),
      }),
    );
    await vi.waitFor(() => expect(writingShadow().textContent).toContain('mundo'));
    expect(textarea.value).toBe('Hello world');

    fireEvent.click(writingShadow().querySelector('button.command-primary')!);
    expect(textarea.value).toBe('Hello mundo');
    expect(submit).not.toHaveBeenCalled();
  });

  it('supports the keyboard shortcut and Escape without replacing text', async () => {
    document.body.innerHTML = '<input value="Hello">';
    const input = document.querySelector('input')!;
    translator = new WritingTranslator(document);
    translator.setEnabled(true);
    fireEvent.focusIn(input);

    fireEvent.keyDown(input, { key: 'Enter', altKey: true, shiftKey: true });
    await vi.waitFor(() =>
      expect(writingShadow().querySelector('[role="dialog"]')).not.toBeNull(),
    );
    fireEvent.keyDown(input, { key: 'Escape' });
    await vi.waitFor(() => expect(writingShadow().querySelector('[role="dialog"]')).toBeNull());
    expect(input.value).toBe('Hello');
  });

  it('uses the same keyboard shortcut to confirm a ready preview', async () => {
    document.body.innerHTML = '<form><input value="Hello"></form>';
    const input = document.querySelector('input')!;
    const submit = vi.fn((event: Event) => event.preventDefault());
    document.querySelector('form')!.addEventListener('submit', submit);
    translator = new WritingTranslator(document);
    translator.setEnabled(true);
    fireEvent.focusIn(input);

    fireEvent.keyDown(input, { key: 'Enter', altKey: true, shiftKey: true });
    await vi.waitFor(() => expect(writingShadow().textContent).toContain('mundo'));
    expect(input.value).toBe('Hello');

    fireEvent.keyDown(input, { key: 'Enter', altKey: true, shiftKey: true });

    expect(input.value).toBe('mundo');
    expect(submit).not.toHaveBeenCalled();
  });

  it('appears for an editor in an open shadow root but not for protected inputs', async () => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const textarea = document.createElement('textarea');
    textarea.value = 'Hello';
    shadow.append(textarea);
    document.body.append(host);
    const password = document.createElement('input');
    password.type = 'password';
    document.body.append(password);
    translator = new WritingTranslator(document);
    translator.setEnabled(true);

    textarea.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }));
    await vi.waitFor(() =>
      expect(writingShadow().querySelector('[aria-label="Translate writing"]')).not.toBeNull(),
    );

    fireEvent.focusIn(password);
    await vi.waitFor(() =>
      expect(writingShadow().querySelector('[aria-label="Translate writing"]')).toBeNull(),
    );
  });

  it('rejects Replace when the draft changed after the request', async () => {
    document.body.innerHTML = '<textarea>Hello</textarea>';
    const textarea = document.querySelector('textarea')!;
    translator = new WritingTranslator(document);
    translator.setEnabled(true);
    fireEvent.focusIn(textarea);
    await vi.waitFor(() =>
      expect(writingShadow().querySelector('[aria-label="Translate writing"]')).not.toBeNull(),
    );
    fireEvent.click(writingShadow().querySelector('[aria-label="Translate writing"]')!);
    await vi.waitFor(() => expect(writingShadow().textContent).toContain('mundo'));

    textarea.value = 'Changed';
    fireEvent.click(writingShadow().querySelector('button.command-primary')!);
    await vi.waitFor(() => expect(writingShadow().textContent).toContain('draft changed'));
    expect(textarea.value).toBe('Changed');
  });

  it('uses a physical digit to translate and directly replace the selection without submitting', async () => {
    document.body.innerHTML = '<form><textarea>Hello world</textarea></form>';
    const textarea = document.querySelector('textarea')!;
    const submit = vi.fn((event: Event) => event.preventDefault());
    document.querySelector('form')!.addEventListener('submit', submit);
    translator = new WritingTranslator(document);
    translator.setShortcuts([null, { code: 'es', name: 'Spanish' }]);
    translator.setEnabled(true);
    textarea.focus();
    textarea.setSelectionRange(6, 11);
    expect(shortcut(textarea, 2, { key: '@' })).toBe(false);
    await vi.waitFor(() => expect(textarea.value).toBe('Hello mundo'));
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'TRANSLATE_DRAFT',
      payload: expect.objectContaining({ text: 'world', targetLanguage: { code: 'es', name: 'Spanish' } }),
    });
    expect(textarea.selectionStart).toBe(11);
    expect(document.activeElement).toBe(textarea);
    expect(submit).not.toHaveBeenCalled();
    expect(writingShadow().querySelector('[role="dialog"]')).toBeNull();
    expect(setStorage).toHaveBeenCalledWith(expect.objectContaining({
      'fastAiTranslator.writingTargets': expect.arrayContaining([
        expect.objectContaining({ target: { code: 'es', name: 'Spanish' } }),
      ]),
    }));
  });

  it.each(['input', 'textarea', 'contenteditable'])('replaces the full %s draft directly', async (kind) => {
    document.body.innerHTML = kind === 'input' ? '<input value="Hello world">'
      : kind === 'textarea' ? '<textarea>Hello world</textarea>'
      : '<div contenteditable="true" tabindex="0">Hello world</div>';
    const editor = document.body.firstElementChild as HTMLElement;
    translator = new WritingTranslator(document);
    translator.setEnabled(true);
    editor.focus();
    shortcut(editor);
    await vi.waitFor(() => expect(editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement
      ? editor.value : editor.textContent).toBe('mundo'));
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'TRANSLATE_DRAFT', payload: expect.objectContaining({ text: 'Hello world', targetLanguage: { code: 'en', name: 'English' } }),
    });
  });

  it('updates React controlled textarea state when replacing', async () => {
    function ControlledDraft() {
      const [draft, setDraft] = useState('Hello');
      return <><textarea aria-label="Draft" value={draft} onChange={(event) => setDraft(event.target.value)} /><output>{draft}</output></>;
    }
    const view = render(<ControlledDraft />);
    translator = new WritingTranslator(document);
    translator.setEnabled(true);
    const editor = view.getByRole('textbox');
    editor.focus();
    shortcut(editor);
    await vi.waitFor(() => expect(view.getByRole('status')).toHaveTextContent('mundo'));
    expect(editor).toHaveValue('mundo');
  });

  it('applies changed assignments immediately and respects cleared slots', async () => {
    document.body.innerHTML = '<input value="Hello">';
    const editor = document.querySelector('input')!;
    translator = new WritingTranslator(document);
    translator.setEnabled(true);
    editor.focus();
    expect(shortcut(editor, 9)).toBe(true);
    translator.setShortcuts([null, ...Array(7).fill(null), { code: 'eo', name: 'Esperanto' }]);
    expect(shortcut(editor)).toBe(true);
    expect(sendMessage).not.toHaveBeenCalled();
    shortcut(editor, 9);
    await vi.waitFor(() => expect(editor.value).toBe('mundo'));
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'TRANSLATE_DRAFT', payload: expect.objectContaining({ targetLanguage: { code: 'eo', name: 'Esperanto' } }),
    });
  });

  it('ignores repeats, composition, extra modifiers, protected fields, and keys outside the editor', () => {
    document.body.innerHTML = '<input value="Hello"><input type="password" value="private">';
    const editor = document.querySelector('input')!;
    translator = new WritingTranslator(document);
    translator.setEnabled(true);
    editor.focus();
    for (const extra of [{ repeat: true }, { isComposing: true }, { ctrlKey: true }, { metaKey: true }]) {
      expect(shortcut(editor, 1, extra)).toBe(true);
    }
    expect(shortcut(document.body)).toBe(true);
    const password = document.querySelector('input[type="password"]') as HTMLInputElement;
    password.focus();
    expect(shortcut(password)).toBe(true);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('cancels the previous target and applies only the latest shortcut result', async () => {
    const responses = delayDraftResponses();
    document.body.innerHTML = '<textarea>Hello</textarea>';
    const editor = document.querySelector('textarea')!;
    translator = new WritingTranslator(document);
    translator.setShortcuts([{ code: 'en', name: 'English' }, { code: 'hi', name: 'Hindi' }]);
    translator.setEnabled(true);
    editor.focus();
    shortcut(editor);
    shortcut(editor, 2);
    expect(responses).toHaveLength(2);
    responses[1]!('Namaste');
    await vi.waitFor(() => expect(editor.value).toBe('Namaste'));
    responses[0]!('Old result');
    await Promise.resolve();
    expect(editor.value).toBe('Namaste');
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'CANCEL_DRAFT_TRANSLATION' }));
  });

  it.each(['edit', 'silent-edit', 'blur', 'window-blur', 'disable', 'escape', 'remove'])('never replaces a pending draft after %s', async (action) => {
    const responses = delayDraftResponses();
    document.body.innerHTML = '<textarea>Hello</textarea>';
    const editor = document.querySelector('textarea')!;
    translator = new WritingTranslator(document);
    translator.setEnabled(true);
    editor.focus();
    shortcut(editor);
    await vi.waitFor(() => expect(writingShadow().textContent).toContain('Translating to English'));
    if (action === 'edit' || action === 'silent-edit') editor.value = 'New draft';
    if (action === 'edit') fireEvent.input(editor);
    if (action === 'blur') editor.blur();
    if (action === 'window-blur') window.dispatchEvent(new Event('blur'));
    if (action === 'disable') translator.setEnabled(false);
    if (action === 'escape') fireEvent.keyDown(editor, { key: 'Escape' });
    if (action === 'remove') editor.remove();
    responses[0]!('Stale translation');
    await Promise.resolve();
    expect(editor.value).toBe(action.endsWith('edit') ? 'New draft' : 'Hello');
  });

  it('keeps the original draft on failure and lets Retry finish the direct replacement', async () => {
    document.body.innerHTML = '<input value="Hello">';
    const editor = document.querySelector('input')!;
    translator = new WritingTranslator(document);
    translator.setEnabled(true);
    editor.focus();
    sendMessage.mockRejectedValueOnce(new Error('Provider unavailable'));
    shortcut(editor);
    await vi.waitFor(() => expect(writingShadow().textContent).toContain('Provider unavailable'));
    expect(editor.value).toBe('Hello');
    const retry = [...writingShadow().querySelectorAll('button')].find((button) => button.textContent === 'Retry')!;
    retry.focus();
    fireEvent.click(retry);
    await vi.waitFor(() => expect(editor.value).toBe('mundo'));
  });
});
