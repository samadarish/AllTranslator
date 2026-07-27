const LETTER_PATTERN = /\p{L}/u;
const LATIN_LETTER_PATTERN = /\p{Script=Latin}/u;

function comparable(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function letterCounts(value: string): { letters: number; nonLatin: number } {
  let letters = 0;
  let nonLatin = 0;
  for (const character of value) {
    if (!LETTER_PATTERN.test(character)) continue;
    letters += 1;
    if (!LATIN_LETTER_PATTERN.test(character)) nonLatin += 1;
  }
  return { letters, nonLatin };
}

export function isUsefulEnglishTranslation(source: string, translation: string): boolean {
  const sourceValue = source.trim();
  const translatedValue = translation.trim();
  if (!translatedValue) return false;

  const sourceCounts = letterCounts(sourceValue);
  if (sourceCounts.nonLatin < 2) return true;
  if (comparable(sourceValue) === comparable(translatedValue)) return false;

  const translatedCounts = letterCounts(translatedValue);
  return (
    translatedCounts.letters > 0 &&
    translatedCounts.nonLatin / translatedCounts.letters <= 0.35
  );
}
