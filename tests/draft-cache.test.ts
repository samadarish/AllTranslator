import { describe, expect, it } from 'vitest';
import { DraftTranslationCache, draftCacheKey } from '../lib/draft-cache';

describe('memory-only draft translation cache', () => {
  it('keys entries by provider, target, and exact draft text', () => {
    const request = {
      requestId: 'one',
      text: 'Hello',
      targetLanguage: { code: 'ta', name: 'Tamil' },
    };
    expect(draftCacheKey(request, 'provider-a')).not.toBe(
      draftCacheKey({ ...request, targetLanguage: { code: 'hi', name: 'Hindi' } }, 'provider-a'),
    );
    expect(draftCacheKey(request, 'provider-a')).not.toBe(draftCacheKey(request, 'provider-b'));
  });

  it('evicts least-recently-used entries by count', () => {
    const cache = new DraftTranslationCache(2, 10_000);
    cache.set('a', 'A');
    cache.set('b', 'B');
    expect(cache.get('a')).toBe('A');
    cache.set('c', 'C');

    expect(cache.get('a')).toBe('A');
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe('C');
    expect(cache.size).toBe(2);
  });

  it('enforces the byte ceiling and can clear draft material immediately', () => {
    const cache = new DraftTranslationCache(100, 12);
    cache.set('small', 'ok');
    cache.set('second', 'value');
    expect(cache.byteSize).toBeLessThanOrEqual(12);

    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.byteSize).toBe(0);
  });
});
