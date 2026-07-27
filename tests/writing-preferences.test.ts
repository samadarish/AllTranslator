import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWritingTarget, rememberWritingTarget } from '../lib/writing-preferences';

const { storage, getStorage, setStorage } = vi.hoisted(() => {
  const storage: Record<string, unknown> = {};
  return {
    storage,
    getStorage: vi.fn(async (key: string) => ({ [key]: storage[key] })),
    setStorage: vi.fn(async (value: Record<string, unknown>) => {
      Object.assign(storage, value);
    }),
  };
});

vi.mock('wxt/browser', () => ({
  browser: { storage: { local: { get: getStorage, set: setStorage } } },
}));

const TARGETS_KEY = 'fastAiTranslator.writingTargets';

describe('per-domain writing targets', () => {
  beforeEach(() => {
    for (const key of Object.keys(storage)) delete storage[key];
    getStorage.mockClear();
    setStorage.mockClear();
  });

  it('remembers only validated target metadata for a normalized hostname', async () => {
    await rememberWritingTarget('WWW.Example.com', { code: 'ta', name: 'Tamil' });

    await expect(loadWritingTarget('www.example.com')).resolves.toEqual({
      code: 'ta',
      name: 'Tamil',
    });
    await expect(loadWritingTarget('example.com')).resolves.toBeUndefined();
    expect(JSON.stringify(storage[TARGETS_KEY])).not.toContain('draft');
    expect(storage[TARGETS_KEY]).toEqual([
      expect.objectContaining({
        hostname: 'www.example.com',
        target: { code: 'ta', name: 'Tamil' },
      }),
    ]);
  });

  it('keeps only the 100 most recently selected domains', async () => {
    for (let index = 0; index < 101; index += 1) {
      await rememberWritingTarget(`site-${index}.example`, { code: 'hi', name: 'Hindi' });
    }

    const preferences = storage[TARGETS_KEY] as Array<{ hostname: string }>;
    expect(preferences).toHaveLength(100);
    expect(preferences[0]?.hostname).toBe('site-100.example');
    expect(preferences.some(({ hostname }) => hostname === 'site-0.example')).toBe(false);
  });
});
