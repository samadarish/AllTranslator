import { describe, expect, it } from 'vitest';
import {
  customTargetLanguage,
  validateTargetLanguage,
  WRITING_TARGET_LANGUAGES,
} from '../lib/writing-languages';

describe('writing target languages', () => {
  it('includes common global and Indian languages', () => {
    expect(WRITING_TARGET_LANGUAGES).toEqual(
      expect.arrayContaining([
        { code: 'es', name: 'Spanish' },
        { code: 'zh-Hans', name: 'Chinese (Simplified)' },
        { code: 'hi', name: 'Hindi' },
        { code: 'ta', name: 'Tamil' },
        { code: 'ml', name: 'Malayalam' },
      ]),
    );
  });

  it('validates custom names and BCP-47-like language codes', () => {
    expect(customTargetLanguage('Esperanto', 'eo')).toEqual({
      language: { name: 'Esperanto', code: 'eo' },
    });
    expect(customTargetLanguage('Portuguese Brazil', 'pt-br')).toEqual({
      language: { name: 'Portuguese Brazil', code: 'pt-BR' },
    });
    expect(customTargetLanguage('Bad\nPrompt', 'not a code').error).toBeTruthy();
  });

  it('canonicalizes known codes instead of accepting spoofed names', () => {
    expect(validateTargetLanguage({ code: 'HI', name: 'Something else' })).toEqual({
      code: 'hi',
      name: 'Hindi',
    });
  });
});
