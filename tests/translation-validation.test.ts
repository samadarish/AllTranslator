import { describe, expect, it } from 'vitest';
import { isUsefulEnglishTranslation } from '../lib/translation-validation';

describe('English translation validation', () => {
  it('accepts an English translation of non-Latin text', () => {
    expect(isUsefulEnglishTranslation('ProtonMail 能不能自动注册?', 'Can ProtonMail register automatically?')).toBe(
      true,
    );
  });

  it('rejects unchanged or paraphrased non-English output', () => {
    expect(isUsefulEnglishTranslation('大量出售官方账号', '大量出售官方账号')).toBe(false);
    expect(isUsefulEnglishTranslation('大量出售官方账号', '官方账号大量出售')).toBe(false);
  });

  it('allows Latin names to remain unchanged', () => {
    expect(isUsefulEnglishTranslation('ProtonMail', 'ProtonMail')).toBe(true);
  });
});
