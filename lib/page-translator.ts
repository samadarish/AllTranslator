import { browser } from 'wxt/browser';
import {
  MAX_BATCH_CHARACTERS,
  MAX_BATCH_SEGMENTS,
  MAX_VIEWPORT_SEGMENTS,
  PRIORITY_BATCH_CHARACTERS,
  PRIORITY_BATCH_SEGMENTS,
} from './constants';
import {
  applyCandidate,
  createVisibleCandidateCollector,
  currentCandidateValue,
  isCandidateInViewport,
  originalCandidateValue,
  restoreCandidate,
  type TranslationCandidate,
  type VisibleCandidateCollector,
} from './extractor';
import { detectPageLanguage, shouldTranslateText, shouldTranslateVisibleText } from './language';
import { TranslationHighlightFeedback } from './translation-highlight';
import type {
  PageTranslationStatus,
  TranslationBatchResponse,
  TranslationLookupResponse,
  TranslatorSettings,
} from './types';

interface QueueItem {
  candidate: TranslationCandidate;
  attempt: number;
  readyAt: number;
}

interface ActiveBatch {
  requestId: string;
  generation: number;
  items: QueueItem[];
  cancelled: boolean;
}

const emptyStatus = (state: PageTranslationStatus['state']): PageTranslationStatus => ({
  state,
  total: 0,
  translated: 0,
  cached: 0,
  failed: 0,
  pending: 0,
  scanMs: 0,
  cacheMs: 0,
  firstResultMs: 0,
  totalMs: 0,
  providerMs: 0,
  requestCount: 0,
});

const monotonicNow = () => globalThis.performance?.now() ?? Date.now();
const MIN_RATE_LIMIT_PAUSE_MS = 500;
const MAX_RATE_LIMIT_PAUSE_MS = 10_000;

export class PageTranslator {
  private status = emptyStatus('idle');
  private pageLanguage = 'unknown';
  private pageLanguagePromise?: Promise<string>;
  private generation = 0;
  private nextCandidateNumber = 0;
  private nextRequestNumber = 0;
  private initialized = false;
  private runStartedAt = 0;
  private candidates = new Map<string, TranslationCandidate>();
  private textTargets = new WeakMap<Text, string>();
  private attributeTargets = new WeakMap<Element, Map<string, string>>();
  private observedCandidates = new Map<Element, Set<string>>();
  private ignoredIds = new Set<string>();
  private exhaustedIds = new Set<string>();
  private pendingLanguageIds = new Set<string>();
  private languageDecisions = new Map<string, Promise<boolean>>();
  private readyForPreparationIds = new Set<string>();
  private preparingIds = new Set<string>();
  private queuedIds = new Set<string>();
  private countedIds = new Set<string>();
  private inFlightIds = new Set<string>();
  private queue: QueueItem[] = [];
  private activeBatches = new Map<string, ActiveBatch>();
  private activeRequestCount = 0;
  private effectiveConcurrency: number;
  private successfulRequestStreak = 0;
  private rateLimitUntil = 0;
  private priorityBatchSent = false;
  private intersectionObserver?: IntersectionObserver;
  private mutationObservers: MutationObserver[] = [];
  private observedMutationRoots = new WeakSet<Document | ShadowRoot>();
  private scanPromise?: Promise<void>;
  private visibleCollector?: VisibleCandidateCollector;
  private collectorAbortController?: AbortController;
  private scanMayHaveMore = false;
  private rescanRequested = false;
  private scanTimer?: ReturnType<typeof setTimeout>;
  private preparationTimer?: ReturnType<typeof setTimeout>;
  private preparationPromise?: Promise<void>;
  private pumpTimer?: ReturnType<typeof setTimeout>;
  private mutationFrame?: number;
  private viewportListenersActive = false;
  private readonly highlightFeedback: TranslationHighlightFeedback;

  private readonly handleViewportChange = () => {
    this.cancelInvisibleWork();
    this.resetVisibleCollector();
    this.scheduleScan(50);
  };

  constructor(
    private settings: TranslatorSettings,
    private readonly document: Document,
  ) {
    this.effectiveConcurrency = settings.concurrency;
    this.highlightFeedback = new TranslationHighlightFeedback(document);
  }

  getStatus(): PageTranslationStatus {
    if (this.runStartedAt > 0 && this.status.state !== 'idle') {
      this.status.totalMs = Math.round(monotonicNow() - this.runStartedAt);
    }
    return { ...this.status };
  }

  updateSettings(settings: TranslatorSettings): void {
    this.settings = settings;
    this.effectiveConcurrency = Math.min(this.effectiveConcurrency, settings.concurrency);
    if (this.activeRequestCount === 0 && monotonicNow() >= this.rateLimitUntil) {
      this.effectiveConcurrency = settings.concurrency;
    }
    this.schedulePump();
  }

  async start(forceVisible = false): Promise<PageTranslationStatus> {
    if (!this.initialized) this.initialize();
    if (forceVisible) {
      this.exhaustedIds.clear();
      this.resetVisibleCollector();
      if (this.scanTimer) {
        clearTimeout(this.scanTimer);
        this.scanTimer = undefined;
      }
    }
    await this.scanVisibleScreen();
    return this.getStatus();
  }

  restore(): PageTranslationStatus {
    this.generation += 1;
    for (const batch of this.activeBatches.values()) this.abortBatch(batch);
    if (this.scanTimer) clearTimeout(this.scanTimer);
    if (this.preparationTimer) clearTimeout(this.preparationTimer);
    if (this.pumpTimer) clearTimeout(this.pumpTimer);
    if (this.mutationFrame !== undefined) {
      this.document.defaultView?.cancelAnimationFrame(this.mutationFrame);
    }
    this.teardownViewportListeners();
    this.intersectionObserver?.disconnect();
    this.mutationObservers.forEach((observer) => observer.disconnect());
    this.resetVisibleCollector();
    this.highlightFeedback.clear();
    for (const candidate of this.candidates.values()) restoreCandidate(candidate);

    this.initialized = false;
    this.runStartedAt = 0;
    this.pageLanguage = 'unknown';
    this.pageLanguagePromise = undefined;
    this.scanTimer = undefined;
    this.preparationTimer = undefined;
    this.preparationPromise = undefined;
    this.pumpTimer = undefined;
    this.mutationFrame = undefined;
    this.scanPromise = undefined;
    this.scanMayHaveMore = false;
    this.rescanRequested = false;
    this.queue = [];
    this.activeBatches.clear();
    this.activeRequestCount = 0;
    this.candidates.clear();
    this.observedCandidates.clear();
    this.ignoredIds.clear();
    this.exhaustedIds.clear();
    this.pendingLanguageIds.clear();
    this.languageDecisions.clear();
    this.readyForPreparationIds.clear();
    this.preparingIds.clear();
    this.queuedIds.clear();
    this.countedIds.clear();
    this.inFlightIds.clear();
    this.textTargets = new WeakMap();
    this.attributeTargets = new WeakMap();
    this.mutationObservers = [];
    this.observedMutationRoots = new WeakSet();
    this.status = emptyStatus('restored');
    return this.getStatus();
  }

  private initialize(): void {
    this.initialized = true;
    this.generation += 1;
    this.runStartedAt = monotonicNow();
    this.priorityBatchSent = false;
    this.successfulRequestStreak = 0;
    this.rateLimitUntil = 0;
    this.resetVisibleCollector();
    this.effectiveConcurrency = this.settings.concurrency;
    this.status = emptyStatus('scanning');
    this.setupIntersectionObserver();
    this.setupMutationObserver(this.document);
    this.setupViewportListeners();

    const generation = this.generation;
    this.pageLanguagePromise = detectPageLanguage(this.document).then((language) => {
      if (generation === this.generation) this.pageLanguage = language;
      return language;
    });
  }

  private setupIntersectionObserver(): void {
    this.intersectionObserver?.disconnect();
    if (typeof IntersectionObserver === 'undefined') return;
    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        let enteredViewport = false;
        for (const entry of entries) {
          const ids = this.observedCandidates.get(entry.target);
          if (!ids) continue;
          if (entry.isIntersecting) enteredViewport = true;
          else for (const id of ids) this.cancelQueuedCandidate(id);
        }
        this.cancelInvisibleBatches();
        if (enteredViewport) {
          this.resetVisibleCollector();
          this.scheduleScan(0);
        }
      },
      { rootMargin: '0px', threshold: 0.01 },
    );
  }

  private setupMutationObserver(root: Document | ShadowRoot): void {
    if (this.observedMutationRoots.has(root)) return;
    this.observedMutationRoots.add(root);
    const observer = new MutationObserver((mutations) => {
      let shouldScan = false;
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          this.invalidateSelectLabel(mutation.target);
          for (const node of mutation.removedNodes) this.removeCandidatesWithin(node);
          const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
          shouldScan ||= changedNodes.some((node) => !this.isExtensionOwnedNode(node));
        } else if (mutation.type === 'characterData' && mutation.target instanceof Text) {
          this.invalidateSelectLabel(mutation.target);
          const id = this.textTargets.get(mutation.target);
          const candidate = id ? this.candidates.get(id) : undefined;
          if (candidate?.translated === mutation.target.nodeValue) continue;
          if (id) this.removeCandidate(id);
          shouldScan = true;
        } else if (mutation.type === 'attributes' && mutation.target instanceof Element) {
          const attribute = mutation.attributeName;
          const id = attribute
            ? this.attributeTargets.get(mutation.target)?.get(attribute)
            : undefined;
          const candidate = id ? this.candidates.get(id) : undefined;
          if (
            candidate && candidate.target.kind !== 'text' &&
            candidate.translated === mutation.target.getAttribute(candidate.target.attribute)
          ) {
            continue;
          }
          if (id) this.removeCandidate(id);
          shouldScan = true;
        }
      }
      if (shouldScan) this.scheduleMutationScan();
    });
    const target = root instanceof Document ? root.documentElement : root;
    observer.observe(target, {
      attributes: true,
      attributeFilter: [
        'class',
        'style',
        'hidden',
        'role',
        'translate',
        'contenteditable',
        'placeholder',
        'type',
        'value',
        'label',
      ],
      characterData: true,
      childList: true,
      subtree: true,
    });
    this.mutationObservers.push(observer);
  }

  private invalidateSelectLabel(node: Node): void {
    const element = (node instanceof Element ? node : node.parentElement)?.closest('option');
    if (!element) return;
    const id = this.attributeTargets.get(element)?.get('label');
    const candidate = id ? this.candidates.get(id) : undefined;
    if (candidate?.target.kind !== 'select-label' || element.textContent === candidate.target.originalText) return;
    this.removeCandidate(candidate.id);
  }

  private isExtensionOwnedNode(node: Node): boolean {
    if (node instanceof Element) return node.matches('[data-fast-ai-translator]');
    return Boolean(node.parentElement?.closest('[data-fast-ai-translator]'));
  }

  private scheduleMutationScan(): void {
    if (this.mutationFrame !== undefined) return;
    const view = this.document.defaultView;
    if (!view) {
      this.resetVisibleCollector();
      this.scheduleScan(0);
      return;
    }
    this.mutationFrame = view.requestAnimationFrame(() => {
      this.mutationFrame = undefined;
      this.resetVisibleCollector();
      this.scheduleScan(0);
    });
  }

  private scheduleScan(delay: number): void {
    if (!this.initialized || this.scanTimer) return;
    this.scanTimer = setTimeout(() => {
      this.scanTimer = undefined;
      void this.scanVisibleScreen();
    }, delay);
  }

  private async scanVisibleScreen(): Promise<void> {
    if (this.scanPromise) {
      this.rescanRequested = true;
      await this.scanPromise;
      return;
    }

    this.scanPromise = this.performVisibleScan().finally(() => {
      this.scanPromise = undefined;
      if (this.rescanRequested) {
        this.rescanRequested = false;
        this.scheduleScan(0);
      }
      this.settleStatusIfIdle();
    });
    await this.scanPromise;
  }

  private async performVisibleScan(): Promise<void> {
    const generation = this.generation;
    if (!this.initialized) return;
    if (this.activeRequestCount === 0) this.status.state = 'scanning';
    this.status.lastError = undefined;
    this.pruneDisconnectedCandidates();

    const collector = this.getVisibleCollector();
    const scanStartedAt = monotonicNow();
    const { candidates: extracted, done } = await collector.nextSlice();
    this.status.scanMs += Math.round(monotonicNow() - scanStartedAt);
    if (
      collector !== this.visibleCollector ||
      generation !== this.generation ||
      !this.initialized
    ) {
      return;
    }
    this.scanMayHaveMore = !done;
    if (!done) this.rescanRequested = true;

    const visible: TranslationCandidate[] = [];
    for (const extractedCandidate of extracted) {
      const existingId =
        extractedCandidate.target.kind === 'text'
          ? this.textTargets.get(extractedCandidate.target.node)
          : this.attributeTargets
              .get(extractedCandidate.target.element)
              ?.get(extractedCandidate.target.attribute);
      const candidate = existingId ? this.candidates.get(existingId) : undefined;
      if (candidate) visible.push(candidate);
      else if (this.registerCandidate(extractedCandidate)) visible.push(extractedCandidate);
    }

    const immediate: TranslationCandidate[] = [];
    for (const candidate of visible) {
      if (!this.isCandidateEligible(candidate)) continue;
      if (shouldTranslateText(candidate.source, 'en')) immediate.push(candidate);
      else this.resolveDeferredLanguage(candidate, generation);
    }

    this.observeCandidateShadowRoots(visible);
    await this.prepareCandidates(immediate, generation);
    this.schedulePump();
    this.settleStatusIfIdle();
  }

  private getVisibleCollector(): VisibleCandidateCollector {
    if (this.visibleCollector) return this.visibleCollector;
    this.collectorAbortController = new AbortController();
    this.visibleCollector = createVisibleCandidateCollector(
      this.document,
      this.pageLanguage,
      () => `s${this.nextCandidateNumber++}`,
      true,
      {
        semanticPriority: true,
        textOnly: true,
        visibleOnly: true,
        maxSegments: Number.POSITIVE_INFINITY,
        maxCharacters: Number.POSITIVE_INFINITY,
        sliceSize: MAX_VIEWPORT_SEGMENTS,
        timeBudgetMs: 8,
        nodesPerSlice: 250,
        signal: this.collectorAbortController.signal,
        skipTextNode: (node) => this.shouldSkipKnownNode(node),
      },
    );
    return this.visibleCollector;
  }

  private resetVisibleCollector(): void {
    this.collectorAbortController?.abort();
    this.collectorAbortController = undefined;
    this.visibleCollector = undefined;
    this.scanMayHaveMore = false;
  }

  private isCandidateEligible(candidate: TranslationCandidate): boolean {
    return Boolean(
      !candidate.translated &&
        !this.ignoredIds.has(candidate.id) &&
        !this.exhaustedIds.has(candidate.id) &&
        !this.pendingLanguageIds.has(candidate.id) &&
        !this.readyForPreparationIds.has(candidate.id) &&
        !this.preparingIds.has(candidate.id) &&
        !this.queuedIds.has(candidate.id) &&
        !this.inFlightIds.has(candidate.id) &&
        this.isCandidateVisible(candidate),
    );
  }

  private resolveDeferredLanguage(candidate: TranslationCandidate, generation: number): void {
    void this.languageDecision(candidate, generation)
      .then((shouldTranslate) => {
        if (
          shouldTranslate &&
          generation === this.generation &&
          this.isCandidateEligible(candidate)
        ) {
          this.readyForPreparationIds.add(candidate.id);
          this.schedulePreparation();
        }
      })
      .finally(() => this.settleStatusIfIdle());
  }

  private schedulePreparation(): void {
    if (!this.initialized || this.preparationTimer || this.preparationPromise) return;
    this.preparationTimer = setTimeout(() => {
      this.preparationTimer = undefined;
      const run = this.flushReadyCandidates();
      this.preparationPromise = run;
      void run.finally(() => {
        if (this.preparationPromise === run) this.preparationPromise = undefined;
        if (this.readyForPreparationIds.size > 0) this.schedulePreparation();
        this.settleStatusIfIdle();
      });
    }, 0);
  }

  private async flushReadyCandidates(): Promise<void> {
    const generation = this.generation;
    const ids = [...this.readyForPreparationIds];
    for (const id of ids) this.readyForPreparationIds.delete(id);
    const candidates = ids
      .map((id) => this.candidates.get(id))
      .filter((candidate): candidate is TranslationCandidate => Boolean(candidate));
    await this.prepareCandidates(candidates, generation);
  }

  private async prepareCandidates(
    candidates: TranslationCandidate[],
    generation: number,
  ): Promise<void> {
    const eligible = candidates.filter((candidate) => this.isCandidateEligible(candidate));
    if (generation !== this.generation || eligible.length === 0) return;
    for (const candidate of eligible) {
      this.preparingIds.add(candidate.id);
      this.countCandidate(candidate.id);
      this.highlightFeedback.markPending(candidate);
    }

    let lookup: TranslationLookupResponse = {
      translations: {},
      cachedIds: [],
      cacheMs: 0,
    };
    const cacheStartedAt = monotonicNow();
    try {
      lookup = (await browser.runtime.sendMessage({
        type: 'LOOKUP_TRANSLATIONS',
        segments: eligible.map((candidate) => ({ id: candidate.id, text: candidate.source })),
      })) as TranslationLookupResponse;
    } catch {
      // Cache failure must not block provider translation.
    }
    this.status.cacheMs += Math.round(lookup.cacheMs || monotonicNow() - cacheStartedAt);

    for (const candidate of eligible) {
      this.preparingIds.delete(candidate.id);
      if (generation !== this.generation) return;
      if (!this.isCandidateVisible(candidate)) {
        this.dropCandidate(candidate.id);
        continue;
      }
      const translation = lookup.translations[candidate.id];
      if (translation && applyCandidate(candidate, translation)) {
        this.highlightFeedback.flash(candidate);
        this.completeCandidate(candidate.id, true);
      } else {
        this.enqueue(candidate, 0, 0);
      }
    }

    this.schedulePump();
  }

  private registerCandidate(candidate: TranslationCandidate): boolean {
    if (candidate.target.kind === 'text') {
      if (this.textTargets.has(candidate.target.node)) return false;
      this.textTargets.set(candidate.target.node, candidate.id);
    } else {
      const existing =
        this.attributeTargets.get(candidate.target.element) ?? new Map<string, string>();
      if (existing.has(candidate.target.attribute)) return false;
      existing.set(candidate.target.attribute, candidate.id);
      this.attributeTargets.set(candidate.target.element, existing);
    }
    this.candidates.set(candidate.id, candidate);
    if (this.intersectionObserver) {
      const ids = this.observedCandidates.get(candidate.observedElement) ?? new Set<string>();
      ids.add(candidate.id);
      this.observedCandidates.set(candidate.observedElement, ids);
      this.intersectionObserver.observe(candidate.observedElement);
    }
    return true;
  }

  private shouldSkipKnownNode(node: Text): boolean {
    const id = this.textTargets.get(node);
    if (!id) return false;
    const candidate = this.candidates.get(id);
    return Boolean(
      candidate?.translated ||
        this.ignoredIds.has(id) ||
        this.exhaustedIds.has(id) ||
        this.pendingLanguageIds.has(id) ||
        this.readyForPreparationIds.has(id) ||
        this.preparingIds.has(id) ||
        this.queuedIds.has(id),
    );
  }

  private observeCandidateShadowRoots(candidates: TranslationCandidate[]): void {
    for (const candidate of candidates) {
      const root = candidate.observedElement.getRootNode();
      if (root instanceof ShadowRoot) this.setupMutationObserver(root);
    }
  }

  private async languageDecision(
    candidate: TranslationCandidate,
    generation: number,
  ): Promise<boolean> {
    if (this.ignoredIds.has(candidate.id)) return false;
    this.pendingLanguageIds.add(candidate.id);
    try {
      const pageLanguage = await (
        this.pageLanguagePromise ?? Promise.resolve(this.pageLanguage)
      );
      if (generation !== this.generation) return false;
      const normalizedSource = candidate.source
        .trim()
        .replace(/\s+/g, ' ')
        .toLocaleLowerCase();
      const key = `${this.settings.englishPagePolicy}:${pageLanguage}:${normalizedSource}`;
      let decision = this.languageDecisions.get(key);
      if (!decision) {
        decision = shouldTranslateVisibleText(
          candidate.source,
          pageLanguage,
          this.settings.englishPagePolicy,
        );
        this.languageDecisions.set(key, decision);
      }
      const shouldTranslate = await decision;
      if (!shouldTranslate && generation === this.generation) {
        this.ignoredIds.add(candidate.id);
        this.finishObservation(candidate.id);
      }
      return shouldTranslate;
    } finally {
      this.pendingLanguageIds.delete(candidate.id);
    }
  }

  private countCandidate(id: string): void {
    if (this.countedIds.has(id)) return;
    this.countedIds.add(id);
    this.status.total += 1;
    this.status.pending += 1;
  }

  private enqueue(candidate: TranslationCandidate, attempt: number, delayMs: number): void {
    if (!this.queuedIds.has(candidate.id)) this.queuedIds.add(candidate.id);
    this.queue.push({ candidate, attempt, readyAt: monotonicNow() + delayMs });
  }

  private schedulePump(): void {
    if (!this.initialized || this.pumpTimer) return;
    this.pumpTimer = setTimeout(() => {
      this.pumpTimer = undefined;
      this.pump();
    }, 0);
  }

  private pump(): void {
    if (!this.initialized) return;
    this.removeInvisibleQueuedItems();

    const rateLimitDelay = this.rateLimitUntil - monotonicNow();
    if (rateLimitDelay > 0) {
      if (!this.pumpTimer) {
        this.pumpTimer = setTimeout(() => {
          this.pumpTimer = undefined;
          this.pump();
        }, rateLimitDelay);
      }
      return;
    }

    while (this.activeRequestCount < this.effectiveConcurrency) {
      const batchItems = this.takeNextBatch();
      if (batchItems.length === 0) break;
      void this.dispatchBatch(batchItems);
    }

    const nextReadyAt = this.queue.reduce(
      (earliest, item) => Math.min(earliest, item.readyAt),
      Infinity,
    );
    if (Number.isFinite(nextReadyAt) && nextReadyAt > monotonicNow() && !this.pumpTimer) {
      this.pumpTimer = setTimeout(() => {
        this.pumpTimer = undefined;
        this.pump();
      }, Math.max(0, nextReadyAt - monotonicNow()));
    }
    this.settleStatusIfIdle();
  }

  private takeNextBatch(): QueueItem[] {
    const now = monotonicNow();
    const available = this.queue
      .filter((item) => item.readyAt <= now && this.isCandidateVisible(item.candidate))
      .sort((a, b) => this.candidateOrder(a.candidate) - this.candidateOrder(b.candidate));
    const first = available[0];
    if (!first) return [];

    const isRetry = first.attempt > 0;
    const priority = !this.priorityBatchSent && !isRetry;
    const maxSegments = priority || isRetry ? PRIORITY_BATCH_SEGMENTS : MAX_BATCH_SEGMENTS;
    const maxCharacters =
      priority || isRetry ? PRIORITY_BATCH_CHARACTERS : MAX_BATCH_CHARACTERS;
    const selected: QueueItem[] = [];
    let characters = 0;
    let hitBatchLimit = false;
    for (const item of available) {
      if ((item.attempt > 0) !== isRetry) continue;
      const overLimit =
        selected.length > 0 &&
        (selected.length >= maxSegments ||
          characters + item.candidate.source.length > maxCharacters);
      if (overLimit) {
        hitBatchLimit = true;
        break;
      }
      selected.push(item);
      characters += item.candidate.source.length;
    }
    if (!priority && !isRetry && this.scanMayHaveMore && !hitBatchLimit) return [];
    const selectedSet = new Set(selected);
    this.queue = this.queue.filter((item) => !selectedSet.has(item));
    if (priority) this.priorityBatchSent = true;
    return selected;
  }

  private candidateOrder(candidate: TranslationCandidate): number {
    const rect = candidate.observedElement.getBoundingClientRect();
    const width = Math.max(1, this.document.defaultView?.innerWidth ?? 1);
    return rect.top * width + rect.left;
  }

  private async dispatchBatch(items: QueueItem[]): Promise<void> {
    const requestId = `r${this.generation}-${this.nextRequestNumber++}`;
    const active: ActiveBatch = {
      requestId,
      generation: this.generation,
      items,
      cancelled: false,
    };
    this.activeBatches.set(requestId, active);
    this.activeRequestCount += 1;
    for (const item of items) this.inFlightIds.add(item.candidate.id);
    this.status.state = 'translating';

    try {
      const response = (await browser.runtime.sendMessage({
        type: 'TRANSLATE_BATCH',
        payload: {
          requestId,
          generation: active.generation,
          pageTitle: this.document.title,
          pageLanguage: this.pageLanguage,
          targetLanguage: 'English',
          segments: items.map(({ candidate }) => ({
            id: candidate.id,
            text: candidate.source,
          })),
        },
      })) as TranslationBatchResponse;
      if (active.cancelled || active.generation !== this.generation) {
        for (const item of items) this.dropCandidate(item.candidate.id);
        return;
      }
      this.status.providerMs += Math.round(response.providerMs);
      this.status.requestCount += response.requestCount;
      this.adjustConcurrency(response);
      this.handleBatchResponse(active, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.status.lastError = message;
      for (const item of items) this.retryOrFail(item, 0);
    } finally {
      this.activeBatches.delete(requestId);
      this.activeRequestCount = Math.max(0, this.activeRequestCount - 1);
      for (const item of items) this.inFlightIds.delete(item.candidate.id);
      this.schedulePump();
      this.settleStatusIfIdle();
    }
  }

  private handleBatchResponse(active: ActiveBatch, response: TranslationBatchResponse): void {
    const failed = new Set(response.failedIds);
    const retryable = new Set(response.retryableIds);
    if (response.error) this.status.lastError = response.error.message;
    const retryDelay = Math.min(2_000, response.error?.retryAfterMs ?? 0);

    for (const item of active.items) {
      const { candidate } = item;
      this.inFlightIds.delete(candidate.id);
      if (!this.countedIds.has(candidate.id)) continue;
      if (!this.isCandidateVisible(candidate)) {
        this.dropCandidate(candidate.id);
        continue;
      }

      const translation = response.translations[candidate.id];
      if (
        translation &&
        currentCandidateValue(candidate) === originalCandidateValue(candidate) &&
        applyCandidate(candidate, translation)
      ) {
        this.highlightFeedback.flash(candidate);
        this.completeCandidate(candidate.id, false);
      } else if (retryable.has(candidate.id)) {
        this.retryOrFail(item, retryDelay);
      } else if (failed.has(candidate.id) || !translation) {
        this.failCandidate(candidate.id);
      } else {
        this.retryOrFail(item, 0);
      }
    }
  }

  private retryOrFail(item: QueueItem, delayMs: number): void {
    this.inFlightIds.delete(item.candidate.id);
    if (item.attempt >= 1 || !this.isCandidateVisible(item.candidate)) {
      if (this.isCandidateVisible(item.candidate)) this.failCandidate(item.candidate.id);
      else this.dropCandidate(item.candidate.id);
      return;
    }
    this.enqueue(item.candidate, item.attempt + 1, delayMs);
  }

  private adjustConcurrency(response: TranslationBatchResponse): void {
    if (response.error?.code === 'RATE_LIMITED') {
      this.effectiveConcurrency = Math.max(1, Math.floor(this.effectiveConcurrency / 2));
      this.successfulRequestStreak = 0;
      const retryAfterMs = response.error.retryAfterMs ?? MIN_RATE_LIMIT_PAUSE_MS;
      const pauseMs = Math.min(
        MAX_RATE_LIMIT_PAUSE_MS,
        Math.max(MIN_RATE_LIMIT_PAUSE_MS, retryAfterMs),
      );
      this.rateLimitUntil = Math.max(this.rateLimitUntil, monotonicNow() + pauseMs);
      return;
    }
    if (response.error) {
      this.successfulRequestStreak = 0;
      return;
    }
    this.successfulRequestStreak += Math.max(1, response.requestCount);
    if (
      this.successfulRequestStreak >= 10 &&
      this.effectiveConcurrency < this.settings.concurrency
    ) {
      this.effectiveConcurrency += 1;
      this.successfulRequestStreak = 0;
    }
  }

  private completeCandidate(id: string, cached: boolean): void {
    if (!this.countedIds.has(id)) return;
    this.status.pending = Math.max(0, this.status.pending - 1);
    this.status.translated += 1;
    if (cached) this.status.cached += 1;
    if (this.status.firstResultMs === 0 && this.runStartedAt > 0) {
      this.status.firstResultMs = Math.round(monotonicNow() - this.runStartedAt);
    }
    this.queuedIds.delete(id);
    this.preparingIds.delete(id);
    this.inFlightIds.delete(id);
    this.finishObservation(id);
  }

  private failCandidate(id: string): void {
    if (!this.countedIds.has(id)) return;
    const candidate = this.candidates.get(id);
    if (candidate) this.highlightFeedback.removePending(candidate);
    this.status.pending = Math.max(0, this.status.pending - 1);
    this.status.failed += 1;
    this.exhaustedIds.add(id);
    this.queuedIds.delete(id);
    this.preparingIds.delete(id);
    this.inFlightIds.delete(id);
  }

  private dropCandidate(id: string): void {
    const candidate = this.candidates.get(id);
    if (candidate) this.highlightFeedback.removePending(candidate);
    this.queue = this.queue.filter((item) => item.candidate.id !== id);
    if (this.countedIds.delete(id)) {
      this.status.pending = Math.max(0, this.status.pending - 1);
      this.status.total = Math.max(
        this.status.translated + this.status.failed,
        this.status.total - 1,
      );
    }
    this.queuedIds.delete(id);
    this.preparingIds.delete(id);
    this.inFlightIds.delete(id);
  }

  private isCandidateVisible(candidate: TranslationCandidate): boolean {
    return isCandidateInViewport(candidate, this.document);
  }

  private removeInvisibleQueuedItems(): void {
    for (const item of [...this.queue]) {
      if (!this.isCandidateVisible(item.candidate)) this.dropCandidate(item.candidate.id);
    }
  }

  private cancelInvisibleWork(): void {
    this.removeInvisibleQueuedItems();
    for (const id of [...this.preparingIds]) {
      const candidate = this.candidates.get(id);
      if (!candidate || !this.isCandidateVisible(candidate)) this.dropCandidate(id);
    }
    this.cancelInvisibleBatches();
  }

  private cancelInvisibleBatches(): void {
    for (const batch of this.activeBatches.values()) {
      for (const { candidate } of batch.items) {
        if (!this.isCandidateVisible(candidate)) {
          this.dropCandidate(candidate.id);
          // Keep the candidate reserved until this mixed request settles.
          this.inFlightIds.add(candidate.id);
        }
      }
      if (
        !batch.cancelled &&
        batch.items.every(({ candidate }) => !this.isCandidateVisible(candidate))
      ) {
        this.abortBatch(batch);
      }
    }
  }

  private abortBatch(batch: ActiveBatch): void {
    if (batch.cancelled) return;
    batch.cancelled = true;
    void browser.runtime.sendMessage({
      type: 'CANCEL_TRANSLATION_BATCH',
      requestId: batch.requestId,
      generation: batch.generation,
    });
  }

  private setupViewportListeners(): void {
    if (this.viewportListenersActive) return;
    this.document.addEventListener('scroll', this.handleViewportChange, true);
    this.document.defaultView?.addEventListener('resize', this.handleViewportChange);
    this.viewportListenersActive = true;
  }

  private teardownViewportListeners(): void {
    if (!this.viewportListenersActive) return;
    this.document.removeEventListener('scroll', this.handleViewportChange, true);
    this.document.defaultView?.removeEventListener('resize', this.handleViewportChange);
    this.viewportListenersActive = false;
  }

  private cancelQueuedCandidate(id: string): void {
    if (!this.queuedIds.has(id) || this.inFlightIds.has(id)) return;
    const candidate = this.candidates.get(id);
    if (!candidate || !this.isCandidateVisible(candidate)) this.dropCandidate(id);
  }

  private finishObservation(id: string): void {
    const candidate = this.candidates.get(id);
    if (!candidate) return;
    const ids = this.observedCandidates.get(candidate.observedElement);
    if (!ids) return;
    ids.delete(id);
    if (ids.size > 0) return;
    this.observedCandidates.delete(candidate.observedElement);
    this.intersectionObserver?.unobserve(candidate.observedElement);
  }

  private removeCandidatesWithin(node: Node): void {
    for (const [id, candidate] of this.candidates) {
      const removed =
        (node instanceof Text &&
          candidate.target.kind === 'text' &&
          candidate.target.node === node) ||
        (node instanceof Element &&
          (node === candidate.observedElement || node.contains(candidate.observedElement) ||
            (candidate.target.kind !== 'text' && node.contains(candidate.target.element))));
      if (removed) this.removeCandidate(id);
    }
  }

  private removeCandidate(id: string): void {
    const candidate = this.candidates.get(id);
    if (!candidate) return;
    if (candidate.target.kind === 'select-label') restoreCandidate(candidate);
    this.highlightFeedback.remove(candidate);
    this.finishObservation(id);
    if (candidate.target.kind === 'text') this.textTargets.delete(candidate.target.node);
    else this.attributeTargets.get(candidate.target.element)?.delete(candidate.target.attribute);
    this.dropCandidate(id);
    this.candidates.delete(id);
    this.ignoredIds.delete(id);
    this.exhaustedIds.delete(id);
    this.pendingLanguageIds.delete(id);
    this.readyForPreparationIds.delete(id);
  }

  private pruneDisconnectedCandidates(): void {
    for (const [id, candidate] of this.candidates) {
      if (!candidate.observedElement.isConnected ||
        (candidate.target.kind !== 'text' && !candidate.target.element.isConnected)) this.removeCandidate(id);
    }
  }

  private settleStatusIfIdle(): void {
    if (
      this.scanPromise ||
      this.scanMayHaveMore ||
      this.pendingLanguageIds.size > 0 ||
      this.readyForPreparationIds.size > 0 ||
      this.preparationTimer ||
      this.preparationPromise ||
      this.preparingIds.size > 0 ||
      this.queue.length > 0 ||
      this.activeRequestCount > 0
    ) {
      return;
    }
    this.status.state =
      this.status.translated === 0 && this.status.failed > 0 ? 'error' : 'complete';
    if (this.runStartedAt > 0) {
      this.status.totalMs = Math.round(monotonicNow() - this.runStartedAt);
    }
  }
}
