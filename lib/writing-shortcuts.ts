import type { TargetLanguage } from './types';
import { DEFAULT_WRITING_TARGET, validateTargetLanguage } from './writing-languages';

export const WRITING_SHORTCUT_COUNT = 9;

export function normalizeWritingShortcuts(input?: unknown): Array<TargetLanguage | null> {
  if (!Array.isArray(input)) {
    return Array.from({ length: WRITING_SHORTCUT_COUNT }, (_, index) =>
      index === 0 ? { ...DEFAULT_WRITING_TARGET } : null,
    );
  }
  return Array.from({ length: WRITING_SHORTCUT_COUNT }, (_, index) => {
    const target: unknown = input[index];
    if (
      !target || typeof target !== 'object' ||
      !('code' in target) || typeof target.code !== 'string' ||
      !('name' in target) || typeof target.name !== 'string'
    ) return null;
    return validateTargetLanguage({ code: target.code, name: target.name }) ?? null;
  });
}
