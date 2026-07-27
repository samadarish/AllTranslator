import { browser } from 'wxt/browser';
import { STORAGE_KEYS, TARGET_LANGUAGE } from './constants';
import type { EnglishPagePolicy, TranslatorSecrets, TranslatorSettings } from './types';
import { normalizeApiBaseUrl, normalizeDomain } from './url';

const SETTINGS_SCHEMA_VERSION = 5;
const LEGACY_DEFAULT_CONCURRENCY = 3;

interface StoredSettings extends Partial<TranslatorSettings> {
  _schemaVersion?: number;
}

export const DEFAULT_SETTINGS: TranslatorSettings = {
  enabled: true,
  autoTranslate: true,
  englishPagePolicy: 'strong-evidence',
  writingTranslatorEnabled: true,
  imageTranslatorEnabled: true,
  apiBaseUrl: '',
  model: '',
  imageModel: '',
  targetLanguage: TARGET_LANGUAGE,
  concurrency: 8,
  useCache: true,
  cacheTtlDays: 30,
  excludedDomains: [],
};

export const DEFAULT_SECRETS: TranslatorSecrets = {
  apiKey: '',
};

export function sanitizeSettings(input: Partial<TranslatorSettings>): TranslatorSettings {
  let apiBaseUrl = '';
  if (input.apiBaseUrl?.trim()) apiBaseUrl = normalizeApiBaseUrl(input.apiBaseUrl);
  const englishPagePolicy: EnglishPagePolicy =
    input.englishPagePolicy === 'strong-evidence' || input.englishPagePolicy === 'strict'
      ? input.englishPagePolicy
      : DEFAULT_SETTINGS.englishPagePolicy;

  return {
    ...DEFAULT_SETTINGS,
    ...input,
    apiBaseUrl,
    englishPagePolicy,
    model: input.model?.trim() ?? '',
    imageModel: input.imageModel?.trim() ?? '',
    targetLanguage: TARGET_LANGUAGE,
    concurrency: Math.min(24, Math.max(1, Math.round(input.concurrency ?? 8))),
    cacheTtlDays: Math.min(365, Math.max(1, Math.round(input.cacheTtlDays ?? 30))),
    excludedDomains: Array.from(
      new Set((input.excludedDomains ?? []).map(normalizeDomain).filter(Boolean)),
    ).sort(),
  };
}

export async function loadSettings(): Promise<TranslatorSettings> {
  const result = await browser.storage.local.get(STORAGE_KEYS.settings);
  const stored = result[STORAGE_KEYS.settings] as StoredSettings | undefined;
  if (!stored) return sanitizeSettings({});

  const { _schemaVersion, ...input } = stored;
  if ((_schemaVersion ?? 0) >= SETTINGS_SCHEMA_VERSION) return sanitizeSettings(input);

  const migrated = sanitizeSettings({
    ...input,
    concurrency:
      (_schemaVersion ?? 0) < 2 &&
      (input.concurrency === undefined || input.concurrency === LEGACY_DEFAULT_CONCURRENCY)
        ? DEFAULT_SETTINGS.concurrency
        : input.concurrency,
  });
  await browser.storage.local.set({
    [STORAGE_KEYS.settings]: { ...migrated, _schemaVersion: SETTINGS_SCHEMA_VERSION },
  });
  return migrated;
}

export async function saveSettings(input: Partial<TranslatorSettings>): Promise<TranslatorSettings> {
  const settings = sanitizeSettings(input);
  await browser.storage.local.set({
    [STORAGE_KEYS.settings]: { ...settings, _schemaVersion: SETTINGS_SCHEMA_VERSION },
  });
  return settings;
}

export async function loadSecrets(): Promise<TranslatorSecrets> {
  const result = await browser.storage.local.get(STORAGE_KEYS.secrets);
  const stored = result[STORAGE_KEYS.secrets] as Partial<TranslatorSecrets> | undefined;
  return { apiKey: stored?.apiKey?.trim() ?? '' };
}

export async function saveSecrets(input: Partial<TranslatorSecrets>): Promise<TranslatorSecrets> {
  const secrets = { apiKey: input.apiKey?.trim() ?? '' };
  await browser.storage.local.set({ [STORAGE_KEYS.secrets]: secrets });
  return secrets;
}

export function isProviderConfigured(
  settings: TranslatorSettings,
  secrets: TranslatorSecrets,
): boolean {
  return Boolean(settings.apiBaseUrl && settings.model && secrets.apiKey);
}
