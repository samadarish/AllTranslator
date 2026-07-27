import {
  AlertCircle,
  Check,
  Languages,
  LoaderCircle,
  RotateCcw,
  Settings,
  Sparkles,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { browser } from 'wxt/browser';
import { saveSettings } from '../../lib/settings';
import type {
  PageTranslationStatus,
  PublicSettingsResponse,
  TranslatorSettings,
} from '../../lib/types';

const INITIAL_STATUS: PageTranslationStatus = {
  state: 'idle',
  total: 0,
  translated: 0,
  cached: 0,
  failed: 0,
  pending: 0,
  scanMs: 0,
  cacheMs: 0,
  firstResultMs: 0,
  totalMs: 0,
  providerMs: 0,
  requestCount: 0,
};

function formatDuration(milliseconds: number): string {
  return milliseconds < 1_000
    ? `${Math.round(milliseconds)} ms`
    : `${(milliseconds / 1_000).toFixed(1)} s`;
}

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

function statusLabel(status: PageTranslationStatus): string {
  switch (status.state) {
    case 'scanning':
      return 'Scanning page';
    case 'translating':
      return 'Translating';
    case 'complete':
      return status.translated > 0 ? 'Page translated' : 'Nothing to translate';
    case 'restored':
      return 'Original restored';
    case 'error':
      return 'Translation stopped';
    default:
      return 'Ready';
  }
}

export default function App() {
  const [publicSettings, setPublicSettings] = useState<PublicSettingsResponse>();
  const [status, setStatus] = useState<PageTranslationStatus>(INITIAL_STATUS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const settings = (await browser.runtime.sendMessage({
      type: 'GET_PUBLIC_SETTINGS',
    })) as PublicSettingsResponse;
    setPublicSettings(settings);
    const tabId = await activeTabId();
    if (!tabId) return;
    try {
      const pageStatus = (await browser.tabs.sendMessage(tabId, {
        type: 'GET_PAGE_STATUS',
      })) as PageTranslationStatus;
      setStatus(pageStatus);
      setError('');
    } catch {
      setStatus(INITIAL_STATUS);
      setError('This browser page cannot be translated.');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!['scanning', 'translating'].includes(status.state)) return undefined;
    const timer = window.setInterval(() => void refresh(), 500);
    return () => window.clearInterval(timer);
  }, [refresh, status.state]);

  const progress = useMemo(() => {
    if (status.total === 0) return status.state === 'complete' ? 100 : 0;
    return Math.min(100, Math.round(((status.translated + status.failed) / status.total) * 100));
  }, [status]);

  const sendPageCommand = async (type: 'TRANSLATE_PAGE' | 'RESTORE_PAGE') => {
    setBusy(true);
    setError('');
    try {
      const tabId = await activeTabId();
      if (!tabId) throw new Error('No active browser tab.');
      const nextStatus = (await browser.tabs.sendMessage(tabId, { type })) as PageTranslationStatus;
      setStatus(nextStatus);
      if (nextStatus.lastError) setError(nextStatus.lastError);
    } catch (commandError) {
      setError(commandError instanceof Error ? commandError.message : 'Unable to reach this page.');
    } finally {
      setBusy(false);
    }
  };

  const updateSetting = async (key: keyof TranslatorSettings, value: boolean) => {
    if (!publicSettings) return;
    const settings = await saveSettings({ ...publicSettings.settings, [key]: value });
    setPublicSettings({ ...publicSettings, settings });
  };

  const translated = status.translated > 0 && status.state !== 'restored';
  const configured = publicSettings?.configured ?? false;

  return (
    <main className="popup-shell">
      <header className="app-header">
        <div className="brand-mark" aria-hidden="true">
          <Languages size={20} />
        </div>
        <div className="brand-copy">
          <h1>Fast AI Translator</h1>
          <span className={configured ? 'connection connected' : 'connection'}>
            <i /> {configured ? 'Provider ready' : 'Setup required'}
          </span>
        </div>
        <button
          className="icon-button"
          type="button"
          title="Open settings"
          aria-label="Open settings"
          onClick={() => void browser.runtime.openOptionsPage()}
        >
          <Settings size={19} />
        </button>
      </header>

      <section className="control-strip" aria-label="Extension controls">
        <div>
          <strong>Extension</strong>
          <span>{publicSettings?.settings.enabled ? 'Enabled' : 'Disabled'}</span>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={publicSettings?.settings.enabled ?? false}
            onChange={(event) => void updateSetting('enabled', event.target.checked)}
          />
          <span />
        </label>
      </section>

      <section className="translation-status" aria-live="polite">
        <div className="status-heading">
          <div className={`status-icon status-${status.state}`}>
            {status.state === 'translating' || status.state === 'scanning' ? (
              <LoaderCircle className="spin" size={19} />
            ) : status.state === 'error' ? (
              <AlertCircle size={19} />
            ) : status.state === 'complete' && status.translated > 0 ? (
              <Check size={19} />
            ) : (
              <Sparkles size={19} />
            )}
          </div>
          <div>
            <strong>{statusLabel(status)}</strong>
            <span>
              {status.translated} translated
              {status.cached > 0 ? ` · ${status.cached} cached` : ''}
            </span>
            {(status.firstResultMs > 0 || status.requestCount > 0) && (
              <span className="performance-line">
                {status.firstResultMs > 0
                  ? `First result ${formatDuration(status.firstResultMs)}`
                  : 'Waiting for provider'}
                {status.requestCount > 0
                  ? ` · ${status.requestCount} request${status.requestCount === 1 ? '' : 's'}`
                  : ''}
              </span>
            )}
          </div>
          <b>{progress}%</b>
        </div>
        <div className="progress-track" aria-label={`${progress}% complete`}>
          <span style={{ width: `${progress}%` }} />
        </div>
      </section>

      {error && (
        <div className="inline-error" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {!configured ? (
        <button
          className="primary-button"
          type="button"
          onClick={() => void browser.runtime.openOptionsPage()}
        >
          <Settings size={18} /> Configure provider
        </button>
      ) : translated ? (
        <button
          className="secondary-button"
          type="button"
          disabled={busy}
          onClick={() => void sendPageCommand('RESTORE_PAGE')}
        >
          <RotateCcw size={18} /> Restore original
        </button>
      ) : (
        <button
          className="primary-button"
          type="button"
          disabled={busy || !publicSettings?.settings.enabled}
          onClick={() => void sendPageCommand('TRANSLATE_PAGE')}
        >
          {busy ? <LoaderCircle className="spin" size={18} /> : <Languages size={18} />}
          Translate this page
        </button>
      )}

      <section className="control-strip auto-control" aria-label="Automatic translation">
        <div>
          <strong>Translate automatically</strong>
          <span>Target language: English</span>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={publicSettings?.settings.autoTranslate ?? false}
            onChange={(event) => void updateSetting('autoTranslate', event.target.checked)}
          />
          <span />
        </label>
      </section>

      <footer>
        <span>{publicSettings?.settings.model || 'No model selected'}</span>
        <button type="button" onClick={() => void refresh()}>
          Refresh
        </button>
      </footer>
    </main>
  );
}
