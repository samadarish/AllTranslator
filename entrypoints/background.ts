import { browser } from 'wxt/browser';
import { translationCache } from '../lib/cache';
import { STORAGE_KEYS } from '../lib/constants';
import { captureVisibleImage } from '../lib/image-capture';
import { isProviderConfigured, loadSecrets, loadSettings, saveSettings } from '../lib/settings';
import {
  clearCache,
  failedDraftTranslation,
  failedImageTranslation,
  failedTranslationBatch,
  invalidateTranslationContext,
  listModels,
  lookupTranslations,
  pruneCache,
  testConnection,
  testImageModel,
  translateBatch,
  translateDraft,
  translateImage,
} from '../lib/translation-service';
import type { BackgroundRequest } from '../lib/types';

const CACHE_ALARM = 'fast-ai-translator-cache-prune';
const activeTranslations = new Map<string, AbortController>();
const activeDraftTranslations = new Map<string, AbortController>();
const activeImageTranslations = new Map<string, AbortController>();

function requestKey(requestId: string, generation: number, senderContext: string): string {
  return `${senderContext}:${generation}:${requestId}`;
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(async () => {
    const settings = await loadSettings();
    await saveSettings(settings);
    await browser.alarms.create(CACHE_ALARM, { periodInMinutes: 24 * 60 });
  });

  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === CACHE_ALARM) await pruneCache();
  });

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (
      areaName === 'local' &&
      (STORAGE_KEYS.settings in changes || STORAGE_KEYS.secrets in changes)
    ) {
      invalidateTranslationContext();
    }
  });

  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    if (!message || typeof message !== 'object' || !('type' in message)) return undefined;
    const request = message as BackgroundRequest;
    const senderContext = `${sender.tab?.id ?? 'extension'}:${sender.frameId ?? 0}`;
    switch (request.type) {
      case 'GET_PUBLIC_SETTINGS':
        return Promise.all([loadSettings(), loadSecrets()]).then(([settings, secrets]) => ({
          settings,
          configured: isProviderConfigured(settings, secrets),
        }));
      case 'LIST_MODELS':
        return listModels(request.draft).then((models) => ({ models }));
      case 'TEST_CONNECTION':
        return testConnection(request.draft);
      case 'TEST_IMAGE_MODEL':
        return testImageModel(request.draft);
      case 'LOOKUP_TRANSLATIONS':
        return lookupTranslations(request.segments);
      case 'TRANSLATE_BATCH': {
        const key = requestKey(
          request.payload.requestId,
          request.payload.generation,
          senderContext,
        );
        activeTranslations.get(key)?.abort();
        const controller = new AbortController();
        activeTranslations.set(key, controller);
        return translateBatch(request.payload, controller.signal)
          .catch((error) => failedTranslationBatch(request.payload, error))
          .finally(() => {
            if (activeTranslations.get(key) === controller) activeTranslations.delete(key);
          });
      }
      case 'CANCEL_TRANSLATION_BATCH': {
        const key = requestKey(request.requestId, request.generation, senderContext);
        const controller = activeTranslations.get(key);
        controller?.abort();
        return Promise.resolve({ cancelled: Boolean(controller) });
      }
      case 'TRANSLATE_DRAFT': {
        const key = `${senderContext}:draft:${request.payload.requestId}`;
        activeDraftTranslations.get(key)?.abort();
        const controller = new AbortController();
        activeDraftTranslations.set(key, controller);
        return translateDraft(request.payload, controller.signal)
          .catch((error) => failedDraftTranslation(request.payload, error))
          .finally(() => {
            if (activeDraftTranslations.get(key) === controller) {
              activeDraftTranslations.delete(key);
            }
          });
      }
      case 'CANCEL_DRAFT_TRANSLATION': {
        const key = `${senderContext}:draft:${request.requestId}`;
        const controller = activeDraftTranslations.get(key);
        controller?.abort();
        return Promise.resolve({ cancelled: Boolean(controller) });
      }
      case 'CAPTURE_IMAGE':
        if (sender.tab?.active === false) {
          return Promise.resolve({
            requestId: request.payload.requestId,
            error: {
              code: 'CAPTURE_UNAVAILABLE',
              message: 'Keep this tab active while the image is captured.',
            },
          });
        }
        return captureVisibleImage(request.payload, sender.tab?.windowId);
      case 'TRANSLATE_IMAGE': {
        const key = `${senderContext}:image:${request.payload.requestId}`;
        activeImageTranslations.get(key)?.abort();
        const controller = new AbortController();
        activeImageTranslations.set(key, controller);
        return translateImage(request.payload, controller.signal)
          .catch((error) => failedImageTranslation(request.payload, error))
          .finally(() => {
            if (activeImageTranslations.get(key) === controller) {
              activeImageTranslations.delete(key);
            }
          });
      }
      case 'CANCEL_IMAGE_TRANSLATION': {
        const key = `${senderContext}:image:${request.requestId}`;
        const controller = activeImageTranslations.get(key);
        controller?.abort();
        return Promise.resolve({ cancelled: Boolean(controller) });
      }
      case 'CLEAR_CACHE':
        return clearCache().then(() => ({ ok: true }));
      default:
        return undefined;
    }
  });

  void translationCache;
});
