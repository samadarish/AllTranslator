import { browser } from 'wxt/browser';
import { PageTranslator } from '../lib/page-translator';
import { STORAGE_KEYS } from '../lib/constants';
import { isDomainExcluded } from '../lib/url';
import type { PageRequest, PublicSettingsResponse, TranslatorSettings } from '../lib/types';
import { WritingTranslator } from '../lib/writing-translator';
import { ImageTranslator } from '../lib/image-translator';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_end',
  async main() {
    let response = (await browser.runtime.sendMessage({
      type: 'GET_PUBLIC_SETTINGS',
    })) as PublicSettingsResponse;
    let translator = new PageTranslator(response.settings, document);
    const writingTranslator = new WritingTranslator(document);
    const imageTranslator = new ImageTranslator(document);

    const canRun = (settings: TranslatorSettings, configured: boolean) =>
      settings.enabled &&
      configured &&
      !isDomainExcluded(location.hostname, settings.excludedDomains);

    const updateWritingTranslator = () => {
      writingTranslator.setShortcuts(response.settings.writingShortcuts);
      writingTranslator.setEnabled(
        canRun(response.settings, response.configured) &&
          response.settings.writingTranslatorEnabled,
      );
    };

    const updateImageTranslator = () => {
      imageTranslator.setEnabled(
        canRun(response.settings, response.configured) &&
          response.settings.imageTranslatorEnabled,
      );
    };

    updateWritingTranslator();
    updateImageTranslator();

    if (canRun(response.settings, response.configured) && response.settings.autoTranslate) {
      await translator.start();
    }

    browser.runtime.onMessage.addListener((message: unknown) => {
      if (!message || typeof message !== 'object' || !('type' in message)) return undefined;
      const request = message as PageRequest;
      if (request.type === 'GET_PAGE_STATUS') return Promise.resolve(translator.getStatus());
      if (request.type === 'RESTORE_PAGE') return Promise.resolve(translator.restore());
      if (request.type === 'TRANSLATE_PAGE') {
        if (!canRun(response.settings, response.configured)) {
          return Promise.resolve({
            ...translator.getStatus(),
            state: 'error',
            lastError: response.configured
              ? 'Translation is disabled for this site.'
              : 'Complete provider setup first.',
          });
        }
        return translator.start(true);
      }
      return undefined;
    });

    browser.storage.onChanged.addListener(async (changes, areaName) => {
      if (
        areaName !== 'local' ||
        (!changes[STORAGE_KEYS.settings] && !changes[STORAGE_KEYS.secrets])
      ) {
        return;
      }
      const previousPolicy = response.settings.englishPagePolicy;
      response = (await browser.runtime.sendMessage({
        type: 'GET_PUBLIC_SETTINGS',
      })) as PublicSettingsResponse;
      if (previousPolicy !== response.settings.englishPagePolicy) {
        translator.restore();
        translator = new PageTranslator(response.settings, document);
      } else {
        translator.updateSettings(response.settings);
      }
      updateWritingTranslator();
      updateImageTranslator();
      if (!canRun(response.settings, response.configured)) translator.restore();
      else if (response.settings.autoTranslate) await translator.start();
    });
  },
});
