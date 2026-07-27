export const EXTENSION_NAME = 'Fast AI Translator';
export const TARGET_LANGUAGE = 'English';
export const TARGET_LANGUAGE_CODE = 'en';
export const PROMPT_VERSION = 2;
export const PRIORITY_BATCH_SEGMENTS = 4;
export const PRIORITY_BATCH_CHARACTERS = 700;
export const MAX_BATCH_SEGMENTS = 6;
export const MAX_BATCH_CHARACTERS = 1_200;
export const MAX_VIEWPORT_SEGMENTS = 30;
export const MAX_VIEWPORT_CHARACTERS = 8_000;
export const CACHE_MAX_BYTES = 50 * 1024 * 1024;
export const DEFAULT_REQUEST_TIMEOUT_MS = 12_000;
export const IMAGE_REQUEST_TIMEOUT_MS = 45_000;
export const MAX_DRAFT_CHARACTERS = 8_000;
export const DRAFT_CACHE_MAX_ENTRIES = 100;
export const DRAFT_CACHE_MAX_BYTES = 1024 * 1024;
export const WRITING_TARGET_MAX_DOMAINS = 100;
export const IMAGE_PROMPT_VERSION = 1;
export const IMAGE_CAPTURE_MAX_EDGE = 2_048;
export const IMAGE_CAPTURE_MAX_BYTES = 4 * 1024 * 1024;
export const IMAGE_CACHE_MAX_ENTRIES = 50;
export const IMAGE_CACHE_MAX_BYTES = 2 * 1024 * 1024;

export const STORAGE_KEYS = {
  settings: 'fastAiTranslator.settings',
  secrets: 'fastAiTranslator.secrets',
  writingTargets: 'fastAiTranslator.writingTargets',
} as const;
