import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  detectPageLanguage,
  isPotentiallyTranslatableText,
  shouldTranslateVisibleText,
} from '../lib/language';

const { detectLanguage } = vi.hoisted(() => ({
  detectLanguage: vi.fn(),
}));

vi.mock('wxt/browser', () => ({
  browser: { i18n: { detectLanguage } },
}));

describe('visible text language checks', () => {
  beforeEach(() => detectLanguage.mockReset());

  it.each(['Bonjour tout le monde', 'Hola a todos'])(
    'detects foreign Latin-script prose inside an English application: %s',
    async (text) => {
      detectLanguage.mockResolvedValue({
        isReliable: true,
        languages: [{ language: 'fr', percentage: 95 }],
      });

      await expect(shouldTranslateVisibleText(text, 'en', 'strong-evidence')).resolves.toBe(true);
    },
  );

  it.each([
    'AI SYSTEM',
    'Anthropic',
    'Claude Opus 5 (High)',
    'Thinking Machines',
    'GPT-5.6 Sol (Low)',
  ])('rejects English names and identifiers despite a foreign detection: %s', async (text) => {
    detectLanguage.mockResolvedValue({
      isReliable: true,
      languages: [{ language: 'fr', percentage: 95 }],
    });

    await expect(shouldTranslateVisibleText(text, 'en', 'strong-evidence')).resolves.toBe(false);
  });

  it('does not send English application labels for translation', async () => {
    detectLanguage.mockResolvedValue({
      isReliable: true,
      languages: [{ language: 'en', percentage: 99 }],
    });

    await expect(
      shouldTranslateVisibleText('Open settings', 'en', 'strong-evidence'),
    ).resolves.toBe(false);
  });

  it('requires a reliable, high-confidence foreign result for Latin text', async () => {
    detectLanguage.mockResolvedValue({
      isReliable: false,
      languages: [{ language: 'fr', percentage: 99 }],
    });

    await expect(
      shouldTranslateVisibleText('Bonjour tout le monde', 'en', 'strong-evidence'),
    ).resolves.toBe(false);

    detectLanguage.mockResolvedValue({
      isReliable: true,
      languages: [{ language: 'und', percentage: 100 }],
    });
    await expect(
      shouldTranslateVisibleText('Bonjour tout le monde', 'en', 'strong-evidence'),
    ).resolves.toBe(false);

    detectLanguage.mockResolvedValue({
      isReliable: true,
      languages: [{ language: 'fr', percentage: 79 }],
    });
    await expect(
      shouldTranslateVisibleText('Bonjour tout le monde', 'en', 'strong-evidence'),
    ).resolves.toBe(false);
  });

  it('accepts a reliable foreign single word on a known non-English page', async () => {
    detectLanguage.mockResolvedValue({
      isReliable: true,
      languages: [{ language: 'fr', percentage: 95 }],
    });

    await expect(shouldTranslateVisibleText('Bonjour', 'de', 'strong-evidence')).resolves.toBe(true);
  });

  it('requires prose evidence on an unknown page in strong-evidence mode', async () => {
    detectLanguage.mockResolvedValue({
      isReliable: true,
      languages: [{ language: 'fr', percentage: 95 }],
    });

    await expect(
      shouldTranslateVisibleText('Anthropic', 'unknown', 'strong-evidence'),
    ).resolves.toBe(false);
    await expect(
      shouldTranslateVisibleText('Bonjour tout le monde', 'unknown', 'strong-evidence'),
    ).resolves.toBe(true);
  });

  it('accepts a non-ASCII Latin word as strong evidence', async () => {
    detectLanguage.mockResolvedValue({
      isReliable: true,
      languages: [{ language: 'fr', percentage: 95 }],
    });

    await expect(shouldTranslateVisibleText('Français', 'en', 'strong-evidence')).resolves.toBe(true);
  });

  it('skips Latin text on English pages in strict mode without detection', async () => {
    await expect(shouldTranslateVisibleText('Bonjour tout le monde', 'EN-us', 'strict')).resolves.toBe(
      false,
    );
    expect(detectLanguage).not.toHaveBeenCalled();
  });

  it('keeps the prose-evidence gate when strict mode cannot identify the page language', async () => {
    detectLanguage.mockResolvedValue({
      isReliable: true,
      languages: [{ language: 'fr', percentage: 95 }],
    });

    await expect(shouldTranslateVisibleText('Anthropic', 'unknown', 'strict')).resolves.toBe(false);
    await expect(
      shouldTranslateVisibleText('Bonjour tout le monde', 'unknown', 'strict'),
    ).resolves.toBe(true);
  });

  it('accepts non-Latin text without waiting for language detection', async () => {
    await expect(shouldTranslateVisibleText('大量出售官方账号', 'en', 'strict')).resolves.toBe(true);
    expect(detectLanguage).not.toHaveBeenCalled();
  });

  it('accepts a single non-Latin letter but ignores a single Latin letter without detection', async () => {
    expect(isPotentiallyTranslatableText('你')).toBe(true);
    expect(isPotentiallyTranslatableText('A')).toBe(false);
    await expect(shouldTranslateVisibleText('你', 'en', 'strict')).resolves.toBe(true);
    await expect(shouldTranslateVisibleText('A', 'en', 'strong-evidence')).resolves.toBe(false);
    expect(detectLanguage).not.toHaveBeenCalled();
  });
});

describe('page language detection', () => {
  beforeEach(() => detectLanguage.mockReset());

  it('uses a declared page language without browser detection', async () => {
    const page = document.implementation.createHTMLDocument();
    page.documentElement.lang = 'FR-ca';

    await expect(detectPageLanguage(page)).resolves.toBe('fr');
    expect(detectLanguage).not.toHaveBeenCalled();
  });

  it('accepts only reliable body-language detection at 80 percent or higher', async () => {
    const page = document.implementation.createHTMLDocument();
    page.body.innerText = 'Bonjour tout le monde';
    detectLanguage.mockResolvedValue({
      isReliable: true,
      languages: [{ language: 'fr-CA', percentage: 80 }],
    });

    await expect(detectPageLanguage(page)).resolves.toBe('fr');
  });

  it.each([
    { isReliable: false, language: 'fr', percentage: 99 },
    { isReliable: true, language: 'fr', percentage: 79 },
    { isReliable: true, language: 'und', percentage: 100 },
  ])('returns unknown for an unusable body-language result: %o', async (result) => {
    const page = document.implementation.createHTMLDocument();
    page.body.innerText = 'Bonjour tout le monde';
    detectLanguage.mockResolvedValue({
      isReliable: result.isReliable,
      languages: [{ language: result.language, percentage: result.percentage }],
    });

    await expect(detectPageLanguage(page)).resolves.toBe('unknown');
  });
});
