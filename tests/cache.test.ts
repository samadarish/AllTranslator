import { beforeEach, describe, expect, it } from 'vitest';
import { TranslationCache, buildCacheKey } from '../lib/cache';
import { DEFAULT_SETTINGS } from '../lib/settings';

const settings = { ...DEFAULT_SETTINGS, model: 'gpt-5-nano' };

describe('translation memory', () => {
  beforeEach(async () => {
    await new TranslationCache().clear();
  });

  it('changes cache keys when the model changes', async () => {
    const first = await buildCacheKey('Bonjour', settings);
    const second = await buildCacheKey('Bonjour', { ...settings, model: 'gpt-5-mini' });
    expect(first).not.toBe(second);
  });

  it('changes cache keys when reasoning effort changes', async () => {
    const first = await buildCacheKey('Bonjour', settings);
    const second = await buildCacheKey('Bonjour', { ...settings, reasoningEffort: 'high' });
    expect(first).not.toBe(second);
  });

  it('stores and retrieves translated segments', async () => {
    const cache = new TranslationCache();
    const segments = [{ id: 's1', text: 'Bonjour' }];
    await cache.putMany(segments, { s1: 'Hello' }, settings);
    await expect(cache.getMany(segments, settings)).resolves.toEqual({ s1: 'Hello' });
  });

  it('serves repeated lookups from the bounded hot cache', async () => {
    const cache = new TranslationCache();
    const segments = [{ id: 's1', text: 'Bonjour' }];
    await cache.putMany(segments, { s1: 'Hello' }, settings);

    await expect(cache.getMany(segments, settings)).resolves.toEqual({ s1: 'Hello' });
    await expect(cache.getMany([{ id: 's2', text: 'Bonjour' }], settings)).resolves.toEqual({
      s2: 'Hello',
    });
  });

  it('returns one cached value for duplicate text IDs', async () => {
    const cache = new TranslationCache();
    await cache.putMany([{ id: 's1', text: 'Bonjour' }], { s1: 'Hello' }, settings);

    await expect(
      cache.getMany(
        [
          { id: 's1', text: 'Bonjour' },
          { id: 's2', text: 'Bonjour' },
        ],
        settings,
      ),
    ).resolves.toEqual({ s1: 'Hello', s2: 'Hello' });
  });

  it('does not read or write when caching is disabled', async () => {
    const cache = new TranslationCache();
    const disabled = { ...settings, useCache: false };
    const segments = [{ id: 's1', text: 'Bonjour' }];
    await cache.putMany(segments, { s1: 'Hello' }, disabled);
    await expect(cache.getMany(segments, disabled)).resolves.toEqual({});
  });

  it('deletes cached output that is still in the source language', async () => {
    const cache = new TranslationCache();
    const segments = [{ id: 's1', text: '大量出售官方账号' }];
    await cache.putMany(segments, { s1: '大量出售官方账号' }, settings);

    await expect(cache.getMany(segments, settings)).resolves.toEqual({});
  });
});
