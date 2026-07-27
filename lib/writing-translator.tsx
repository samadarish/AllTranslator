import {
  AlertCircle,
  Languages,
  LoaderCircle,
  RefreshCw,
  X,
} from 'lucide-react';
import { type CSSProperties } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { browser } from 'wxt/browser';
import type { DraftTranslationResponse, TargetLanguage } from './types';
import {
  captureDraftSnapshot,
  findWritingEditor,
  isDraftSnapshotCurrent,
  isEligibleWritingEditor,
  replaceDraftSnapshot,
  type DraftSnapshot,
  type WritingEditor,
} from './writing-editor';
import {
  DEFAULT_WRITING_TARGET,
  validateTargetLanguage,
} from './writing-languages';
import { loadWritingTarget, rememberWritingTarget } from './writing-preferences';
import { TargetLanguagePicker } from './target-language-picker';

type TranslationPhase = 'idle' | 'loading' | 'success' | 'error';

interface AnchorPosition {
  iconLeft: number;
  iconTop: number;
  popoverLeft: number;
  popoverTop?: number;
  popoverBottom?: number;
}

interface WritingTranslatorViewProps {
  visible: boolean;
  open: boolean;
  phase: TranslationPhase;
  position: AnchorPosition;
  target: TargetLanguage;
  preview: string;
  error: string;
  translatingSelection: boolean;
  onOpen: () => void;
  onClose: () => void;
  onRetry: () => void;
  onReplace: () => void;
  onTarget: (target: TargetLanguage) => void;
}

const WRITING_UI_CSS = `
:host {
  all: initial;
  color: #17201e;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  letter-spacing: 0;
}
* { box-sizing: border-box; }
button, input { font: inherit; letter-spacing: 0; }
button { cursor: pointer; }
.writing-shell { position: fixed; inset: 0; pointer-events: none; }
.writing-button {
  position: fixed;
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border: 1px solid #c8d2ce;
  border-radius: 7px;
  color: #fff;
  background: #183b36;
  box-shadow: 0 3px 12px rgb(20 31 28 / 22%);
  pointer-events: auto;
}
.writing-button:hover { background: #24564e; }
.writing-button:focus-visible,
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
  width: min(390px, calc(100vw - 16px));
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
  min-height: 148px;
  overflow: auto;
  padding: 14px;
  font-size: 13px;
  line-height: 1.5;
}
.preview-label { margin: 0 0 8px; color: #697570; font-size: 10px; font-weight: 700; text-transform: uppercase; }
.preview-text { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.status-line { display: flex; min-height: 100px; align-items: center; justify-content: center; gap: 8px; color: #5e6a66; text-align: center; }
.status-error { align-items: flex-start; color: #96372f; }
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
.spin { animation: writing-spin 850ms linear infinite; }
@keyframes writing-spin { to { transform: rotate(360deg); } }
@media (max-width: 440px) {
  .popover { width: calc(100vw - 16px); }
}
`;

function WritingTranslatorView(props: WritingTranslatorViewProps) {
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
    <div className="writing-shell">
      <button
        className="writing-button"
        type="button"
        style={iconStyle}
        title="Translate writing"
        aria-label="Translate writing"
        onPointerDown={(event) => event.preventDefault()}
        onClick={props.onOpen}
      >
        <Languages size={17} />
      </button>

      {props.open && (
        <section
          className="popover"
          style={popoverStyle}
          role="dialog"
          aria-label="Writing translator"
        >
          <header className="popover-header">
            <TargetLanguagePicker target={props.target} onTarget={props.onTarget} />
            <button
              className="icon-button"
              type="button"
              title="Close"
              aria-label="Close writing translator"
              onClick={props.onClose}
            >
              <X size={17} />
            </button>
          </header>

          <div className="preview-area" aria-live="polite">
            {props.phase === 'loading' && (
              <div className="status-line">
                <LoaderCircle className="spin" size={18} />
                <span>Translating...</span>
              </div>
            )}
            {props.phase === 'error' && (
              <div className="status-line status-error">
                <div className="error-block">
                  <div className="error-copy">
                    <AlertCircle size={17} />
                    <span>{props.error}</span>
                  </div>
                  <button className="command" type="button" onClick={props.onRetry}>
                    <RefreshCw size={14} />
                    Retry
                  </button>
                </div>
              </div>
            )}
            {props.phase === 'success' && (
              <>
                <p className="preview-label">
                  {props.translatingSelection ? 'Selected text' : 'Complete draft'}
                </p>
                <p className="preview-text">{props.preview}</p>
              </>
            )}
          </div>

          <footer className="popover-footer">
            <button className="command" type="button" onClick={props.onClose}>Cancel</button>
            <button
              className="command command-primary"
              type="button"
              disabled={props.phase !== 'success'}
              onClick={props.onReplace}
            >
              Replace
            </button>
          </footer>
        </section>
      )}
    </div>
  );
}

function eventPathFromElement(element: Element): EventTarget[] {
  const path: EventTarget[] = [];
  let current: Element | null = element;
  while (current) {
    path.push(current);
    if (current.parentElement) current = current.parentElement;
    else {
      const root = current.getRootNode();
      current = root instanceof ShadowRoot ? root.host : null;
    }
  }
  return path;
}

function deepestActiveElement(document: Document): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

function readableError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Writing translation failed.';
}

export class WritingTranslator {
  private readonly host: HTMLDivElement;
  private readonly root: Root;
  private enabled = false;
  private editor?: WritingEditor;
  private snapshot?: DraftSnapshot;
  private open = false;
  private phase: TranslationPhase = 'idle';
  private target: TargetLanguage = { ...DEFAULT_WRITING_TARGET };
  private preview = '';
  private error = '';
  private requestSequence = 0;
  private activeRequestId?: string;
  private targetTouched = false;
  private position: AnchorPosition = { iconLeft: 8, iconTop: 8, popoverLeft: 8, popoverTop: 48 };

  private readonly handleFocusIn = (event: FocusEvent) => {
    const path = event.composedPath();
    if (path.includes(this.host)) return;
    const editor = findWritingEditor(path);
    if (editor) this.setEditor(editor);
    else this.clearEditor();
  };

  private readonly handlePointerDown = (event: PointerEvent) => {
    const path = event.composedPath();
    if (path.includes(this.host)) return;
    const editor = findWritingEditor(path);
    if (editor) this.setEditor(editor);
    else this.clearEditor();
  };

  private readonly handleInput = (event: Event) => {
    if (!this.editor || !event.composedPath().includes(this.editor)) return;
    if (!isEligibleWritingEditor(this.editor)) {
      this.clearEditor();
      return;
    }
    if (this.open && this.snapshot && !isDraftSnapshotCurrent(this.snapshot)) {
      this.cancelActiveRequest();
      this.phase = 'error';
      this.preview = '';
      this.error = 'The draft changed. Translate it again before replacing text.';
    }
    this.updatePosition();
    this.render();
  };

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.open) {
      event.preventDefault();
      this.close();
      return;
    }
    if (
      event.key === 'Enter' &&
      event.altKey &&
      event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      const editor = findWritingEditor(event.composedPath()) ?? this.editor;
      if (!editor || !isEligibleWritingEditor(editor)) return;
      event.preventDefault();
      event.stopPropagation();
      this.setEditor(editor);
      if (!this.open) {
        this.openTranslator();
      } else if (this.phase === 'success') {
        this.replace();
      } else if (this.phase === 'error') {
        this.retry();
      }
    }
  };

  private readonly handleViewportChange = () => {
    if (!this.editor) return;
    this.updatePosition();
    this.render();
  };

  constructor(private readonly document: Document) {
    this.host = document.createElement('div');
    this.host.setAttribute('data-fast-ai-translator', 'writing-ui');
    Object.assign(this.host.style, {
      all: 'initial',
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      pointerEvents: 'none',
    });
    const shadow = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = WRITING_UI_CSS;
    const mount = document.createElement('div');
    shadow.append(style, mount);
    (document.documentElement ?? document.body).append(this.host);
    this.root = createRoot(mount);
    this.render();
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (enabled) {
      this.document.addEventListener('focusin', this.handleFocusIn, true);
      this.document.addEventListener('pointerdown', this.handlePointerDown, true);
      this.document.addEventListener('input', this.handleInput, true);
      this.document.addEventListener('keydown', this.handleKeyDown, true);
      this.document.addEventListener('scroll', this.handleViewportChange, true);
      this.document.defaultView?.addEventListener('resize', this.handleViewportChange);
      const active = deepestActiveElement(this.document);
      const editor = active ? findWritingEditor(eventPathFromElement(active)) : undefined;
      if (editor) this.setEditor(editor);
      void this.loadRememberedTarget();
    } else {
      this.document.removeEventListener('focusin', this.handleFocusIn, true);
      this.document.removeEventListener('pointerdown', this.handlePointerDown, true);
      this.document.removeEventListener('input', this.handleInput, true);
      this.document.removeEventListener('keydown', this.handleKeyDown, true);
      this.document.removeEventListener('scroll', this.handleViewportChange, true);
      this.document.defaultView?.removeEventListener('resize', this.handleViewportChange);
      this.clearEditor();
    }
    this.render();
  }

  destroy(): void {
    this.setEnabled(false);
    this.root.unmount();
    this.host.remove();
  }

  private async loadRememberedTarget(): Promise<void> {
    try {
      const target = await loadWritingTarget(this.document.location.hostname);
      if (target && !this.targetTouched) {
        this.target = target;
        this.render();
      }
    } catch {
      // A storage failure should not disable the writing translator.
    }
  }

  private setEditor(editor: WritingEditor): void {
    if (this.editor !== editor) {
      this.cancelActiveRequest();
      this.open = false;
      this.phase = 'idle';
      this.preview = '';
      this.error = '';
      this.snapshot = undefined;
      this.editor = editor;
    }
    this.updatePosition();
    this.render();
  }

  private clearEditor(): void {
    this.cancelActiveRequest();
    this.editor = undefined;
    this.snapshot = undefined;
    this.open = false;
    this.phase = 'idle';
    this.preview = '';
    this.error = '';
    this.render();
  }

  private updatePosition(): void {
    if (!this.editor) return;
    const view = this.document.defaultView;
    const rect = this.editor.getBoundingClientRect();
    const viewportWidth = Math.max(1, view?.innerWidth ?? 1);
    const viewportHeight = Math.max(1, view?.innerHeight ?? 1);
    const iconLeft = Math.max(
      8,
      Math.min(viewportWidth - 40, rect.right + 38 <= viewportWidth ? rect.right + 6 : rect.right - 38),
    );
    const iconTop = Math.max(8, Math.min(viewportHeight - 40, rect.top + Math.max(0, (rect.height - 32) / 2)));
    const popoverWidth = Math.min(390, viewportWidth - 16);
    const popoverLeft = Math.max(8, Math.min(viewportWidth - popoverWidth - 8, iconLeft));
    const roomBelow = viewportHeight - rect.bottom;
    this.position = {
      iconLeft,
      iconTop,
      popoverLeft,
      ...(roomBelow >= 280
        ? { popoverTop: Math.max(8, rect.bottom + 8) }
        : { popoverBottom: Math.max(8, viewportHeight - rect.top + 8) }),
    };
  }

  private openTranslator = (): void => {
    if (!this.editor || !isEligibleWritingEditor(this.editor)) return;
    this.open = true;
    const snapshot = captureDraftSnapshot(this.editor);
    if (!snapshot) {
      this.snapshot = undefined;
      this.phase = 'error';
      this.error = 'Enter text to translate.';
      this.preview = '';
      this.render();
      return;
    }
    this.snapshot = snapshot;
    void this.requestTranslation(snapshot);
  };

  private retry = (): void => {
    if (!this.editor) return;
    const snapshot =
      this.snapshot && isDraftSnapshotCurrent(this.snapshot)
        ? this.snapshot
        : captureDraftSnapshot(this.editor);
    if (!snapshot) {
      this.phase = 'error';
      this.error = 'Enter text to translate.';
      this.render();
      return;
    }
    this.snapshot = snapshot;
    void this.requestTranslation(snapshot);
  };

  private selectTarget = (input: TargetLanguage): void => {
    const target = validateTargetLanguage(input);
    if (!target) return;
    this.target = target;
    this.targetTouched = true;
    void rememberWritingTarget(this.document.location.hostname, target).catch(() => undefined);
    if (this.editor) {
      const snapshot =
        this.snapshot && isDraftSnapshotCurrent(this.snapshot)
          ? this.snapshot
          : captureDraftSnapshot(this.editor);
      if (snapshot) {
        this.snapshot = snapshot;
        void this.requestTranslation(snapshot);
      }
    }
    this.render();
  };

  private async requestTranslation(snapshot: DraftSnapshot): Promise<void> {
    this.cancelActiveRequest();
    const requestId = `writing-${Date.now().toString(36)}-${this.requestSequence++}`;
    this.activeRequestId = requestId;
    this.phase = 'loading';
    this.preview = '';
    this.error = '';
    this.render();
    try {
      const response = (await browser.runtime.sendMessage({
        type: 'TRANSLATE_DRAFT',
        payload: {
          requestId,
          text: snapshot.source,
          targetLanguage: this.target,
        },
      })) as DraftTranslationResponse;
      if (this.activeRequestId !== requestId) return;
      this.activeRequestId = undefined;
      if (response.error || !response.translation) {
        this.phase = 'error';
        this.error = response.error?.message ?? 'The provider returned an empty translation.';
      } else {
        this.phase = 'success';
        this.preview = response.translation;
      }
    } catch (error) {
      if (this.activeRequestId !== requestId) return;
      this.activeRequestId = undefined;
      this.phase = 'error';
      this.error = readableError(error);
    }
    this.render();
  }

  private cancelActiveRequest(): void {
    const requestId = this.activeRequestId;
    if (!requestId) return;
    this.activeRequestId = undefined;
    void browser.runtime.sendMessage({
      type: 'CANCEL_DRAFT_TRANSLATION',
      requestId,
    }).catch(() => undefined);
  }

  private replace = (): void => {
    if (!this.snapshot || this.phase !== 'success') return;
    const result = replaceDraftSnapshot(this.snapshot, this.preview);
    if (!result.ok) {
      this.phase = 'error';
      this.preview = '';
      this.error = result.error ?? 'The draft could not be replaced.';
      this.render();
      return;
    }
    this.close();
  };

  private close = (): void => {
    this.cancelActiveRequest();
    this.open = false;
    this.phase = 'idle';
    this.preview = '';
    this.error = '';
    this.snapshot = undefined;
    this.editor?.focus({ preventScroll: true });
    this.updatePosition();
    this.render();
  };

  private render(): void {
    const translatingSelection = Boolean(
      this.snapshot &&
        (this.snapshot.start !== 0 || this.snapshot.end !== this.snapshot.draft.length),
    );
    this.root.render(
      <WritingTranslatorView
        visible={this.enabled && Boolean(this.editor)}
        open={this.open}
        phase={this.phase}
        position={this.position}
        target={this.target}
        preview={this.preview}
        error={this.error}
        translatingSelection={translatingSelection}
        onOpen={this.openTranslator}
        onClose={this.close}
        onRetry={this.retry}
        onReplace={this.replace}
        onTarget={this.selectTarget}
      />,
    );
  }
}
