import { DRAFT_CACHE_MAX_BYTES, DRAFT_CACHE_MAX_ENTRIES } from './constants';
import type { DraftTranslationRequest } from './types';

interface DraftCacheEntry {
  translation: string;
  size: number;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function draftCacheKey(request: DraftTranslationRequest, model: string): string {
  return JSON.stringify({
    model,
    target: request.targetLanguage,
    text: request.text,
  });
}

export class DraftTranslationCache {
  private readonly entries = new Map<string, DraftCacheEntry>();
  private bytes = 0;

  constructor(
    private readonly maxEntries = DRAFT_CACHE_MAX_ENTRIES,
    private readonly maxBytes = DRAFT_CACHE_MAX_BYTES,
  ) {}

  get(key: string): string | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.translation;
  }

  set(key: string, translation: string): void {
    const size = byteLength(key) + byteLength(translation);
    if (size > this.maxBytes || this.maxEntries < 1) return;

    const previous = this.entries.get(key);
    if (previous) {
      this.bytes -= previous.size;
      this.entries.delete(key);
    }
    this.entries.set(key, { translation, size });
    this.bytes += size;

    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (!oldestKey) break;
      const oldest = this.entries.get(oldestKey);
      if (oldest) this.bytes -= oldest.size;
      this.entries.delete(oldestKey);
    }
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }

  get size(): number {
    return this.entries.size;
  }

  get byteSize(): number {
    return this.bytes;
  }
}

export const draftTranslationCache = new DraftTranslationCache();
