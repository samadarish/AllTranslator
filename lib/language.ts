import { browser } from 'wxt/browser';
import type { EnglishPagePolicy } from './types';

const LETTER_PATTERN = /\p{L}/u;
const NON_LATIN_PATTERN = /(?:(?!\p{Script=Latin})\p{L})/u;
const LATIN_WORD_PATTERN = /\p{Script=Latin}+/gu;
const LOWERCASE_LETTER_PATTERN = /^\p{Ll}/u;
const NON_ASCII_PATTERN = /[^\x00-\x7f]/;
const URL_OR_EMAIL_PATTERN = /^(?:https?:\/\/|www\.|mailto:|[^\s@]+@[^\s@]+\.[^\s@]+)\S*$/i;
const MINIMUM_LANGUAGE_CONFIDENCE = 80;

function normalizeLanguage(language: string): string {
  return language.trim().toLowerCase();
}

function isEnglishLanguage(language: string): boolean {
  return normalizeLanguage(language).startsWith('en');
}

function isUnknownLanguage(language: string): boolean {
  const normalized = normalizeLanguage(language);
  return !normalized || normalized === 'unknown' || normalized === 'und';
}

function hasForeignProseEvidence(text: string): boolean {
  const words = text.match(LATIN_WORD_PATTERN) ?? [];
  return (
    words.some((word) => NON_ASCII_PATTERN.test(word)) ||
    (words.length >= 2 && words.slice(1).some((word) => LOWERCASE_LETTER_PATTERN.test(word)))
  );
}

export function isPotentiallyTranslatableText(text: string): boolean {
  const value = text.trim();
  return (
    LETTER_PATTERN.test(value) &&
    (value.length >= 2 || NON_LATIN_PATTERN.test(value)) &&
    !URL_OR_EMAIL_PATTERN.test(value)
  );
}

export function shouldTranslateText(text: string, pageLanguage: string): boolean {
  const value = text.trim();
  if (!isPotentiallyTranslatableText(value)) return false;
  if (NON_LATIN_PATTERN.test(value)) return true;
  return !pageLanguage.toLowerCase().startsWith('en');
}

export async function shouldTranslateVisibleText(
  text: string,
  pageLanguage: string,
  englishPagePolicy: EnglishPagePolicy,
): Promise<boolean> {
  const value = text.trim();
  if (!isPotentiallyTranslatableText(value)) return false;
  if (NON_LATIN_PATTERN.test(value)) return true;
  if (englishPagePolicy === 'strict' && isEnglishLanguage(pageLanguage)) return false;

  try {
    const result = await browser.i18n.detectLanguage(value);
    const best = [...result.languages].sort((a, b) => b.percentage - a.percentage)[0];
    const detectedLanguage = normalizeLanguage(best?.language ?? '');
    if (
      !result.isReliable ||
      !best ||
      best.percentage < MINIMUM_LANGUAGE_CONFIDENCE ||
      !detectedLanguage ||
      detectedLanguage === 'und' ||
      detectedLanguage.startsWith('en')
    ) {
      return false;
    }

    if (
      isUnknownLanguage(pageLanguage) ||
      (englishPagePolicy === 'strong-evidence' && isEnglishLanguage(pageLanguage))
    ) {
      return hasForeignProseEvidence(value);
    }

    return true;
  } catch {
    return false;
  }
}

export async function detectPageLanguage(document: Document): Promise<string> {
  const declared = document.documentElement.lang.trim().toLowerCase();
  if (declared && declared !== 'und') return declared.split('-')[0] ?? declared;

  const sample = (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 4_000);
  if (!sample) return 'unknown';
  try {
    const result = await browser.i18n.detectLanguage(sample);
    const best = [...result.languages].sort((a, b) => b.percentage - a.percentage)[0];
    const detectedLanguage = normalizeLanguage(best?.language ?? '');
    return result.isReliable &&
      best &&
      best.percentage >= MINIMUM_LANGUAGE_CONFIDENCE &&
      detectedLanguage &&
      detectedLanguage !== 'und'
      ? detectedLanguage.split('-')[0] ?? detectedLanguage
      : 'unknown';
  } catch {
    return 'unknown';
  }
}
