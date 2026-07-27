import { fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageTranslator } from '../lib/image-translator';

const { sendMessage } = vi.hoisted(() => ({
  sendMessage: vi.fn(),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { sendMessage },
  },
}));

const IMAGE_DATA_URL = 'data:image/jpeg;base64,YQ==';

function imageShadow(): ShadowRoot {
  return document.querySelector('[data-fast-ai-translator="image-ui"]')!.shadowRoot!;
}

function setRect(element: Element, rect: Partial<DOMRect> = {}): void {
  const value = {
    x: 40,
    y: 50,
    left: 40,
    top: 50,
    right: 440,
    bottom: 350,
    width: 400,
    height: 300,
    toJSON: () => ({}),
    ...rect,
  } as DOMRect;
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => value,
  });
}

function addImage(parent: ParentNode = document.body): HTMLImageElement {
  const image = document.createElement('img');
  parent.appendChild(image);
  setRect(image);
  return image;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('image translator controller', () => {
  let translator: ImageTranslator | undefined;

  beforeEach(() => {
    document.body.innerHTML = '';
    sendMessage.mockReset();
    sendMessage.mockImplementation(async (request: { type: string; payload?: { requestId: string } }) => {
      if (request.type === 'CAPTURE_IMAGE') {
        return {
          requestId: request.payload!.requestId,
          imageDataUrl: IMAGE_DATA_URL,
          width: 400,
          height: 300,
        };
      }
      if (request.type === 'TRANSLATE_IMAGE') {
        return {
          requestId: request.payload!.requestId,
          hasText: true,
          sourceLanguage: 'French',
          translation: 'Hello from the image',
          providerMs: 12,
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

  it('shows a Shadow DOM control on hover and captures only after a click', async () => {
    const image = addImage();
    translator = new ImageTranslator(document);
    translator.setEnabled(true);

    fireEvent.pointerMove(image);
    await vi.waitFor(() =>
      expect(imageShadow().querySelector('[aria-label="Translate image"]')).not.toBeNull(),
    );
    expect(sendMessage).not.toHaveBeenCalled();

    fireEvent.click(imageShadow().querySelector('[aria-label="Translate image"]')!);

    await vi.waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith({
        type: 'CAPTURE_IMAGE',
        payload: expect.objectContaining({
          area: expect.objectContaining({ left: 40, top: 50, width: 400, height: 300 }),
        }),
      }),
    );
    await vi.waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith({
        type: 'TRANSLATE_IMAGE',
        payload: expect.objectContaining({
          imageDataUrl: IMAGE_DATA_URL,
          targetLanguage: { code: 'en', name: 'English' },
        }),
      }),
    );
    await vi.waitFor(() =>
      expect(imageShadow().textContent).toContain('Hello from the image'),
    );
    expect(imageShadow().querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('retranslates the captured image when the target changes', async () => {
    const image = addImage();
    sendMessage.mockImplementation(async (request: {
      type: string;
      payload?: { requestId: string; targetLanguage?: { code: string } };
    }) => {
      if (request.type === 'CAPTURE_IMAGE') {
        return { requestId: request.payload!.requestId, imageDataUrl: IMAGE_DATA_URL };
      }
      if (request.type === 'TRANSLATE_IMAGE') {
        const tamil = request.payload?.targetLanguage?.code === 'ta';
        return {
          requestId: request.payload!.requestId,
          hasText: true,
          translation: tamil ? 'வணக்கம்' : 'Hello',
          providerMs: 4,
          requestCount: 1,
        };
      }
      return { cancelled: true };
    });
    translator = new ImageTranslator(document);
    translator.setEnabled(true);
    fireEvent.pointerMove(image);
    await vi.waitFor(() =>
      expect(imageShadow().querySelector('[aria-label="Translate image"]')).not.toBeNull(),
    );
    fireEvent.click(imageShadow().querySelector('[aria-label="Translate image"]')!);
    await vi.waitFor(() => expect(imageShadow().textContent).toContain('Hello'));

    fireEvent.click(imageShadow().querySelector('.target-button')!);
    const tamil = Array.from(imageShadow().querySelectorAll('[role="option"]')).find(
      (option) => option.textContent?.includes('Tamil'),
    );
    expect(tamil).toBeDefined();
    fireEvent.click(tamil!);

    await vi.waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith({
        type: 'TRANSLATE_IMAGE',
        payload: expect.objectContaining({ targetLanguage: { code: 'ta', name: 'Tamil' } }),
      }),
    );
    await vi.waitFor(() => expect(imageShadow().textContent).toContain('வணக்கம்'));
  });

  it('cancels an active request and closes on Escape', async () => {
    const image = addImage();
    const pending = deferred<never>();
    sendMessage.mockImplementation((request: { type: string; payload?: { requestId: string } }) => {
      if (request.type === 'CAPTURE_IMAGE') {
        return Promise.resolve({
          requestId: request.payload!.requestId,
          imageDataUrl: IMAGE_DATA_URL,
        });
      }
      if (request.type === 'TRANSLATE_IMAGE') return pending.promise;
      return Promise.resolve({ cancelled: true });
    });
    translator = new ImageTranslator(document);
    translator.setEnabled(true);
    fireEvent.pointerMove(image);
    await vi.waitFor(() =>
      expect(imageShadow().querySelector('[aria-label="Translate image"]')).not.toBeNull(),
    );
    fireEvent.click(imageShadow().querySelector('[aria-label="Translate image"]')!);
    await vi.waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith({
        type: 'TRANSLATE_IMAGE',
        payload: expect.objectContaining({ requestId: expect.any(String) }),
      }),
    );
    const translationCall = sendMessage.mock.calls.find(
      ([request]) => request.type === 'TRANSLATE_IMAGE',
    )![0];

    fireEvent.keyDown(image, { key: 'Escape' });

    await vi.waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith({
        type: 'CANCEL_IMAGE_TRANSLATION',
        requestId: translationCall.payload.requestId,
      }),
    );
    expect(imageShadow().querySelector('[role="dialog"]')).toBeNull();
  });

  it('explains image timeouts and retries the existing capture', async () => {
    const image = addImage();
    sendMessage.mockImplementation(async (request: { type: string; payload?: { requestId: string } }) => {
      if (request.type === 'CAPTURE_IMAGE') {
        return {
          requestId: request.payload!.requestId,
          imageDataUrl: IMAGE_DATA_URL,
        };
      }
      if (request.type === 'TRANSLATE_IMAGE') {
        return {
          requestId: request.payload!.requestId,
          hasText: false,
          error: { code: 'TIMEOUT', message: 'The translation provider timed out.' },
          providerMs: 45_000,
          requestCount: 1,
        };
      }
      return { cancelled: true };
    });
    translator = new ImageTranslator(document);
    translator.setEnabled(true);
    fireEvent.pointerMove(image);
    await vi.waitFor(() =>
      expect(imageShadow().querySelector('[aria-label="Translate image"]')).not.toBeNull(),
    );
    fireEvent.click(imageShadow().querySelector('[aria-label="Translate image"]')!);

    await vi.waitFor(() => expect(imageShadow().textContent).toContain('45 seconds'));
    expect(imageShadow().textContent).toContain('gpt-5.6-luna');
    const retry = Array.from(imageShadow().querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Retry',
    );
    expect(retry).toBeDefined();
    expect(retry).not.toBeDisabled();
    fireEvent.click(retry!);

    await vi.waitFor(() =>
      expect(
        sendMessage.mock.calls.filter(([request]) => request.type === 'TRANSLATE_IMAGE'),
      ).toHaveLength(2),
    );
    expect(
      sendMessage.mock.calls.filter(([request]) => request.type === 'CAPTURE_IMAGE'),
    ).toHaveLength(1);
  });

  it('supports open shadow roots, ignores app images, and cleans up removed images', async () => {
    const pageHost = document.createElement('div');
    const pageShadow = pageHost.attachShadow({ mode: 'open' });
    const image = addImage(pageShadow);
    document.body.append(pageHost);
    const appButton = document.createElement('button');
    const appImage = addImage(appButton);
    document.body.append(appButton);
    translator = new ImageTranslator(document);
    translator.setEnabled(true);

    fireEvent.pointerMove(appImage);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(imageShadow().querySelector('[aria-label="Translate image"]')).toBeNull();

    fireEvent.pointerMove(image);
    await vi.waitFor(() =>
      expect(imageShadow().querySelector('[aria-label="Translate image"]')).not.toBeNull(),
    );
    image.remove();
    await vi.waitFor(() =>
      expect(imageShadow().querySelector('[aria-label="Translate image"]')).toBeNull(),
    );
  });

  it('uses the copy fallback when the Clipboard API is unavailable', async () => {
    const image = addImage();
    const execCommand = vi.fn(() => true);
    const clipboard = window.navigator.clipboard;
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    });
    translator = new ImageTranslator(document);
    translator.setEnabled(true);
    fireEvent.pointerMove(image);
    await vi.waitFor(() =>
      expect(imageShadow().querySelector('[aria-label="Translate image"]')).not.toBeNull(),
    );
    fireEvent.click(imageShadow().querySelector('[aria-label="Translate image"]')!);
    await vi.waitFor(() => expect(imageShadow().textContent).toContain('Hello from the image'));

    fireEvent.click(imageShadow().querySelector('.command-primary')!);

    await vi.waitFor(() => expect(execCommand).toHaveBeenCalledWith('copy'));
    expect(imageShadow().textContent).toContain('Copied');
    expect(document.querySelector('[data-fast-ai-translator="copy-helper"]')).toBeNull();
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: clipboard,
    });
  });
});
