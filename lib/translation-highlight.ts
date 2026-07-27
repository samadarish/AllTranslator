import {
  currentCandidateValue,
  originalCandidateValue,
  type TranslationCandidate,
} from './extractor';

export const TRANSLATION_HIGHLIGHT_DURATION_MS = 1_200;
export const TRANSLATION_HIGHLIGHT_COLOR = '#78c850';
export const TRANSLATION_PENDING_COLOR = '#ff3b30';
export const TRANSLATION_PENDING_PULSE_DURATION_MS = 900;

const OWNER_ATTRIBUTE = 'data-fast-ai-translator';
const SUCCESS_MARKER_ATTRIBUTE = 'data-fast-ai-translator-highlight';
const PENDING_MARKER_ATTRIBUTE = 'data-fast-ai-translator-pending';

interface HighlightApiScope {
  CSS?: {
    highlights?: HighlightRegistry;
  };
  Highlight?: new (...ranges: AbstractRange[]) => Highlight;
}

interface TextFeedback {
  kind: 'text';
  range: Range;
  timer?: ReturnType<typeof setTimeout>;
}

interface AttributeFeedback {
  kind: 'attribute';
  element: Element;
  timer?: ReturnType<typeof setTimeout>;
}

type Feedback = TextFeedback | AttributeFeedback;

interface MarkerState {
  owners: Set<TranslationCandidate>;
  hadAttribute: boolean;
  previousValue: string | null;
}

let instanceSequence = 0;

function rootFor(node: Node): Document | ShadowRoot | undefined {
  const root = node.getRootNode();
  if (root.nodeType === Node.DOCUMENT_NODE) return root as Document;
  if (root.nodeType === Node.DOCUMENT_FRAGMENT_NODE && 'host' in root) {
    return root as ShadowRoot;
  }
  return undefined;
}

export class TranslationHighlightFeedback {
  private readonly name = `fast-ai-translator-feedback-${instanceSequence++}`;
  private readonly pendingName = `${this.name}-pending`;
  private readonly pulseName = `${this.name}-pulse`;
  private readonly successFeedback = new Map<TranslationCandidate, Feedback>();
  private readonly pendingFeedback = new Map<TranslationCandidate, Feedback>();
  private readonly successMarkerStates = new Map<Element, MarkerState>();
  private readonly pendingMarkerStates = new Map<Element, MarkerState>();
  private readonly styles = new Map<Document | ShadowRoot, HTMLStyleElement>();
  private registry?: HighlightRegistry;
  private successTextHighlight?: Highlight;
  private pendingTextHighlight?: Highlight;
  private pendingPulseTimer?: ReturnType<typeof setInterval>;
  private pendingTextVisible = true;
  private destroyed = false;

  constructor(
    private readonly document: Document,
    private readonly durationMs = TRANSLATION_HIGHLIGHT_DURATION_MS,
  ) {}

  markPending(candidate: TranslationCandidate): boolean {
    if (
      this.destroyed ||
      candidate.translated ||
      currentCandidateValue(candidate) !== originalCandidateValue(candidate)
    ) {
      return false;
    }
    this.remove(candidate);
    return candidate.target.kind === 'text'
      ? this.markPendingText(candidate)
      : this.markPendingAttribute(candidate);
  }

  flash(candidate: TranslationCandidate): boolean {
    if (this.destroyed || !candidate.translated) return false;
    this.remove(candidate);
    return candidate.target.kind === 'text'
      ? this.flashText(candidate)
      : this.flashAttribute(candidate);
  }

  removePending(candidate: TranslationCandidate): void {
    this.removeFeedback(
      candidate,
      this.pendingFeedback,
      this.pendingMarkerStates,
      PENDING_MARKER_ATTRIBUTE,
      'pending',
    );
  }

  remove(candidate: TranslationCandidate): void {
    this.removeFeedback(
      candidate,
      this.successFeedback,
      this.successMarkerStates,
      SUCCESS_MARKER_ATTRIBUTE,
      'success',
    );
    this.removePending(candidate);
  }

  clear(): void {
    for (const candidate of [
      ...new Set([...this.successFeedback.keys(), ...this.pendingFeedback.keys()]),
    ]) {
      this.remove(candidate);
    }
    this.unregisterTextHighlight('success');
    this.unregisterTextHighlight('pending');
  }

  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    for (const style of this.styles.values()) style.remove();
    this.styles.clear();
    this.destroyed = true;
  }

  private markPendingText(candidate: TranslationCandidate): boolean {
    const node = candidate.target.kind === 'text' ? candidate.target.node : undefined;
    if (!node?.isConnected || node.nodeValue !== originalCandidateValue(candidate)) return false;
    const range = this.addTextRange(candidate, 'pending');
    if (!range) return false;
    this.pendingFeedback.set(candidate, { kind: 'text', range });
    this.startPendingPulse();
    return true;
  }

  private markPendingAttribute(candidate: TranslationCandidate): boolean {
    if (candidate.target.kind !== 'attribute') return false;
    const { element, attribute } = candidate.target;
    if (!element.isConnected || element.getAttribute(attribute) !== originalCandidateValue(candidate)) {
      return false;
    }
    const root = rootFor(element);
    if (!root) return false;
    this.ensureStyle(root);
    this.claimMarker(
      element,
      candidate,
      this.pendingMarkerStates,
      PENDING_MARKER_ATTRIBUTE,
      this.name,
    );
    this.pendingFeedback.set(candidate, { kind: 'attribute', element });
    return true;
  }

  private flashText(candidate: TranslationCandidate): boolean {
    const node = candidate.target.kind === 'text' ? candidate.target.node : undefined;
    if (!node?.isConnected || node.nodeValue !== candidate.translated) return false;
    const range = this.addTextRange(candidate, 'success');
    if (!range) return false;
    const timer = setTimeout(() => this.remove(candidate), this.durationMs);
    this.successFeedback.set(candidate, { kind: 'text', range, timer });
    return true;
  }

  private flashAttribute(candidate: TranslationCandidate): boolean {
    if (candidate.target.kind !== 'attribute') return false;
    const { element, attribute } = candidate.target;
    if (!element.isConnected || element.getAttribute(attribute) !== candidate.translated) {
      return false;
    }
    const root = rootFor(element);
    if (!root) return false;
    this.ensureStyle(root);
    this.claimMarker(
      element,
      candidate,
      this.successMarkerStates,
      SUCCESS_MARKER_ATTRIBUTE,
      this.name,
    );
    const timer = setTimeout(() => this.remove(candidate), this.durationMs);
    this.successFeedback.set(candidate, { kind: 'attribute', element, timer });
    return true;
  }

  private addTextRange(
    candidate: TranslationCandidate,
    kind: 'success' | 'pending',
  ): Range | undefined {
    if (candidate.target.kind !== 'text') return undefined;
    const node = candidate.target.node;
    const api = this.highlightApi();
    if (!api) return undefined;
    const start = Math.min(candidate.prefix.length, node.length);
    const end = Math.max(start, node.length - candidate.suffix.length);
    if (start === end) return undefined;

    let range: Range | undefined;
    try {
      range = this.document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      this.registry = api.registry;
      if (kind === 'success') {
        this.successTextHighlight ??= new api.Highlight();
        this.successTextHighlight.add(range);
        this.registry.set(this.name, this.successTextHighlight);
      } else {
        this.pendingTextHighlight ??= new api.Highlight();
        this.pendingTextHighlight.add(range);
        this.registry.set(this.pendingName, this.pendingTextHighlight);
      }
    } catch {
      if (range) {
        if (kind === 'success') this.successTextHighlight?.delete(range);
        else this.pendingTextHighlight?.delete(range);
      }
      this.unregisterEmptyTextHighlight(kind);
      return undefined;
    }

    const root = rootFor(node);
    if (root) this.ensureStyle(root);
    return range;
  }

  private removeFeedback(
    candidate: TranslationCandidate,
    feedback: Map<TranslationCandidate, Feedback>,
    markerStates: Map<Element, MarkerState>,
    markerAttribute: string,
    kind: 'success' | 'pending',
  ): void {
    const active = feedback.get(candidate);
    if (!active) return;
    if (active.timer) clearTimeout(active.timer);
    feedback.delete(candidate);
    if (active.kind === 'text') {
      if (kind === 'success') this.successTextHighlight?.delete(active.range);
      else this.pendingTextHighlight?.delete(active.range);
      this.unregisterEmptyTextHighlight(kind);
      return;
    }
    this.releaseMarker(active.element, candidate, markerStates, markerAttribute);
  }

  private claimMarker(
    element: Element,
    candidate: TranslationCandidate,
    markerStates: Map<Element, MarkerState>,
    markerAttribute: string,
    markerValue: string,
  ): void {
    let state = markerStates.get(element);
    if (!state) {
      state = {
        owners: new Set(),
        hadAttribute: element.hasAttribute(markerAttribute),
        previousValue: element.getAttribute(markerAttribute),
      };
      markerStates.set(element, state);
      element.setAttribute(markerAttribute, markerValue);
    }
    state.owners.add(candidate);
  }

  private releaseMarker(
    element: Element,
    candidate: TranslationCandidate,
    markerStates: Map<Element, MarkerState>,
    markerAttribute: string,
  ): void {
    const state = markerStates.get(element);
    if (!state) return;
    state.owners.delete(candidate);
    if (state.owners.size > 0) return;
    markerStates.delete(element);
    if (element.getAttribute(markerAttribute) !== this.name) return;
    if (state.hadAttribute) element.setAttribute(markerAttribute, state.previousValue ?? '');
    else element.removeAttribute(markerAttribute);
  }

  private highlightApi():
    | { registry: HighlightRegistry; Highlight: new (...ranges: AbstractRange[]) => Highlight }
    | undefined {
    const viewScope = this.document.defaultView as unknown as HighlightApiScope | null;
    const globalScope = globalThis as unknown as HighlightApiScope;
    const registry = viewScope?.CSS?.highlights ?? globalScope.CSS?.highlights;
    const HighlightConstructor = viewScope?.Highlight ?? globalScope.Highlight;
    if (
      !registry ||
      typeof registry.set !== 'function' ||
      typeof registry.delete !== 'function' ||
      typeof HighlightConstructor !== 'function'
    ) {
      return undefined;
    }
    return { registry, Highlight: HighlightConstructor };
  }

  private unregisterEmptyTextHighlight(kind: 'success' | 'pending'): void {
    const highlight = kind === 'success' ? this.successTextHighlight : this.pendingTextHighlight;
    if (highlight?.size === 0) this.unregisterTextHighlight(kind);
  }

  private unregisterTextHighlight(kind: 'success' | 'pending'): void {
    const name = kind === 'success' ? this.name : this.pendingName;
    const highlight = kind === 'success' ? this.successTextHighlight : this.pendingTextHighlight;
    if (this.registry && highlight && this.registry.get(name) === highlight) {
      this.registry.delete(name);
    }
    highlight?.clear();
    if (kind === 'success') this.successTextHighlight = undefined;
    else {
      this.pendingTextHighlight = undefined;
      this.stopPendingPulse();
    }
    if (!this.successTextHighlight && !this.pendingTextHighlight) this.registry = undefined;
  }

  private startPendingPulse(): void {
    if (this.pendingPulseTimer || !this.pendingTextHighlight || !this.registry) return;
    this.pendingTextVisible = true;
    this.pendingPulseTimer = setInterval(() => {
      const highlight = this.pendingTextHighlight;
      const registry = this.registry;
      if (!highlight || !registry || highlight.size === 0) {
        this.stopPendingPulse();
        return;
      }
      if (this.pendingTextVisible) registry.delete(this.pendingName);
      else registry.set(this.pendingName, highlight);
      this.pendingTextVisible = !this.pendingTextVisible;
    }, TRANSLATION_PENDING_PULSE_DURATION_MS / 2);
  }

  private stopPendingPulse(): void {
    if (this.pendingPulseTimer) clearInterval(this.pendingPulseTimer);
    this.pendingPulseTimer = undefined;
    this.pendingTextVisible = true;
  }

  private ensureStyle(root: Document | ShadowRoot): void {
    if (this.styles.has(root)) return;
    const style = this.document.createElement('style');
    style.setAttribute(OWNER_ATTRIBUTE, 'translation-highlight');
    style.textContent = `
::highlight(${this.name}) {
  color: ${TRANSLATION_HIGHLIGHT_COLOR};
}
::highlight(${this.pendingName}) {
  color: ${TRANSLATION_PENDING_COLOR};
  animation: ${this.pulseName} ${TRANSLATION_PENDING_PULSE_DURATION_MS}ms ease-in-out infinite;
}
[${SUCCESS_MARKER_ATTRIBUTE}="${this.name}"] {
  color: ${TRANSLATION_HIGHLIGHT_COLOR} !important;
}
[${SUCCESS_MARKER_ATTRIBUTE}="${this.name}"]::placeholder {
  color: ${TRANSLATION_HIGHLIGHT_COLOR} !important;
  opacity: 1;
}
[${PENDING_MARKER_ATTRIBUTE}="${this.name}"] {
  color: ${TRANSLATION_PENDING_COLOR} !important;
  animation: ${this.pulseName} ${TRANSLATION_PENDING_PULSE_DURATION_MS}ms ease-in-out infinite;
}
[${PENDING_MARKER_ATTRIBUTE}="${this.name}"]::placeholder {
  color: ${TRANSLATION_PENDING_COLOR} !important;
  opacity: 1;
}
@keyframes ${this.pulseName} {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.48; }
}
`;
    if (root.nodeType === Node.DOCUMENT_NODE) {
      const rootDocument = root as Document;
      (rootDocument.head ?? rootDocument.documentElement).append(style);
    } else {
      root.append(style);
    }
    this.styles.set(root, style);
  }
}
