import { describe, expect, it } from 'vitest';
import { ImageTranslationCache, imageCacheKey } from '../lib/image-cache';

const request = {
  requestId: 'image-1',
  imageDataUrl: 'data:image/png;base64,YQ==',
  targetLanguage: { code: 'en', name: 'English' },
};

describe('image translation memory cache', () => {
  it('keys results by image, target, prompt version, and model context', async () => {
    const first = await imageCacheKey(request, 'endpoint\u0000gpt-5.6-luna');
    const otherTarget = await imageCacheKey(
      { ...request, targetLanguage: { code: 'ta', name: 'Tamil' } },
      'endpoint\u0000gpt-5.6-luna',
    );
    const otherModel = await imageCacheKey(request, 'endpoint\u0000gpt-5.6-terra');

    expect(first).not.toBe(otherTarget);
    expect(first).not.toBe(otherModel);
    expect(first).not.toContain(request.imageDataUrl);
  });

  it('keeps translated text in a bounded least-recently-used cache', () => {
    const cache = new ImageTranslationCache(2, 10_000);
    cache.set('one', { hasText: true, translation: 'First' });
    cache.set('two', { hasText: false });
    expect(cache.get('one')).toEqual({ hasText: true, translation: 'First' });

    cache.set('three', { hasText: true, sourceLanguage: 'French', translation: 'Third' });
    expect(cache.get('two')).toBeUndefined();
    expect(cache.get('one')).toEqual({ hasText: true, translation: 'First' });
    expect(cache.size).toBe(2);

    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.byteSize).toBe(0);
  });
});
