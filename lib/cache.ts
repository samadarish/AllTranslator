import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { CACHE_MAX_BYTES, PROMPT_VERSION } from './constants';
import type { TranslationSegment, TranslatorSettings } from './types';
import { isUsefulEnglishTranslation } from './translation-validation';

interface CacheRecord {
  key: string;
  source: string;
  translation: string;
  createdAt: number;
  lastAccessed: number;
  size: number;
}

interface TranslatorCacheDb extends DBSchema {
  translations: {
    key: string;
    value: CacheRecord;
    indexes: {
      'by-last-accessed': number;
    };
  };
}

const HOT_CACHE_MAX_ENTRIES = 500;

async function hash(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function buildCacheKey(text: string, settings: TranslatorSettings): Promise<string> {
  return hash(
    JSON.stringify({
      promptVersion: PROMPT_VERSION,
      model: settings.model,
      target: settings.targetLanguage,
      text: text.trim().replace(/\s+/g, ' '),
    }),
  );
}

export class TranslationCache {
  private databasePromise?: Promise<IDBPDatabase<TranslatorCacheDb>>;
  private readonly hot = new Map<string, CacheRecord>();
  private readonly pendingTouches = new Set<string>();
  private readonly pendingDeletes = new Set<string>();
  private maintenanceTimer?: ReturnType<typeof setTimeout>;
  private maintenanceEpoch = 0;

  private database(): Promise<IDBPDatabase<TranslatorCacheDb>> {
    this.databasePromise ??= openDB<TranslatorCacheDb>('fast-ai-translator', 1, {
      upgrade(database) {
        const store = database.createObjectStore('translations', { keyPath: 'key' });
        store.createIndex('by-last-accessed', 'lastAccessed');
      },
    });
    return this.databasePromise;
  }

  private remember(record: CacheRecord): void {
    this.hot.delete(record.key);
    this.hot.set(record.key, record);
    while (this.hot.size > HOT_CACHE_MAX_ENTRIES) {
      const oldest = this.hot.keys().next().value as string | undefined;
      if (!oldest) break;
      this.hot.delete(oldest);
    }
  }

  private deferMaintenance(touches: Iterable<string>, deletes: Iterable<string>): void {
    for (const key of touches) {
      if (!this.pendingDeletes.has(key)) this.pendingTouches.add(key);
    }
    for (const key of deletes) {
      this.pendingTouches.delete(key);
      this.pendingDeletes.add(key);
    }
    if (this.maintenanceTimer || (!this.pendingTouches.size && !this.pendingDeletes.size)) return;
    this.maintenanceTimer = setTimeout(() => {
      this.maintenanceTimer = undefined;
      void this.flushMaintenance(this.maintenanceEpoch);
    }, 0);
  }

  private async flushMaintenance(epoch: number): Promise<void> {
    const touches = [...this.pendingTouches];
    const deletes = [...this.pendingDeletes];
    this.pendingTouches.clear();
    this.pendingDeletes.clear();
    if (!touches.length && !deletes.length) return;

    try {
      const database = await this.database();
      if (epoch !== this.maintenanceEpoch) return;
      const transaction = database.transaction('translations', 'readwrite');
      const now = Date.now();
      await Promise.all([
        ...deletes.map((key) => transaction.store.delete(key)),
        ...touches.map(async (key) => {
          const record = await transaction.store.get(key);
          if (!record) return;
          record.lastAccessed = now;
          await transaction.store.put(record);
        }),
      ]);
      await transaction.done;
    } catch {
      // Cache maintenance is best effort and never blocks a translation.
    }
  }

  async getMany(
    segments: TranslationSegment[],
    settings: TranslatorSettings,
  ): Promise<Record<string, string>> {
    if (!settings.useCache || segments.length === 0) return {};
    const keys = await Promise.all(segments.map((segment) => buildCacheKey(segment.text, settings)));
    const now = Date.now();
    const expiresBefore = now - settings.cacheTtlDays * 86_400_000;
    const translations: Record<string, string> = {};
    const missing = new Map<string, TranslationSegment[]>();
    const touches = new Set<string>();
    const deletes = new Set<string>();

    segments.forEach((segment, index) => {
      const key = keys[index];
      if (!key) return;
      const record = this.hot.get(key);
      if (
        record &&
        record.createdAt >= expiresBefore &&
        isUsefulEnglishTranslation(segment.text, record.translation)
      ) {
        translations[segment.id] = record.translation;
        this.remember(record);
        touches.add(key);
        return;
      }
      if (record) {
        this.hot.delete(key);
      }
      missing.set(key, [...(missing.get(key) ?? []), segment]);
    });

    if (missing.size > 0) {
      const database = await this.database();
      const transaction = database.transaction('translations', 'readonly');
      await Promise.all(
        [...missing].map(async ([key, matchingSegments]) => {
          const record = await transaction.store.get(key);
          if (!record) return;
          const validSegments = matchingSegments.filter((segment) =>
            isUsefulEnglishTranslation(segment.text, record.translation),
          );
          if (record.createdAt < expiresBefore || validSegments.length !== matchingSegments.length) {
            deletes.add(key);
            return;
          }
          this.remember(record);
          touches.add(key);
          for (const segment of validSegments) translations[segment.id] = record.translation;
        }),
      );
      await transaction.done;
    }

    this.deferMaintenance(touches, deletes);
    return translations;
  }

  async putMany(
    segments: TranslationSegment[],
    translations: Record<string, string>,
    settings: TranslatorSettings,
  ): Promise<void> {
    if (!settings.useCache || segments.length === 0) return;
    const database = await this.database();
    const now = Date.now();
    const records = await Promise.all(
      segments.map(async (segment) => {
        const translation = translations[segment.id];
        if (!translation) return undefined;
        const key = await buildCacheKey(segment.text, settings);
        return {
          key,
          source: segment.text,
          translation,
          createdAt: now,
          lastAccessed: now,
          size: key.length + (segment.text.length + translation.length) * 2,
        } satisfies CacheRecord;
      }),
    );
    const transaction = database.transaction('translations', 'readwrite');
    await Promise.all(
      records
        .filter((record): record is CacheRecord => Boolean(record))
        .map((record) => {
          this.remember(record);
          return transaction.store.put(record);
        }),
    );
    await transaction.done;
  }

  async prune(settings: TranslatorSettings): Promise<void> {
    const database = await this.database();
    const records = await database.getAll('translations');
    const expiresBefore = Date.now() - settings.cacheTtlDays * 86_400_000;
    const valid = records.filter((record) => record.createdAt >= expiresBefore);
    valid.sort((a, b) => a.lastAccessed - b.lastAccessed);

    let totalSize = valid.reduce((total, record) => total + record.size, 0);
    const deleteKeys = records
      .filter((record) => record.createdAt < expiresBefore)
      .map((record) => record.key);
    while (totalSize > CACHE_MAX_BYTES && valid.length > 0) {
      const record = valid.shift();
      if (!record) break;
      totalSize -= record.size;
      deleteKeys.push(record.key);
    }

    const transaction = database.transaction('translations', 'readwrite');
    await Promise.all(deleteKeys.map((key) => transaction.store.delete(key)));
    await transaction.done;
    this.hot.clear();
  }

  async clear(): Promise<void> {
    this.maintenanceEpoch += 1;
    if (this.maintenanceTimer) clearTimeout(this.maintenanceTimer);
    this.maintenanceTimer = undefined;
    this.pendingTouches.clear();
    this.pendingDeletes.clear();
    this.hot.clear();
    const database = await this.database();
    await database.clear('translations');
  }
}

export const translationCache = new TranslationCache();
