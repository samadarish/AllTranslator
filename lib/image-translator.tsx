import {
  AlertCircle,
  Check,
  Copy,
  Languages,
  LoaderCircle,
  RefreshCw,
  X,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { browser } from 'wxt/browser';
import { findEligibleImage, isEligibleImage } from './image-element';
import { TargetLanguagePicker } from './target-language-picker';
import type {
  ImageCaptureResponse,
  ImageTranslationResponse,
  TargetLanguage,
} from './types';
import { DEFAULT_WRITING_TARGET, validateTargetLanguage } from './writing-languages';

type ImageTranslationPhase =
  | 'idle'
  | 'capturing'
  | 'loading'
  | 'success'
  | 'empty'
  | 'error';

interface ImageAnchorPosition {
  iconLeft: number;
  iconTop: number;
  popoverLeft: number;
  popoverTop?: number;
  popoverBottom?: number;
}

interface ImageTranslatorViewProps {
  visible: boolean;
  open: boolean;
  phase: ImageTranslationPhase;
  position: ImageAnchorPosition;
  target: TargetLanguage;
  translation: string;
  sourceLanguage: string;
  error: string;
  canRetry: boolean;
  copied: boolean;
  onOpen: () => void;
  onClose: () => void;
  onRetry: () => void;
  onCopy: () => void;
  onTarget: (target: TargetLanguage) => void;
}

const IMAGE_UI_CSS = `
:host {
  all: initial;
  color: #17201e;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  letter-spacing: 0;
}
* { box-sizing: border-box; }
button, input { font: inherit; letter-spacing: 0; }
button { cursor: pointer; }
.image-shell { position: fixed; inset: 0; pointer-events: none; }
.image-button {
  position: fixed;
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 1px solid rgb(255 255 255 / 72%);
  border-radius: 7px;
  color: #fff;
  background: #183b36;
  box-shadow: 0 3px 12px rgb(20 31 28 / 28%);
  pointer-events: auto;
}
.image-button:hover { background: #24564e; }
.image-button:focus-visible,
.icon-button:focus-visible,
.target-button:focus-visible,
.language-option:focus-visible,
.command:focus-visible,
input:focus-visible {
  outline: 2px solid #5cae96;
  outline-offset: 2px;
}
.popover {
  position: fixed;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  width: min(400px, calc(100vw - 16px));
  max-height: min(520px, calc(100vh - 16px));
  overflow: visible;
  border: 1px solid #cbd4d0;
  border-radius: 8px;
  color: #17201e;
  background: #fff;
  box-shadow: 0 12px 34px rgb(20 31 28 / 24%);
  pointer-events: auto;
}
.popover-header {
  display: flex;
  min-height: 48px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 9px 8px 12px;
  border-bottom: 1px solid #e0e5e2;
  border-radius: 7px 7px 0 0;
  background: #fff;
}
.target-wrap { position: relative; min-width: 0; }
.target-button {
  display: inline-flex;
  min-width: 0;
  height: 32px;
  align-items: center;
  gap: 7px;
  border: 1px solid #cbd4d0;
  border-radius: 6px;
  padding: 0 9px;
  color: #24443d;
  background: #f7faf8;
  font-size: 12px;
  font-weight: 650;
}
.target-button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.icon-button {
  display: grid;
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  place-items: center;
  border: 0;
  border-radius: 6px;
  color: #5e6b67;
  background: transparent;
}
.icon-button:hover { color: #213c36; background: #edf3f0; }
.picker {
  position: absolute;
  top: 38px;
  left: 0;
  z-index: 2;
  display: grid;
  width: min(320px, calc(100vw - 42px));
  overflow: hidden;
  border: 1px solid #cbd4d0;
  border-radius: 7px;
  background: #fff;
  box-shadow: 0 8px 24px rgb(20 31 28 / 20%);
}
.search-row { position: relative; padding: 8px; border-bottom: 1px solid #e3e8e5; }
.search-row svg { position: absolute; top: 16px; left: 17px; color: #6d7975; }
.search-row input,
.custom-grid input {
  width: 100%;
  height: 32px;
  border: 1px solid #cbd4d0;
  border-radius: 5px;
  color: #17201e;
  background: #fff;
  font-size: 12px;
}
.search-row input { padding: 0 9px 0 31px; }
.language-list { max-height: 184px; overflow: auto; padding: 4px; }
.language-option {
  display: flex;
  width: 100%;
  min-height: 32px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 0;
  border-radius: 5px;
  padding: 0 8px;
  color: #25332f;
  background: transparent;
  font-size: 12px;
  text-align: left;
}
.language-option:hover, .language-option.selected { background: #edf4f1; }
.language-option small { color: #78837f; font-size: 10px; }
.custom-toggle { border-top: 1px solid #e3e8e5; color: #315c52; font-weight: 650; }
.custom-grid { display: grid; grid-template-columns: 1fr 88px; gap: 7px; padding: 8px; border-top: 1px solid #e3e8e5; }
.custom-grid input { padding: 0 8px; }
.custom-grid .custom-error { grid-column: 1 / -1; margin: 0; color: #a53a32; font-size: 10px; line-height: 1.35; }
.custom-grid .command { grid-column: 1 / -1; justify-self: end; }
.preview-area {
  min-height: 154px;
  overflow: auto;
  padding: 14px;
  font-size: 13px;
  line-height: 1.5;
}
.preview-meta { display: flex; align-items: center; gap: 7px; margin: 0 0 8px; }
.preview-label { color: #697570; font-size: 10px; font-weight: 700; text-transform: uppercase; }
.source-language { border-radius: 4px; padding: 2px 6px; color: #315b50; background: #edf4f1; font-size: 10px; }
.preview-text { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.status-line { display: flex; min-height: 112px; align-items: center; justify-content: center; gap: 8px; color: #5e6a66; text-align: center; }
.status-error { align-items: flex-start; color: #96372f; text-align: left; }
.error-block { display: grid; gap: 12px; justify-items: start; }
.error-copy { display: flex; gap: 8px; line-height: 1.4; }
.popover-footer {
  display: flex;
  min-height: 50px;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 8px 10px;
  border-top: 1px solid #e0e5e2;
  border-radius: 0 0 7px 7px;
  background: #f8faf9;
}
.command {
  display: inline-flex;
  min-height: 32px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid #c9d2ce;
  border-radius: 6px;
  padding: 0 11px;
  color: #34443f;
  background: #fff;
  font-size: 11px;
  font-weight: 650;
}
.command:hover:not(:disabled) { border-color: #93a69f; background: #f5f8f6; }
.command-primary { border-color: #183b36; color: #fff; background: #183b36; }
.command-primary:hover:not(:disabled) { border-color: #24564e; background: #24564e; }
.command:disabled { cursor: not-allowed; opacity: .45; }
.spin { animation: image-spin 850ms linear infinite; }
@keyframes image-spin { to { transform: rotate(360deg); } }
@media (max-width: 440px) { .popover { width: calc(100vw - 16px); } }
`;

function ImageTranslatorView(props: ImageTranslatorViewProps) {
  if (!props.visible) return null;
  const iconStyle: CSSProperties = {
    left: props.position.iconLeft,
    top: props.position.iconTop,
  };
  const popoverStyle: CSSProperties = {
    left: props.position.popoverLeft,
    ...(props.position.popoverTop === undefined ? {} : { top: props.position.popoverTop }),
    ...(props.position.popoverBottom === undefined
      ? {}
      : { bottom: props.position.popoverBottom }),
  };

  return (
    <div className="image-shell">
      <button
        className="image-button"
        type="button"
        style={iconStyle}
        title="Translate image"
        aria-label="Translate image"
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          props.onOpen();
        }}
      >
        <Languages size={16} />
      </button>

      {props.open && (
        <section
          className="popover"
          style={popoverStyle}
          role="dialog"
          aria-label="Image translator"
        >
          <header className="popover-header">
            <TargetLanguagePicker target={props.target} onTarget={props.onTarget} />
            <button
              className="icon-button"
              type="button"
              title="Close"
              aria-label="Close image translator"
              onClick={props.onClose}
            >
              <X size={17} />
            </button>
          </header>

          <div className="preview-area" aria-live="polite">
            {props.phase === 'capturing' && (
              <div className="status-line">
                <LoaderCircle className="spin" size={18} />
                <span>Preparing image...</span>
              </div>
            )}
            {props.phase === 'loading' && (
              <div className="status-line">
                <LoaderCircle className="spin" size={18} />
                <span>Translating image...</span>
              </div>
            )}
            {props.phase === 'error' && (
              <div className="status-line status-error">
                <div className="error-block">
                  <div className="error-copy">
                    <AlertCircle size={17} />
                    <span>{props.error}</span>
                  </div>
                  <button
                    className="command"
                    type="button"
                    disabled={!props.canRetry}
                    onClick={props.onRetry}
                  >
                    <RefreshCw size={14} />
                    Retry
                  </button>
                </div>
              </div>
            )}
            {props.phase === 'empty' && (
              <div className="status-line">No readable text found in this image.</div>
            )}
            {props.phase === 'success' && (
              <>
                <p className="preview-meta">
                  <span className="preview-label">Translated text</span>
                  {props.sourceLanguage && (
                    <span className="source-language">From {props.sourceLanguage}</span>
                  )}
                </p>
                <p className="preview-text">{props.translation}</p>
              </>
            )}
          </div>

          <footer className="popover-footer">
            <button className="command" type="button" onClick={props.onClose}>
              {props.phase === 'capturing' || props.phase === 'loading' ? 'Cancel' : 'Close'}
            </button>
            {props.phase === 'success' && (
              <button className="command command-primary" type="button" onClick={props.onCopy}>
                {props.copied ? <Check size={14} /> : <Copy size={14} />}
                {props.copied ? 'Copied' : 'Copy'}
              </button>
            )}
          </footer>
        </section>
      )}
    </div>
  );
}

function readableError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Image translation failed.';
}

function waitForPaint(document: Document): Promise<void> {
  const view = document.defaultView;
  if (!view?.requestAnimationFrame) {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  return new Promise((resolve) => {
    view.requestAnimationFrame(() => view.requestAnimationFrame(() => resolve()));
  });
}

export class ImageTranslator {
  private readonly host: HTMLDivElement;
  private readonly root: Root;
  private readonly mutationObserver: MutationObserver;
  private enabled = false;
  private image?: HTMLImageElement;
  private open = false;
  private phase: ImageTranslationPhase = 'idle';
  private target: TargetLanguage = { ...DEFAULT_WRITING_TARGET };
  private imageDataUrl?: string;
  private translation = '';
  private sourceLanguage = '';
  private error = '';
  private copied = false;
  private requestSequence = 0;
  private activeCaptureId?: string;
  private activeRequestId?: string;
  private cooldownUntil = 0;
  private cooldownTimer?: ReturnType<typeof setTimeout>;
  private copiedTimer?: ReturnType<typeof setTimeout>;
  private position: ImageAnchorPosition = {
    iconLeft: 8,
    iconTop: 8,
    popoverLeft: 8,
    popoverTop: 46,
  };

  private readonly handlePointerMove = (event: PointerEvent) => {
    const path = event.composedPath();
    if (path.includes(this.host) || this.open) return;
    const image = findEligibleImage(path, this.document.defaultView);
    if (image) this.setImage(image);
    else this.clearImage();
  };

  private readonly handleFocusIn = (event: FocusEvent) => {
    const path = event.composedPath();
    if (path.includes(this.host) || this.open) return;
    const image = findEligibleImage(path, this.document.defaultView);
    if (image) this.setImage(image);
    else this.clearImage();
  };

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !this.open) return;
    event.preventDefault();
    event.stopPropagation();
    this.close();
  };

  private readonly handleViewportChange = () => {
    if (!this.image) return;
    if (!isEligibleImage(this.image, this.document.defaultView)) {
      this.clearImage();
      return;
    }
    this.updatePosition();
    this.render();
  };

  constructor(private readonly document: Document) {
    this.host = document.createElement('div');
    this.host.setAttribute('data-fast-ai-translator', 'image-ui');
    Object.assign(this.host.style, {
      all: 'initial',
      position: 'fixed',
      inset: '0',
      zIndex: '2147483646',
      pointerEvents: 'none',
    });
    const shadow = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = IMAGE_UI_CSS;
    const mount = document.createElement('div');
    shadow.append(style, mount);
    (document.documentElement ?? document.body).append(this.host);
    this.root = createRoot(mount);
    this.mutationObserver = new MutationObserver(() => {
      if (this.image && !this.image.isConnected) this.clearImage();
    });
    this.render();
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (enabled) {
      this.document.addEventListener('pointermove', this.handlePointerMove, true);
      this.document.addEventListener('focusin', this.handleFocusIn, true);
      this.document.addEventListener('keydown', this.handleKeyDown, true);
      this.document.addEventListener('scroll', this.handleViewportChange, true);
      this.document.defaultView?.addEventListener('resize', this.handleViewportChange);
      this.observeMutations();
    } else {
      this.document.removeEventListener('pointermove', this.handlePointerMove, true);
      this.document.removeEventListener('focusin', this.handleFocusIn, true);
      this.document.removeEventListener('keydown', this.handleKeyDown, true);
      this.document.removeEventListener('scroll', this.handleViewportChange, true);
      this.document.defaultView?.removeEventListener('resize', this.handleViewportChange);
      this.mutationObserver.disconnect();
      this.clearImage();
    }
    this.render();
  }

  destroy(): void {
    this.setEnabled(false);
    if (this.cooldownTimer) clearTimeout(this.cooldownTimer);
    if (this.copiedTimer) clearTimeout(this.copiedTimer);
    this.root.unmount();
    this.host.remove();
  }

  private setImage(image: HTMLImageElement): void {
    if (this.image === image) {
      this.updatePosition();
      return;
    }
    this.resetRequestState();
    this.image = image;
    this.observeMutations();
    this.updatePosition();
    this.render();
  }

  private clearImage(): void {
    if (!this.image && !this.open) return;
    this.cancelActiveRequest();
    this.activeCaptureId = undefined;
    this.image = undefined;
    this.open = false;
    this.resetRequestState();
    this.observeMutations();
    this.host.style.visibility = '';
    this.render();
  }

  private observeMutations(): void {
    this.mutationObserver.disconnect();
    if (!this.enabled) return;
    this.mutationObserver.observe(this.document, { childList: true, subtree: true });
    const root = this.image?.getRootNode();
    if (root instanceof ShadowRoot) {
      this.mutationObserver.observe(root, { childList: true, subtree: true });
    }
  }

  private resetRequestState(): void {
    this.cancelActiveRequest();
    this.activeCaptureId = undefined;
    this.open = false;
    this.phase = 'idle';
    this.imageDataUrl = undefined;
    this.translation = '';
    this.sourceLanguage = '';
    this.error = '';
    this.copied = false;
  }

  private updatePosition(): void {
    if (!this.image) return;
    const view = this.document.defaultView;
    const rect = this.image.getBoundingClientRect();
    const viewportWidth = Math.max(1, view?.innerWidth ?? 1);
    const viewportHeight = Math.max(1, view?.innerHeight ?? 1);
    const iconLeft = Math.max(8, Math.min(viewportWidth - 38, rect.right - 38));
    const iconTop = Math.max(8, Math.min(viewportHeight - 38, rect.top + 8));
    const popoverWidth = Math.min(400, viewportWidth - 16);
    const popoverLeft = Math.max(
      8,
      Math.min(viewportWidth - popoverWidth - 8, rect.right - popoverWidth),
    );
    const roomBelow = viewportHeight - (iconTop + 38);
    this.position = {
      iconLeft,
      iconTop,
      popoverLeft,
      ...(roomBelow >= 260
        ? { popoverTop: Math.max(8, iconTop + 38) }
        : { popoverBottom: Math.max(8, viewportHeight - iconTop + 8) }),
    };
  }

  private openTranslator = (): void => {
    if (!this.image || !isEligibleImage(this.image, this.document.defaultView)) return;
    if (this.open) return;
    this.open = true;
    this.phase = 'capturing';
    this.translation = '';
    this.sourceLanguage = '';
    this.error = '';
    this.copied = false;
    this.render();
    void this.captureImage(this.image);
  };

  private async captureImage(image: HTMLImageElement): Promise<void> {
    const requestId = `image-capture-${Date.now().toString(36)}-${this.requestSequence++}`;
    this.activeCaptureId = requestId;
    this.phase = 'capturing';
    this.imageDataUrl = undefined;
    this.error = '';
    this.render();
    this.host.style.visibility = 'hidden';

    try {
      await waitForPaint(this.document);
      if (this.activeCaptureId !== requestId || this.image !== image) return;
      const rect = image.getBoundingClientRect();
      const response = (await browser.runtime.sendMessage({
        type: 'CAPTURE_IMAGE',
        payload: {
          requestId,
          area: {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            viewportWidth: Math.max(1, this.document.defaultView?.innerWidth ?? 1),
            viewportHeight: Math.max(1, this.document.defaultView?.innerHeight ?? 1),
          },
        },
      })) as ImageCaptureResponse;
      if (this.activeCaptureId !== requestId || this.image !== image) return;
      this.activeCaptureId = undefined;
      if (response.error || !response.imageDataUrl) {
        this.phase = 'error';
        this.error = response.error?.message ?? 'The image could not be captured.';
        return;
      }
      this.imageDataUrl = response.imageDataUrl;
      void this.requestTranslation();
    } catch (error) {
      if (this.activeCaptureId !== requestId) return;
      this.activeCaptureId = undefined;
      this.phase = 'error';
      this.error = readableError(error);
    } finally {
      this.host.style.visibility = '';
      this.render();
    }
  }

  private async requestTranslation(): Promise<void> {
    if (!this.imageDataUrl) return;
    if (Date.now() < this.cooldownUntil) {
      this.phase = 'error';
      this.error = 'The provider is cooling down after a rate limit. Try again shortly.';
      this.render();
      return;
    }
    this.cancelActiveRequest();
    const requestId = `image-${Date.now().toString(36)}-${this.requestSequence++}`;
    this.activeRequestId = requestId;
    this.phase = 'loading';
    this.translation = '';
    this.sourceLanguage = '';
    this.error = '';
    this.copied = false;
    this.render();

    try {
      const response = (await browser.runtime.sendMessage({
        type: 'TRANSLATE_IMAGE',
        payload: {
          requestId,
          imageDataUrl: this.imageDataUrl,
          targetLanguage: this.target,
        },
      })) as ImageTranslationResponse;
      if (this.activeRequestId !== requestId) return;
      this.activeRequestId = undefined;
      if (response.error) {
        this.phase = 'error';
        this.error =
          response.error.code === 'TIMEOUT'
            ? 'Image translation took longer than 45 seconds. Retry, or select gpt-5.6-luna as the image model in Settings.'
            : response.error.message;
        if (response.error.code === 'RATE_LIMITED') {
          this.startCooldown(response.error.retryAfterMs ?? 500);
        }
      } else if (!response.hasText || !response.translation) {
        this.phase = 'empty';
      } else {
        this.phase = 'success';
        this.translation = response.translation;
        this.sourceLanguage = response.sourceLanguage ?? '';
      }
    } catch (error) {
      if (this.activeRequestId !== requestId) return;
      this.activeRequestId = undefined;
      this.phase = 'error';
      this.error = readableError(error);
    }
    this.render();
  }

  private startCooldown(inputMs: number): void {
    const delay = Math.min(10_000, Math.max(500, inputMs));
    this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + delay);
    if (this.cooldownTimer) clearTimeout(this.cooldownTimer);
    this.cooldownTimer = setTimeout(() => {
      this.cooldownTimer = undefined;
      this.cooldownUntil = 0;
      this.render();
    }, delay);
  }

  private cancelActiveRequest(): void {
    const requestId = this.activeRequestId;
    if (!requestId) return;
    this.activeRequestId = undefined;
    void browser.runtime
      .sendMessage({ type: 'CANCEL_IMAGE_TRANSLATION', requestId })
      .catch(() => undefined);
  }

  private retry = (): void => {
    if (Date.now() < this.cooldownUntil) return;
    if (this.imageDataUrl) void this.requestTranslation();
    else if (this.image) void this.captureImage(this.image);
  };

  private selectTarget = (input: TargetLanguage): void => {
    const target = validateTargetLanguage(input);
    if (!target) return;
    this.target = target;
    if (this.open && this.imageDataUrl) void this.requestTranslation();
    else this.render();
  };

  private copy = (): void => {
    if (!this.translation) return;
    void this.copyTranslation();
  };

  private async copyTranslation(): Promise<void> {
    const fallbackCopy = () => {
      const textarea = this.document.createElement('textarea');
      textarea.setAttribute('data-fast-ai-translator', 'copy-helper');
      textarea.value = this.translation;
      Object.assign(textarea.style, { position: 'fixed', opacity: '0', pointerEvents: 'none' });
      this.document.body.append(textarea);
      textarea.select();
      try {
        const execCommand = this.document.execCommand;
        return typeof execCommand === 'function' && execCommand.call(this.document, 'copy');
      } finally {
        textarea.remove();
      }
    };

    let copied = false;
    try {
      const writeText = this.document.defaultView?.navigator.clipboard?.writeText;
      if (writeText) {
        await writeText.call(this.document.defaultView?.navigator.clipboard, this.translation);
        copied = true;
      } else {
        copied = fallbackCopy();
      }
    } catch {
      copied = fallbackCopy();
    }
    if (!copied) return;
    this.copied = copied;
    if (this.copiedTimer) clearTimeout(this.copiedTimer);
    this.copiedTimer = setTimeout(() => {
      this.copiedTimer = undefined;
      this.copied = false;
      this.render();
    }, 1_500);
    this.render();
  }

  private close = (): void => {
    this.cancelActiveRequest();
    this.activeCaptureId = undefined;
    this.open = false;
    this.phase = 'idle';
    this.imageDataUrl = undefined;
    this.translation = '';
    this.sourceLanguage = '';
    this.error = '';
    this.copied = false;
    this.host.style.visibility = '';
    this.updatePosition();
    this.render();
  };

  private render(): void {
    this.root.render(
      <ImageTranslatorView
        visible={this.enabled && Boolean(this.image)}
        open={this.open}
        phase={this.phase}
        position={this.position}
        target={this.target}
        translation={this.translation}
        sourceLanguage={this.sourceLanguage}
        error={this.error}
        canRetry={Date.now() >= this.cooldownUntil}
        copied={this.copied}
        onOpen={this.openTranslator}
        onClose={this.close}
        onRetry={this.retry}
        onCopy={this.copy}
        onTarget={this.selectTarget}
      />,
    );
  }
}
