import { isPotentiallyTranslatableText, shouldTranslateText } from './language';
import { isUsefulEnglishTranslation } from './translation-validation';
import { PRIORITY_BATCH_SEGMENTS } from './constants';

const COMMON_SKIP_SELECTOR = [
  'script',
  'style',
  'noscript',
  'template',
  'code',
  'pre',
  'kbd',
  'samp',
  'svg',
  'canvas',
  'iframe',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="textbox"]',
  '[data-fast-ai-translator]',
  '[hidden]',
].join(',');

const TEXT_SKIP_SELECTOR = `${COMMON_SKIP_SELECTOR},input,textarea,select,option`;
const ATTRIBUTE_SKIP_SELECTOR = `${COMMON_SKIP_SELECTOR},input[type="password"]`;

const MAIN_CONTENT_SELECTOR = 'main,[role="main"],article';
const DEFAULT_MAX_SEGMENTS = 30;
const DEFAULT_MAX_CHARACTERS = 8_000;
const DEFAULT_PRIORITY_SLICE_SIZE = PRIORITY_BATCH_SEGMENTS;
const DEFAULT_SLICE_SIZE = 6;
const DEFAULT_SLICE_TIME_BUDGET_MS = 8;
const DEFAULT_NODES_PER_SLICE = 250;

const TRANSLATABLE_ATTRIBUTES = ['title', 'aria-label', 'alt', 'placeholder'] as const;
export type TranslatableAttribute = (typeof TRANSLATABLE_ATTRIBUTES)[number];

interface TextTarget {
  kind: 'text';
  node: Text;
}

interface AttributeTarget {
  kind: 'attribute';
  element: Element;
  attribute: TranslatableAttribute;
}

export type CandidateTarget = TextTarget | AttributeTarget;

export interface TranslationCandidate {
  id: string;
  source: string;
  prefix: string;
  suffix: string;
  target: CandidateTarget;
  observedElement: Element;
  translated?: string;
}

export interface ExtractionOptions {
  mainContentOnly?: boolean;
  textOnly?: boolean;
  visibleOnly?: boolean;
  maxSegments?: number;
  maxCharacters?: number;
  skipTextNode?: (node: Text) => boolean;
}

export interface VisibleCandidateCollectorOptions extends ExtractionOptions {
  semanticPriority?: boolean;
  prioritySliceSize?: number;
  sliceSize?: number;
  timeBudgetMs?: number;
  nodesPerSlice?: number;
  signal?: AbortSignal;
}

export interface VisibleCandidateSlice {
  candidates: TranslationCandidate[];
  done: boolean;
}

export interface VisibleCandidateCollector {
  nextSlice(): Promise<VisibleCandidateSlice>;
}

function isDocumentNode(node: Document | Element | ShadowRoot): node is Document {
  return node.nodeType === Node.DOCUMENT_NODE;
}

function composedParent(element: Element): Element | null {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

function closestInComposedTree(element: Element, selector: string): Element | null {
  let current: Element | null = element;
  while (current) {
    const match = current.closest(selector);
    if (match) return match;
    const root = current.getRootNode();
    current = root instanceof ShadowRoot ? root.host : null;
  }
  return null;
}

function isTextSkipped(element: Element | null): boolean {
  return (
    !element ||
    element.matches('[translate="no"]') ||
    Boolean(closestInComposedTree(element, TEXT_SKIP_SELECTOR))
  );
}

function isAttributeSkipped(element: Element): boolean {
  return (
    element.matches('[translate="no"]') ||
    Boolean(closestInComposedTree(element, ATTRIBUTE_SKIP_SELECTOR))
  );
}

function hasVisiblePlaceholder(element: Element): boolean {
  const tagName = element.tagName.toLowerCase();
  if (tagName !== 'input' && tagName !== 'textarea') return false;
  if (!element.hasAttribute('placeholder')) return false;
  const control = element as HTMLInputElement | HTMLTextAreaElement;
  if (control.value !== '') return false;
  if (tagName === 'textarea') return true;
  return /^(?:email|number|search|tel|text|url)$/.test(
    (element.getAttribute('type') ?? 'text').toLowerCase(),
  );
}

function attributesForExtraction(
  element: Element,
  textOnly: boolean,
  visibleOnly: boolean,
): readonly TranslatableAttribute[] {
  if (visibleOnly) return hasVisiblePlaceholder(element) ? ['placeholder'] : [];
  return textOnly ? [] : TRANSLATABLE_ATTRIBUTES;
}

function whitespaceParts(value: string): { prefix: string; core: string; suffix: string } {
  const match = value.match(/^(\s*)([\s\S]*?)(\s*)$/);
  return {
    prefix: match?.[1] ?? '',
    core: match?.[2] ?? value,
    suffix: match?.[3] ?? '',
  };
}

function observedElementFor(element: Element): Element {
  const view = element.ownerDocument.defaultView;
  let observed = element;
  while (
    view &&
    observed.parentElement &&
    view.getComputedStyle(observed).display === 'contents'
  ) {
    observed = observed.parentElement;
  }
  return observed;
}

function rootsWithin(root: Document | Element | ShadowRoot): Array<Document | Element | ShadowRoot> {
  const roots: Array<Document | Element | ShadowRoot> = [root];
  const scope = isDocumentNode(root) ? root.documentElement : root;
  if (scope instanceof Element && scope.shadowRoot) roots.push(...rootsWithin(scope.shadowRoot));
  for (const element of scope.querySelectorAll('*')) {
    if (element.shadowRoot) roots.push(...rootsWithin(element.shadowRoot));
  }
  return roots;
}

function viewportSize(document: Document): { width: number; height: number } {
  const view = document.defaultView;
  return {
    width: Math.max(0, view?.innerWidth ?? document.documentElement.clientWidth),
    height: Math.max(0, view?.innerHeight ?? document.documentElement.clientHeight),
  };
}

function rectIntersectionArea(rect: DOMRect | DOMRectReadOnly, width: number, height: number): number {
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(width, rect.right);
  const bottom = Math.min(height, rect.bottom);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function isComputedStyleHidden(style: CSSStyleDeclaration): boolean {
  const opacity = Number.parseFloat(style.opacity);
  return (
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    style.visibility === 'collapse' ||
    (!Number.isNaN(opacity) && opacity <= 0) ||
    style.getPropertyValue('content-visibility') === 'hidden'
  );
}

function isStyleVisible(element: Element, document: Document): boolean {
  const view = document.defaultView;
  if (!view) return false;
  let current: Element | null = element;
  while (current) {
    if (isComputedStyleHidden(view.getComputedStyle(current))) return false;
    current = composedParent(current);
  }
  return true;
}

function isElementInViewport(element: Element, document: Document): boolean {
  const { width, height } = viewportSize(document);
  if (!element.isConnected || width <= 0 || height <= 0 || !isStyleVisible(element, document)) {
    return false;
  }
  return rectIntersectionArea(element.getBoundingClientRect(), width, height) > 0;
}

function viewportCoverage(element: Element, document: Document): number {
  const { width, height } = viewportSize(document);
  const viewportArea = width * height;
  return viewportArea > 0
    ? rectIntersectionArea(element.getBoundingClientRect(), width, height) / viewportArea
    : 0;
}

function isVerticalScrollContainer(element: Element, document: Document): boolean {
  const overflowY = document.defaultView?.getComputedStyle(element).overflowY ?? '';
  return /^(auto|scroll|overlay)$/.test(overflowY);
}

function scrollContainerAtViewportCenter(document: Document): Element | undefined {
  const { width, height } = viewportSize(document);
  if (width <= 0 || height <= 0) return undefined;
  const centerX = width / 2;
  const centerY = height / 2;

  const hitElements = [document.elementFromPoint(centerX, centerY)];
  try {
    hitElements.push(...document.elementsFromPoint(centerX, centerY));
  } catch {
    // Some test DOMs expose elementFromPoint without elementsFromPoint.
  }
  const visited = new Set<Element>();
  for (const hit of hitElements) {
    let current: Element | null = hit;
    while (current) {
      if (visited.has(current)) break;
      visited.add(current);
      if (
        isVerticalScrollContainer(current, document) &&
        viewportCoverage(current, document) >= 0.35
      ) {
        return current;
      }
      current = composedParent(current);
    }
  }
  return undefined;
}

export function findVisibleMainContentRoots(document: Document): Element[] {
  const semanticRoots = [...document.querySelectorAll(MAIN_CONTENT_SELECTOR)].filter((element) =>
    isElementInViewport(element, document),
  );
  const unnestedRoots = semanticRoots.filter(
    (candidate) =>
      !semanticRoots.some((other) => other !== candidate && other.contains(candidate)),
  );
  if (unnestedRoots.length > 0) return unnestedRoots;

  const scrollContainer = scrollContainerAtViewportCenter(document);
  if (scrollContainer) return [scrollContainer];
  return document.body ? [document.body] : [document.documentElement];
}

function clipRectToVisibleArea(
  rect: DOMRect | DOMRectReadOnly,
  element: Element,
  document: Document,
): boolean {
  const { width, height } = viewportSize(document);
  const view = document.defaultView;
  if (width <= 0 || height <= 0 || !view) return false;

  let top = Math.max(0, rect.top);
  let right = Math.min(width, rect.right);
  let bottom = Math.min(height, rect.bottom);
  let left = Math.max(0, rect.left);
  let current: Element | null = element;

  while (current) {
    const style = view.getComputedStyle(current);
    if (isComputedStyleHidden(style)) return false;
    const overflow = style.overflow ?? '';
    const clipsX = /^(auto|clip|hidden|overlay|scroll)$/.test(style.overflowX || overflow);
    const clipsY = /^(auto|clip|hidden|overlay|scroll)$/.test(style.overflowY || overflow);
    if (clipsX || clipsY) {
      const clippingRect = current.getBoundingClientRect();
      if (clipsX) {
        left = Math.max(left, clippingRect.left);
        right = Math.min(right, clippingRect.right);
      }
      if (clipsY) {
        top = Math.max(top, clippingRect.top);
        bottom = Math.min(bottom, clippingRect.bottom);
      }
    }
    current = composedParent(current);
  }

  return bottom > top && right > left;
}

function textClientRects(node: Text, document: Document): DOMRect[] {
  try {
    const range = document.createRange();
    range.selectNodeContents(node);
    return [...range.getClientRects()];
  } catch {
    return [];
  }
}

function candidateClientRects(
  candidate: TranslationCandidate,
  document: Document,
): Array<DOMRect | DOMRectReadOnly> {
  if (candidate.target.kind === 'attribute') {
    return [candidate.target.element.getBoundingClientRect()];
  }
  const rects = textClientRects(candidate.target.node, document);
  return rects.length > 0
    ? rects
    : [candidate.observedElement.getBoundingClientRect()];
}

export function isCandidateInViewport(
  candidate: TranslationCandidate,
  document: Document,
): boolean {
  if (!candidate.observedElement.isConnected) return false;
  return Boolean(candidatePosition(candidate, document));
}

function rootsForExtraction(
  root: Document | Element | ShadowRoot,
  semanticPriority: boolean,
): Array<Document | Element | ShadowRoot> {
  if (!semanticPriority) return [root];
  const document = isDocumentNode(root) ? root : root.ownerDocument;
  if (!document) return [];
  const priorityRoots = isDocumentNode(root)
    ? findVisibleMainContentRoots(document)
    : [
        ...(root instanceof Element && root.matches(MAIN_CONTENT_SELECTOR) ? [root] : []),
        ...root.querySelectorAll(MAIN_CONTENT_SELECTOR),
      ].filter((element) => isElementInViewport(element, document));
  const unnestedPriorityRoots = priorityRoots.filter(
    (candidate) =>
      !priorityRoots.some((other) => other !== candidate && other.contains(candidate)),
  );
  const fallbackRoot = isDocumentNode(root)
    ? (document.body ?? document.documentElement)
    : root;
  return [...new Set<Document | Element | ShadowRoot>([...unnestedPriorityRoots, fallbackRoot])];
}

function candidatePosition(
  candidate: TranslationCandidate,
  document: Document,
): { top: number; left: number } | undefined {
  if (!candidate.observedElement.isConnected) return undefined;
  const rects = candidateClientRects(candidate, document);
  const visibleRects = rects.filter((rect) =>
    clipRectToVisibleArea(rect, candidate.observedElement, document),
  );
  const first = visibleRects.sort((a, b) => a.top - b.top || a.left - b.left)[0];
  return first ? { top: first.top, left: first.left } : undefined;
}

export function extractCandidates(
  root: Document | Element | ShadowRoot,
  pageLanguage: string,
  nextId: () => string,
  deferLanguageCheck = false,
  options?: ExtractionOptions,
): TranslationCandidate[] {
  const candidates: TranslationCandidate[] = [];
  const positions = new Map<TranslationCandidate, { top: number; left: number }>();
  const semanticPriority = options?.mainContentOnly ?? false;
  const textOnly = options?.textOnly ?? false;
  const visibleOnly = options?.visibleOnly ?? false;
  const seenTextNodes = new WeakSet<Text>();
  const seenAttributeElements = new WeakSet<Element>();
  const maxSegments = options
    ? Math.max(0, options.maxSegments ?? DEFAULT_MAX_SEGMENTS)
    : Infinity;
  const maxCharacters = options
    ? Math.max(0, options.maxCharacters ?? DEFAULT_MAX_CHARACTERS)
    : Infinity;
  const collectionMaxSegments = Number.isFinite(maxSegments) ? maxSegments + 16 : Infinity;
  const collectionMaxCharacters = Number.isFinite(maxCharacters)
    ? maxCharacters + Math.max(1_024, Math.min(maxCharacters, 4_000))
    : Infinity;
  let characters = 0;
  const addCandidate = (
    candidate: TranslationCandidate,
    document: Document,
  ): 'added' | 'ignored' | 'full' => {
    if (visibleOnly) {
      const position = candidatePosition(candidate, document);
      if (!position) return 'ignored';
      positions.set(candidate, position);
    }
    if (
      candidates.length >= collectionMaxSegments ||
      characters + candidate.source.length > collectionMaxCharacters
    ) {
      return 'full';
    }
    candidates.push(candidate);
    characters += candidate.source.length;
    return 'added';
  };

  extraction: for (const extractionRoot of rootsForExtraction(root, semanticPriority)) {
    const currentRoots = rootsWithin(extractionRoot);
    for (const currentRoot of currentRoots) {
      const ownerDocument = isDocumentNode(currentRoot) ? currentRoot : currentRoot.ownerDocument;
      if (!ownerDocument) continue;
      const walker = ownerDocument.createTreeWalker(currentRoot, NodeFilter.SHOW_TEXT);
      let current = walker.nextNode();
      while (current) {
        const node = current as Text;
        if (seenTextNodes.has(node)) {
          current = walker.nextNode();
          continue;
        }
        seenTextNodes.add(node);
        if (options?.skipTextNode?.(node)) {
          current = walker.nextNode();
          continue;
        }
        const parent = node.parentElement;
        if (!isTextSkipped(parent)) {
          const { prefix, core, suffix } = whitespaceParts(node.nodeValue ?? '');
          const shouldInclude = deferLanguageCheck
            ? isPotentiallyTranslatableText(core)
            : shouldTranslateText(core, pageLanguage);
          if (shouldInclude && parent) {
            const candidate: TranslationCandidate = {
              id: nextId(),
              source: core,
              prefix,
              suffix,
              target: { kind: 'text', node },
              observedElement: observedElementFor(parent),
            };
            const result = addCandidate(candidate, ownerDocument);
            if (result === 'full') break extraction;
          }
        }
        current = walker.nextNode();
      }

      const scope = isDocumentNode(currentRoot) ? currentRoot.documentElement : currentRoot;
      const elements = [
        ...(scope instanceof Element ? [scope] : []),
        ...scope.querySelectorAll('*'),
      ];
      for (const element of elements) {
        if (seenAttributeElements.has(element)) continue;
        seenAttributeElements.add(element);
        if (isAttributeSkipped(element)) continue;
        for (const attribute of attributesForExtraction(element, textOnly, visibleOnly)) {
          const value = element.getAttribute(attribute) ?? '';
          const shouldInclude = deferLanguageCheck
            ? isPotentiallyTranslatableText(value)
            : shouldTranslateText(value, pageLanguage);
          if (!shouldInclude) continue;
          const candidate: TranslationCandidate = {
            id: nextId(),
            source: value.trim(),
            prefix: '',
            suffix: '',
            target: { kind: 'attribute', element, attribute },
            observedElement: observedElementFor(element),
          };
          if (addCandidate(candidate, ownerDocument) === 'full') break extraction;
        }
      }
    }
  }

  if (!options) return candidates;

  const ownerDocument = isDocumentNode(root) ? root : root.ownerDocument;
  if (ownerDocument && visibleOnly) {
    candidates.sort((a, b) => {
      const aPosition = positions.get(a);
      const bPosition = positions.get(b);
      if (!aPosition || !bPosition) return 0;
      return aPosition.top - bPosition.top || aPosition.left - bPosition.left;
    });
  }

  const limited: TranslationCandidate[] = [];
  let limitedCharacters = 0;
  for (const candidate of candidates) {
    if (
      limited.length >= maxSegments ||
      limitedCharacters + candidate.source.length > maxCharacters
    ) {
      break;
    }
    limited.push(candidate);
    limitedCharacters += candidate.source.length;
  }
  return limited;
}

interface CollectorTraversalScope {
  root: Document | Element | ShadowRoot;
  walker: TreeWalker;
  pendingRoot?: Element;
}

function createCollectorTraversalScope(
  root: Document | Element | ShadowRoot,
  excludedSubtrees: readonly Element[],
): CollectorTraversalScope | undefined {
  const ownerDocument = isDocumentNode(root) ? root : root.ownerDocument;
  if (!ownerDocument) return undefined;
  const excluded = new Set(excludedSubtrees);
  return {
    root,
    walker: ownerDocument.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) =>
          node instanceof Element && excluded.has(node)
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT,
      },
    ),
    ...(root instanceof Element ? { pendingRoot: root } : {}),
  };
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function createVisibleCandidateCollector(
  root: Document | Element | ShadowRoot,
  pageLanguage: string,
  nextId: () => string,
  deferLanguageCheck = true,
  options: VisibleCandidateCollectorOptions = {},
): VisibleCandidateCollector {
  const ownerDocument = isDocumentNode(root) ? root : root.ownerDocument;
  const semanticPriority = options.semanticPriority ?? options.mainContentOnly ?? true;
  const maxSegments = Math.max(0, options.maxSegments ?? DEFAULT_MAX_SEGMENTS);
  const maxCharacters = Math.max(0, options.maxCharacters ?? DEFAULT_MAX_CHARACTERS);
  const sliceSize = Math.max(1, options.sliceSize ?? DEFAULT_SLICE_SIZE);
  const prioritySliceSize = Math.max(
    1,
    Math.min(sliceSize, options.prioritySliceSize ?? DEFAULT_PRIORITY_SLICE_SIZE),
  );
  const timeBudgetMs = Math.max(1, options.timeBudgetMs ?? DEFAULT_SLICE_TIME_BUDGET_MS);
  const nodesPerSlice = Math.max(1, options.nodesPerSlice ?? DEFAULT_NODES_PER_SLICE);
  const scopes: CollectorTraversalScope[] = [];
  const queuedRoots = new WeakSet<Node>();
  const seenTextNodes = new WeakSet<Text>();
  const seenAttributeElements = new WeakSet<Element>();
  let currentScope: CollectorTraversalScope | undefined;
  let totalSegments = 0;
  let totalCharacters = 0;
  let done = !ownerDocument || maxSegments === 0 || maxCharacters === 0;
  let hasReturnedSlice = false;
  let hasEmittedCandidates = false;

  const enqueueRootPlan = (planRoot: Document | Element | ShadowRoot): void => {
    const plan = rootsForExtraction(planRoot, semanticPriority);
    const fallbackRoot = plan.at(-1);
    const excludedFromFallback = plan
      .slice(0, -1)
      .filter((candidate): candidate is Element => candidate instanceof Element);
    for (const candidateRoot of plan) {
      if (queuedRoots.has(candidateRoot)) continue;
      queuedRoots.add(candidateRoot);
      const scope = createCollectorTraversalScope(
        candidateRoot,
        candidateRoot === fallbackRoot ? excludedFromFallback : [],
      );
      if (scope) scopes.push(scope);
    }
  };

  enqueueRootPlan(root);

  const nextTraversalNode = (): Node | undefined => {
    while (true) {
      currentScope ??= scopes.shift();
      if (!currentScope) return undefined;
      if (currentScope.pendingRoot) {
        const pending = currentScope.pendingRoot;
        currentScope.pendingRoot = undefined;
        return pending;
      }
      const next = currentScope.walker.nextNode();
      if (next) return next;
      currentScope = undefined;
    }
  };

  const rotateCurrentScope = (): void => {
    if (!currentScope) return;
    scopes.push(currentScope);
    currentScope = undefined;
  };

  const candidateForNode = (
    node: Node,
  ): { candidate: TranslationCandidate; position: { top: number; left: number } } | undefined => {
    let candidate: TranslationCandidate | undefined;
    if (node instanceof Text) {
      if (seenTextNodes.has(node)) return undefined;
      seenTextNodes.add(node);
      if (options.skipTextNode?.(node)) return undefined;
      const parent = node.parentElement;
      if (!parent || isTextSkipped(parent)) return undefined;
      const { prefix, core, suffix } = whitespaceParts(node.nodeValue ?? '');
      const shouldInclude = deferLanguageCheck
        ? isPotentiallyTranslatableText(core)
        : shouldTranslateText(core, pageLanguage);
      if (!shouldInclude) return undefined;
      candidate = {
        id: nextId(),
        source: core,
        prefix,
        suffix,
        target: { kind: 'text', node },
        observedElement: observedElementFor(parent),
      };
    } else if (node instanceof Element) {
      if (node.shadowRoot && !queuedRoots.has(node.shadowRoot)) enqueueRootPlan(node.shadowRoot);
      if (seenAttributeElements.has(node)) return undefined;
      seenAttributeElements.add(node);
      if (isAttributeSkipped(node)) return undefined;
      const [attribute] = attributesForExtraction(node, options.textOnly ?? false, true);
      if (!attribute) return undefined;
      const value = node.getAttribute(attribute) ?? '';
      const shouldInclude = deferLanguageCheck
        ? isPotentiallyTranslatableText(value)
        : shouldTranslateText(value, pageLanguage);
      if (!shouldInclude) return undefined;
      candidate = {
        id: nextId(),
        source: value.trim(),
        prefix: '',
        suffix: '',
        target: { kind: 'attribute', element: node, attribute },
        observedElement: observedElementFor(node),
      };
    }

    if (!candidate || !ownerDocument) return undefined;
    const position = candidatePosition(candidate, ownerDocument);
    return position ? { candidate, position } : undefined;
  };

  return {
    async nextSlice(): Promise<VisibleCandidateSlice> {
      if (done) return { candidates: [], done: true };
      if (hasReturnedSlice) await yieldToEventLoop();
      hasReturnedSlice = true;
      if (options.signal?.aborted) {
        done = true;
        return { candidates: [], done: true };
      }

      const startedAt = performance.now();
      const targetSliceSize = hasEmittedCandidates ? sliceSize : prioritySliceSize;
      const slice: Array<{
        candidate: TranslationCandidate;
        position: { top: number; left: number };
      }> = [];
      let visitedNodes = 0;

      while (
        slice.length < targetSliceSize &&
        visitedNodes < nodesPerSlice &&
        (visitedNodes < 32 || slice.length > 0 || performance.now() - startedAt < timeBudgetMs)
      ) {
        if (totalSegments >= maxSegments || totalCharacters >= maxCharacters) {
          done = true;
          break;
        }
        const node = nextTraversalNode();
        if (!node) {
          done = true;
          break;
        }
        visitedNodes += 1;
        const result = candidateForNode(node);
        if (!result) continue;
        if (totalCharacters + result.candidate.source.length > maxCharacters) {
          done = true;
          break;
        }
        slice.push(result);
        totalSegments += 1;
        totalCharacters += result.candidate.source.length;
      }

      if (!done) rotateCurrentScope();
      slice.sort(
        (a, b) =>
          a.position.top - b.position.top || a.position.left - b.position.left,
      );
      if (slice.length > 0) hasEmittedCandidates = true;
      return { candidates: slice.map(({ candidate }) => candidate), done };
    },
  };
}

export function currentCandidateValue(candidate: TranslationCandidate): string | null {
  if (candidate.target.kind === 'text') {
    return candidate.target.node.isConnected ? candidate.target.node.nodeValue : null;
  }
  if (!candidate.target.element.isConnected) return null;
  return candidate.target.element.getAttribute(candidate.target.attribute);
}

export function originalCandidateValue(candidate: TranslationCandidate): string {
  return `${candidate.prefix}${candidate.source}${candidate.suffix}`;
}

export function translatedCandidateValue(
  candidate: TranslationCandidate,
  translation: string,
): string {
  return candidate.target.kind === 'text'
    ? `${candidate.prefix}${translation}${candidate.suffix}`
    : translation;
}

export function applyCandidate(candidate: TranslationCandidate, translation: string): boolean {
  if (!isUsefulEnglishTranslation(candidate.source, translation)) return false;
  if (currentCandidateValue(candidate) !== originalCandidateValue(candidate)) return false;
  const value = translatedCandidateValue(candidate, translation);
  if (candidate.target.kind === 'text') candidate.target.node.nodeValue = value;
  else candidate.target.element.setAttribute(candidate.target.attribute, value);
  candidate.translated = value;
  return true;
}

export function restoreCandidate(candidate: TranslationCandidate): boolean {
  if (!candidate.translated || currentCandidateValue(candidate) !== candidate.translated) return false;
  const original = originalCandidateValue(candidate);
  if (candidate.target.kind === 'text') candidate.target.node.nodeValue = original;
  else candidate.target.element.setAttribute(candidate.target.attribute, original);
  candidate.translated = undefined;
  return true;
}
