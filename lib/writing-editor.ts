import { MAX_DRAFT_CHARACTERS } from './constants';

export type WritingEditor = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

export interface DraftSnapshot {
  editor: WritingEditor;
  kind: 'control' | 'contenteditable';
  draft: string;
  source: string;
  start: number;
  end: number;
  range?: Range;
  rangeText?: string;
}

export interface DraftReplacementResult {
  ok: boolean;
  error?: string;
}

const CODE_EDITOR_SELECTOR = [
  'code',
  'pre',
  '.CodeMirror',
  '.cm-editor',
  '.monaco-editor',
  '.ace_editor',
  '[data-code-editor]',
  '[role="code"]',
  '[class*="code-editor" i]',
].join(',');

function composedParent(element: Element): Element | null {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

function hasComposedAncestor(element: Element, selector: string): boolean {
  let current: Element | null = element;
  while (current) {
    if (current.matches(selector)) return true;
    current = composedParent(current);
  }
  return false;
}

function isOneTimeCodeInput(input: HTMLInputElement): boolean {
  const identifyingText = [
    input.name,
    input.id,
    input.getAttribute('aria-label') ?? '',
    input.placeholder,
  ].join(' ');
  return (
    input.autocomplete.toLowerCase() === 'one-time-code' ||
    /^(?:numeric|decimal|tel)$/i.test(input.inputMode) ||
    /(?:\botp\b|one[ -]?time|verification code|security code|passcode|\bpin\b)/i.test(
      identifyingText,
    )
  );
}

function isExplicitContentEditor(element: Element): element is HTMLElement {
  const contentEditable = element.getAttribute('contenteditable');
  if (contentEditable?.toLowerCase() === 'false') return false;
  return (
    contentEditable !== null ||
    element.getAttribute('role')?.toLowerCase() === 'textbox'
  );
}

export function readEditorText(editor: WritingEditor): string {
  if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) {
    return editor.value;
  }
  return typeof editor.innerText === 'string' ? editor.innerText : (editor.textContent ?? '');
}

export function isEligibleWritingEditor(element: Element): element is WritingEditor {
  if (
    !element.isConnected ||
    hasComposedAncestor(element, '[data-fast-ai-translator], [inert], [aria-hidden="true"]') ||
    hasComposedAncestor(element, CODE_EDITOR_SELECTOR)
  ) {
    return false;
  }

  let editor: WritingEditor;
  if (element instanceof HTMLInputElement) {
    const type = (element.getAttribute('type') ?? 'text').toLowerCase();
    if (!/^(?:text|search)$/.test(type) || element.disabled || element.readOnly) return false;
    if (isOneTimeCodeInput(element)) return false;
    editor = element;
  } else if (element instanceof HTMLTextAreaElement) {
    if (element.disabled || element.readOnly) return false;
    editor = element;
  } else if (isExplicitContentEditor(element)) {
    if (
      element.getAttribute('aria-disabled')?.toLowerCase() === 'true' ||
      element.getAttribute('aria-readonly')?.toLowerCase() === 'true'
    ) {
      return false;
    }
    editor = element;
  } else {
    return false;
  }

  return readEditorText(editor).length <= MAX_DRAFT_CHARACTERS;
}

export function findWritingEditor(path: readonly EventTarget[]): WritingEditor | undefined {
  for (const target of path) {
    if (target instanceof Element && isEligibleWritingEditor(target)) return target;
  }
  return undefined;
}

function selectionForEditor(editor: HTMLElement): Selection | null {
  const root = editor.getRootNode() as ShadowRoot & { getSelection?: () => Selection | null };
  return root.getSelection?.() ?? editor.ownerDocument.getSelection();
}

export function captureDraftSnapshot(editor: WritingEditor): DraftSnapshot | undefined {
  if (!isEligibleWritingEditor(editor)) return undefined;
  const draft = readEditorText(editor);
  if (!draft.trim() || draft.length > MAX_DRAFT_CHARACTERS) return undefined;

  if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) {
    const selectionStart = editor.selectionStart ?? 0;
    const selectionEnd = editor.selectionEnd ?? selectionStart;
    const selected = draft.slice(selectionStart, selectionEnd);
    const useSelection = selectionEnd > selectionStart && Boolean(selected.trim());
    return {
      editor,
      kind: 'control',
      draft,
      source: useSelection ? selected : draft,
      start: useSelection ? selectionStart : 0,
      end: useSelection ? selectionEnd : draft.length,
    };
  }

  const selection = selectionForEditor(editor);
  const selectedRange = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
  const selectionInside = Boolean(
    selectedRange &&
      !selectedRange.collapsed &&
      editor.contains(selectedRange.commonAncestorContainer),
  );
  const selected = selectionInside ? selectedRange?.toString() ?? '' : '';
  if (selectionInside && selected.trim() && selectedRange) {
    return {
      editor,
      kind: 'contenteditable',
      draft,
      source: selected,
      start: 0,
      end: selected.length,
      range: selectedRange.cloneRange(),
      rangeText: selectedRange.toString(),
    };
  }

  const range = editor.ownerDocument.createRange();
  range.selectNodeContents(editor);
  return {
    editor,
    kind: 'contenteditable',
    draft,
    source: draft,
    start: 0,
    end: draft.length,
    range,
    rangeText: range.toString(),
  };
}

function inputEvent(
  document: Document,
  type: 'beforeinput' | 'input',
  translation: string,
  cancelable: boolean,
): Event {
  const view = document.defaultView;
  try {
    return new (view?.InputEvent ?? InputEvent)(type, {
      bubbles: true,
      cancelable,
      composed: true,
      data: translation,
      inputType: 'insertReplacementText',
    });
  } catch {
    const event = new (view?.Event ?? Event)(type, { bubbles: true, cancelable, composed: true });
    Object.defineProperties(event, {
      data: { value: translation },
      inputType: { value: 'insertReplacementText' },
    });
    return event;
  }
}

function setNativeValue(editor: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  let prototype: object | null = Object.getPrototypeOf(editor);
  while (prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (descriptor?.set) {
      descriptor.set.call(editor, value);
      return;
    }
    prototype = Object.getPrototypeOf(prototype);
  }
  editor.value = value;
}

function staleResult(): DraftReplacementResult {
  return { ok: false, error: 'The draft changed. Translate it again before replacing text.' };
}

export function isDraftSnapshotCurrent(snapshot: DraftSnapshot): boolean {
  const { editor } = snapshot;
  if (!editor.isConnected || readEditorText(editor) !== snapshot.draft) return false;
  if (snapshot.kind === 'control') {
    return snapshot.draft.slice(snapshot.start, snapshot.end) === snapshot.source;
  }
  return Boolean(
    snapshot.range &&
      editor.contains(snapshot.range.commonAncestorContainer) &&
      snapshot.range.toString() === snapshot.rangeText,
  );
}

export function replaceDraftSnapshot(
  snapshot: DraftSnapshot,
  translation: string,
): DraftReplacementResult {
  const { editor } = snapshot;
  if (!translation.trim() || !isDraftSnapshotCurrent(snapshot)) return staleResult();

  const beforeInput = inputEvent(editor.ownerDocument, 'beforeinput', translation, true);
  if (!editor.dispatchEvent(beforeInput)) {
    return { ok: false, error: 'The editor prevented this replacement.' };
  }

  if (snapshot.kind === 'control') {
    const control = editor as HTMLInputElement | HTMLTextAreaElement;
    const nextValue = `${snapshot.draft.slice(0, snapshot.start)}${translation}${snapshot.draft.slice(snapshot.end)}`;
    setNativeValue(control, nextValue);
    control.focus({ preventScroll: true });
    const caret = snapshot.start + translation.length;
    control.setSelectionRange(caret, caret);
  } else {
    const range = snapshot.range!;
    range.deleteContents();
    const node = editor.ownerDocument.createTextNode(translation);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    editor.focus({ preventScroll: true });
    const selection = selectionForEditor(editor as HTMLElement);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  editor.dispatchEvent(inputEvent(editor.ownerDocument, 'input', translation, false));
  return { ok: true };
}
