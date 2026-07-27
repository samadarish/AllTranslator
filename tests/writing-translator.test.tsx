import { fireEvent } from '@testing-library/react';
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
});
