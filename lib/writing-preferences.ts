import { browser } from 'wxt/browser';
import { STORAGE_KEYS, WRITING_TARGET_MAX_DOMAINS } from './constants';
import type { TargetLanguage } from './types';
import { validateTargetLanguage } from './writing-languages';

interface WritingTargetPreference {
  hostname: string;
  target: TargetLanguage;
  lastUsedAt: number;
}

function normalizeHostname(input: string): string {
  const value = input.trim().toLowerCase().replace(/\.$/, '');
  if (!value) return '';
  try {
    return new URL(`https://${value}`).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return '';
  }
}

function sanitizePreferences(value: unknown): WritingTargetPreference[] {
  if (!Array.isArray(value)) return [];
  const preferences: WritingTargetPreference[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Partial<WritingTargetPreference>;
    const hostname = normalizeHostname(record.hostname ?? '');
    const target = record.target ? validateTargetLanguage(record.target) : undefined;
    if (!hostname || !target || seen.has(hostname)) continue;
    seen.add(hostname);
    preferences.push({
      hostname,
      target,
      lastUsedAt: Number.isFinite(record.lastUsedAt) ? Number(record.lastUsedAt) : 0,
    });
  }
  return preferences
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
    .slice(0, WRITING_TARGET_MAX_DOMAINS);
}

async function loadPreferences(): Promise<WritingTargetPreference[]> {
  const result = await browser.storage.local.get(STORAGE_KEYS.writingTargets);
  return sanitizePreferences(result[STORAGE_KEYS.writingTargets]);
}

export async function loadWritingTarget(hostname: string): Promise<TargetLanguage | undefined> {
  const normalized = normalizeHostname(hostname);
  if (!normalized) return undefined;
  return (await loadPreferences()).find((item) => item.hostname === normalized)?.target;
}

export async function rememberWritingTarget(
  hostname: string,
  input: TargetLanguage,
): Promise<void> {
  const normalized = normalizeHostname(hostname);
  const target = validateTargetLanguage(input);
  if (!normalized || !target) return;
  const existing = await loadPreferences();
  const preferences = [
    { hostname: normalized, target, lastUsedAt: Date.now() },
    ...existing.filter((item) => item.hostname !== normalized),
  ].slice(0, WRITING_TARGET_MAX_DOMAINS);
  await browser.storage.local.set({ [STORAGE_KEYS.writingTargets]: preferences });
}
