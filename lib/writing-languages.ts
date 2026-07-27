import type { TargetLanguage } from './types';

export const DEFAULT_WRITING_TARGET: TargetLanguage = { code: 'en', name: 'English' };

export const WRITING_TARGET_LANGUAGES: readonly TargetLanguage[] = [
  DEFAULT_WRITING_TARGET,
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'it', name: 'Italian' },
  { code: 'nl', name: 'Dutch' },
  { code: 'pl', name: 'Polish' },
  { code: 'ru', name: 'Russian' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'tr', name: 'Turkish' },
  { code: 'ar', name: 'Arabic' },
  { code: 'fa', name: 'Persian' },
  { code: 'he', name: 'Hebrew' },
  { code: 'zh-Hans', name: 'Chinese (Simplified)' },
  { code: 'zh-Hant', name: 'Chinese (Traditional)' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'th', name: 'Thai' },
  { code: 'id', name: 'Indonesian' },
  { code: 'ms', name: 'Malay' },
  { code: 'fil', name: 'Filipino' },
  { code: 'sw', name: 'Swahili' },
  { code: 'hi', name: 'Hindi' },
  { code: 'bn', name: 'Bengali' },
  { code: 'te', name: 'Telugu' },
  { code: 'mr', name: 'Marathi' },
  { code: 'ta', name: 'Tamil' },
  { code: 'ur', name: 'Urdu' },
  { code: 'gu', name: 'Gujarati' },
  { code: 'kn', name: 'Kannada' },
  { code: 'ml', name: 'Malayalam' },
  { code: 'or', name: 'Odia' },
  { code: 'pa', name: 'Punjabi' },
  { code: 'as', name: 'Assamese' },
  { code: 'sa', name: 'Sanskrit' },
  { code: 'ne', name: 'Nepali' },
] as const;

const LANGUAGE_CODE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/;
const LANGUAGE_NAME_PATTERN = /^[\p{L}][\p{L}\p{M} .'()+/-]{1,59}$/u;

function normalizeCode(code: string): string {
  return code
    .trim()
    .split('-')
    .map((part, index) => {
      if (index === 0) return part.toLowerCase();
      return part.length === 2 ? part.toUpperCase() : part;
    })
    .join('-');
}

export function validateTargetLanguage(input: TargetLanguage): TargetLanguage | undefined {
  const code = input.code.trim();
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (!LANGUAGE_CODE_PATTERN.test(code) || !LANGUAGE_NAME_PATTERN.test(name)) return undefined;

  const known = WRITING_TARGET_LANGUAGES.find(
    (language) => language.code.toLowerCase() === code.toLowerCase(),
  );
  return known ? { ...known } : { code: normalizeCode(code), name };
}

export function customTargetLanguage(
  name: string,
  code: string,
): { language?: TargetLanguage; error?: string } {
  const language = validateTargetLanguage({ name, code });
  if (!language) {
    return {
      error: 'Enter a language name and a valid code such as eo or pt-BR.',
    };
  }
  return { language };
}
