import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, sanitizeSettings, saveSettings } from '../lib/settings';
import type { TranslatorSettings } from '../lib/types';

const { getStorage, setStorage } = vi.hoisted(() => ({
  getStorage: vi.fn(),
  setStorage: vi.fn(async () => undefined),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    storage: { local: { get: getStorage, set: setStorage } },
  },
}));

const SETTINGS_KEY = 'fastAiTranslator.settings';

describe('translator settings', () => {
  beforeEach(() => {
    getStorage.mockReset();
    setStorage.mockClear();
  });

  it('defaults to eight concurrent requests and clamps the turbo range', () => {
    expect(DEFAULT_SETTINGS.concurrency).toBe(8);
    expect(DEFAULT_SETTINGS.writingTranslatorEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.imageTranslatorEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.imageModel).toBe('');
    expect(DEFAULT_SETTINGS.reasoningEffort).toBe('');
    expect(DEFAULT_SETTINGS.englishPagePolicy).toBe('strong-evidence');
    expect(sanitizeSettings({ concurrency: 0 }).concurrency).toBe(1);
    expect(sanitizeSettings({ concurrency: 24 }).concurrency).toBe(24);
    expect(sanitizeSettings({ concurrency: 40 }).concurrency).toBe(24);
  });

  it('migrates the unversioned legacy default from three to eight once', async () => {
    getStorage.mockResolvedValue({
      [SETTINGS_KEY]: { model: 'fast-model', concurrency: 3 },
    });

    await expect(loadSettings()).resolves.toMatchObject({
      model: 'fast-model',
      concurrency: 8,
    });
    expect(setStorage).toHaveBeenCalledWith({
      [SETTINGS_KEY]: expect.objectContaining({
        concurrency: 8,
        writingTranslatorEnabled: true,
        imageTranslatorEnabled: true,
        imageModel: '',
        reasoningEffort: '',
        englishPagePolicy: 'strong-evidence',
        _schemaVersion: 6,
      }),
    });
  });

  it('preserves non-default legacy and versioned concurrency choices', async () => {
    getStorage.mockResolvedValueOnce({
      [SETTINGS_KEY]: { concurrency: 5 },
    });
    await expect(loadSettings()).resolves.toMatchObject({ concurrency: 5 });
    expect(setStorage).toHaveBeenCalledOnce();

    setStorage.mockClear();
    getStorage.mockResolvedValueOnce({
      [SETTINGS_KEY]: { concurrency: 3, _schemaVersion: 2 },
    });
    await expect(loadSettings()).resolves.toMatchObject({ concurrency: 3 });
    expect(setStorage).toHaveBeenCalledWith({
      [SETTINGS_KEY]: expect.objectContaining({ concurrency: 3, _schemaVersion: 6 }),
    });
  });

  it('marks newly saved settings with the current schema version', async () => {
    const saved = await saveSettings({ concurrency: 24 });

    expect(saved.concurrency).toBe(24);
    expect(setStorage).toHaveBeenCalledWith({
      [SETTINGS_KEY]: expect.objectContaining({ concurrency: 24, _schemaVersion: 6 }),
    });
  });

  it('preserves an intentional image model while adding image defaults to older settings', async () => {
    getStorage.mockResolvedValue({
      [SETTINGS_KEY]: {
        model: 'text-model',
        imageModel: 'vision-model',
        imageTranslatorEnabled: false,
        _schemaVersion: 3,
      },
    });

    await expect(loadSettings()).resolves.toMatchObject({
      model: 'text-model',
      imageModel: 'vision-model',
      imageTranslatorEnabled: false,
    });
    expect(setStorage).toHaveBeenCalledWith({
      [SETTINGS_KEY]: expect.objectContaining({
        imageModel: 'vision-model',
        imageTranslatorEnabled: false,
        _schemaVersion: 6,
      }),
    });
  });

  it('migrates version 4 installs to the strong-evidence English page policy', async () => {
    getStorage.mockResolvedValue({
      [SETTINGS_KEY]: { model: 'fast-model', _schemaVersion: 4 },
    });

    await expect(loadSettings()).resolves.toMatchObject({
      model: 'fast-model',
      englishPagePolicy: 'strong-evidence',
    });
    expect(setStorage).toHaveBeenCalledWith({
      [SETTINGS_KEY]: expect.objectContaining({
        englishPagePolicy: 'strong-evidence',
        _schemaVersion: 6,
      }),
    });
  });

  it('accepts known English page policies and rejects malformed stored values', async () => {
    expect(sanitizeSettings({ englishPagePolicy: 'strict' }).englishPagePolicy).toBe('strict');
    getStorage.mockResolvedValue({
      [SETTINGS_KEY]: {
        englishPagePolicy: 'translate-everything' as TranslatorSettings['englishPagePolicy'],
        _schemaVersion: 6,
      },
    });

    await expect(loadSettings()).resolves.toMatchObject({
      englishPagePolicy: 'strong-evidence',
    });
  });

  it('accepts known reasoning efforts and falls back to the provider default', () => {
    expect(sanitizeSettings({ reasoningEffort: 'high' }).reasoningEffort).toBe('high');
    expect(
      sanitizeSettings({ reasoningEffort: 'unsupported' as TranslatorSettings['reasoningEffort'] })
        .reasoningEffort,
    ).toBe('');
  });
});
