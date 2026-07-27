import {
  IMAGE_CACHE_MAX_BYTES,
  IMAGE_CACHE_MAX_ENTRIES,
  IMAGE_PROMPT_VERSION,
} from './constants';
import type { ImageTranslationRequest, ImageTranslationResult } from './types';

interface ImageCacheEntry {
  result: ImageTranslationResult;
  size: number;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function imageCacheKey(
  request: ImageTranslationRequest,
  modelContext: string,
): Promise<string> {
  const imageHash = await hash(request.imageDataUrl);
  return JSON.stringify({
    promptVersion: IMAGE_PROMPT_VERSION,
    model: modelContext,
    target: request.targetLanguage,
    imageHash,
  });
}

export class ImageTranslationCache {
  private readonly entries = new Map<string, ImageCacheEntry>();
  private bytes = 0;

  constructor(
    private readonly maxEntries = IMAGE_CACHE_MAX_ENTRIES,
    private readonly maxBytes = IMAGE_CACHE_MAX_BYTES,
  ) {}

  get(key: string): ImageTranslationResult | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return { ...entry.result };
  }

  set(key: string, result: ImageTranslationResult): void {
    const stored = { ...result };
    const size = byteLength(key) + byteLength(JSON.stringify(stored));
    if (size > this.maxBytes || this.maxEntries < 1) return;

    const previous = this.entries.get(key);
    if (previous) {
      this.bytes -= previous.size;
      this.entries.delete(key);
    }
    this.entries.set(key, { result: stored, size });
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

export const imageTranslationCache = new ImageTranslationCache();
