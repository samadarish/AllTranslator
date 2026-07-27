import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  FlaskConical,
  Languages,
  List,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { browser } from 'wxt/browser';
import {
  DEFAULT_SECRETS,
  DEFAULT_SETTINGS,
  loadSecrets,
  loadSettings,
  saveSecrets,
  saveSettings,
} from '../../lib/settings';
import type {
  ModelsResponse,
  ProviderDraft,
  TestConnectionResponse,
  TestImageModelResponse,
  TranslatorSecrets,
  TranslatorSettings,
} from '../../lib/types';
import { normalizeDomain } from '../../lib/url';

type Notice = { kind: 'success' | 'error'; message: string } | undefined;

export default function App() {
  const [settings, setSettings] = useState<TranslatorSettings>(DEFAULT_SETTINGS);
  const [secrets, setSecrets] = useState<TranslatorSecrets>(DEFAULT_SECRETS);
  const [models, setModels] = useState<string[]>([]);
  const [domain, setDomain] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [manualModel, setManualModel] = useState(false);
  const [manualImageModel, setManualImageModel] = useState(false);
  const [loading, setLoading] = useState<
    'models' | 'test' | 'image-test' | 'save' | 'cache'
  >();
  const [notice, setNotice] = useState<Notice>();

  useEffect(() => {
    let active = true;

    void Promise.all([loadSettings(), loadSecrets()]).then(async ([storedSettings, storedSecrets]) => {
      if (!active) return;
      setSettings(storedSettings);
      setSecrets(storedSecrets);

      if (!storedSettings.apiBaseUrl || !storedSecrets.apiKey) {
        setManualModel(true);
        setManualImageModel(true);
        return;
      }

      try {
        const response = (await browser.runtime.sendMessage({
          type: 'LIST_MODELS',
          draft: {
            apiBaseUrl: storedSettings.apiBaseUrl,
            apiKey: storedSecrets.apiKey,
            model: storedSettings.model,
          },
        })) as ModelsResponse;
        if (!active) return;
        setModels(response.models);
        setManualModel(response.models.length === 0);
        setManualImageModel(response.models.length === 0);
      } catch {
        if (active) {
          setManualModel(true);
          setManualImageModel(true);
        }
      }
    });

    return () => {
      active = false;
    };
  }, []);

  const draft = useMemo<ProviderDraft>(
    () => ({
      apiBaseUrl: settings.apiBaseUrl,
      apiKey: secrets.apiKey,
      model: settings.model,
    }),
    [settings.apiBaseUrl, settings.model, secrets.apiKey],
  );

  const imageDraft = useMemo<ProviderDraft>(
    () => ({
      apiBaseUrl: settings.apiBaseUrl,
      apiKey: secrets.apiKey,
      model: settings.imageModel || settings.model,
    }),
    [settings.apiBaseUrl, settings.imageModel, settings.model, secrets.apiKey],
  );

  const modelChoices = useMemo(
    () =>
      Array.from(new Set([...models, settings.model].map((model) => model.trim()).filter(Boolean))).sort(
        (a, b) => a.localeCompare(b),
      ),
    [models, settings.model],
  );

  const imageModelChoices = useMemo(
    () =>
      Array.from(
        new Set([...models, settings.imageModel].map((model) => model.trim()).filter(Boolean)),
      ).sort((a, b) => {
        const preferred = ['gpt-5.6-luna', 'gpt-5.6-terra'];
        const aRank = preferred.indexOf(a);
        const bRank = preferred.indexOf(b);
        if (aRank >= 0 || bRank >= 0) {
          return (aRank < 0 ? preferred.length : aRank) -
            (bRank < 0 ? preferred.length : bRank);
        }
        return a.localeCompare(b);
      }),
    [models, settings.imageModel],
  );

  const update = <Key extends keyof TranslatorSettings>(key: Key, value: TranslatorSettings[Key]) => {
    setSettings((current) => ({ ...current, [key]: value }));
    setNotice(undefined);
  };

  const readableError = (error: unknown) => {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return 'The operation failed.';
  };

  const refreshModels = async () => {
    setLoading('models');
    setNotice(undefined);
    try {
      const response = (await browser.runtime.sendMessage({
        type: 'LIST_MODELS',
        draft,
      })) as ModelsResponse;
      setModels(response.models);
      setManualModel(false);
      setManualImageModel(false);
      if (!settings.model && response.models[0]) update('model', response.models[0]);
      setNotice({ kind: 'success', message: `${response.models.length} models loaded.` });
    } catch (error) {
      setNotice({ kind: 'error', message: readableError(error) });
    } finally {
      setLoading(undefined);
    }
  };

  const testProvider = async () => {
    setLoading('test');
    setNotice(undefined);
    try {
      const response = (await browser.runtime.sendMessage({
        type: 'TEST_CONNECTION',
        draft,
      })) as TestConnectionResponse;
      setModels(response.models);
      setManualModel(false);
      setManualImageModel(false);
      const latency = response.translationLatencyMs ?? response.modelsLatencyMs;
      setNotice({
        kind: response.ok ? 'success' : 'error',
        message: `${response.message} Response time: ${latency < 1_000 ? `${latency} ms` : `${(latency / 1_000).toFixed(1)} s`}`,
      });
    } catch (error) {
      setNotice({ kind: 'error', message: readableError(error) });
    } finally {
      setLoading(undefined);
    }
  };

  const testImageModel = async () => {
    setLoading('image-test');
    setNotice(undefined);
    try {
      const response = (await browser.runtime.sendMessage({
        type: 'TEST_IMAGE_MODEL',
        draft: imageDraft,
      })) as TestImageModelResponse;
      setNotice({
        kind: response.ok ? 'success' : 'error',
        message: `${response.message} Response time: ${response.latencyMs < 1_000 ? `${response.latencyMs} ms` : `${(response.latencyMs / 1_000).toFixed(1)} s`}`,
      });
    } catch (error) {
      setNotice({ kind: 'error', message: readableError(error) });
    } finally {
      setLoading(undefined);
    }
  };

  const save = async () => {
    setLoading('save');
    setNotice(undefined);
    try {
      const [savedSettings, savedSecrets] = await Promise.all([
        saveSettings(settings),
        saveSecrets(secrets),
      ]);
      setSettings(savedSettings);
      setSecrets(savedSecrets);
      setNotice({ kind: 'success', message: 'Settings saved.' });
    } catch (error) {
      setNotice({ kind: 'error', message: readableError(error) });
    } finally {
      setLoading(undefined);
    }
  };

  const clearCache = async () => {
    setLoading('cache');
    setNotice(undefined);
    try {
      await browser.runtime.sendMessage({ type: 'CLEAR_CACHE' });
      setNotice({ kind: 'success', message: 'Translation cache cleared.' });
    } catch (error) {
      setNotice({ kind: 'error', message: readableError(error) });
    } finally {
      setLoading(undefined);
    }
  };

  const addDomain = () => {
    const normalized = normalizeDomain(domain);
    if (!normalized || settings.excludedDomains.includes(normalized)) return;
    update('excludedDomains', [...settings.excludedDomains, normalized].sort());
    setDomain('');
  };

  return (
    <main className="settings-page">
      <header className="page-header">
        <div className="brand-mark" aria-hidden="true">
          <Languages size={24} />
        </div>
        <div>
          <h1>Fast AI Translator</h1>
          <p>Settings</p>
        </div>
        <button className="save-button" type="button" onClick={() => void save()} disabled={Boolean(loading)}>
          {loading === 'save' ? <LoaderCircle className="spin" size={18} /> : <Save size={18} />}
          Save settings
        </button>
      </header>

      {notice && (
        <div className={`notice notice-${notice.kind}`} role="status">
          {notice.kind === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span>{notice.message}</span>
        </div>
      )}

      <section className="settings-section">
        <div className="section-heading">
          <div>
            <h2>Provider connection</h2>
            <p>OpenAI-compatible Sub2API endpoint</p>
          </div>
          <div className="section-actions">
            <button className="text-button" type="button" onClick={() => void refreshModels()} disabled={Boolean(loading)}>
              {loading === 'models' ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}
              Load models
            </button>
            <button className="text-button" type="button" onClick={() => void testProvider()} disabled={Boolean(loading)}>
              {loading === 'test' ? <LoaderCircle className="spin" size={16} /> : <FlaskConical size={16} />}
              Test connection
            </button>
            <button className="text-button" type="button" onClick={() => void testImageModel()} disabled={Boolean(loading)}>
              {loading === 'image-test' ? <LoaderCircle className="spin" size={16} /> : <FlaskConical size={16} />}
              Test image model
            </button>
          </div>
        </div>

        <div className="form-grid">
          <label className="field field-wide">
            <span>API base URL</span>
            <input
              type="url"
              value={settings.apiBaseUrl}
              placeholder="https://api.example.com/v1"
              onChange={(event) => update('apiBaseUrl', event.target.value)}
              spellCheck={false}
            />
          </label>

          <label className="field">
            <span>API key</span>
            <div className="input-with-action">
              <input
                type={showKey ? 'text' : 'password'}
                value={secrets.apiKey}
                placeholder="sk-..."
                onChange={(event) => setSecrets({ apiKey: event.target.value })}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                title={showKey ? 'Hide API key' : 'Show API key'}
                aria-label={showKey ? 'Hide API key' : 'Show API key'}
                onClick={() => setShowKey((visible) => !visible)}
              >
                {showKey ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </label>

          <div className="field">
            <div className="model-label-row">
              <label htmlFor="provider-model">Model</label>
              {models.length > 0 && (
                <button
                  className="model-mode-button"
                  type="button"
                  onClick={() => setManualModel((current) => !current)}
                >
                  {manualModel ? <List size={14} /> : <Pencil size={14} />}
                  {manualModel ? 'Choose from list' : 'Enter manually'}
                </button>
              )}
            </div>
            {manualModel || modelChoices.length === 0 ? (
              <input
                id="provider-model"
                type="text"
                value={settings.model}
                placeholder="Enter the exact model ID"
                onChange={(event) => update('model', event.target.value)}
                spellCheck={false}
              />
            ) : (
              <select
                id="provider-model"
                value={settings.model}
                onChange={(event) => update('model', event.target.value)}
              >
                {!settings.model && <option value="">Select a model</option>}
                {modelChoices.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            )}
            <span className="field-hint">
              {models.length > 0
                ? `${models.length} provider model${models.length === 1 ? '' : 's'} available`
                : 'Load models from the provider or enter a model ID manually.'}
            </span>
          </div>

          <div className="field field-wide">
            <div className="model-label-row">
              <label htmlFor="image-model">Image model</label>
              {models.length > 0 && (
                <button
                  className="model-mode-button"
                  type="button"
                  aria-label={
                    manualImageModel
                      ? 'Choose image model from list'
                      : 'Enter image model manually'
                  }
                  onClick={() => setManualImageModel((current) => !current)}
                >
                  {manualImageModel ? <List size={14} /> : <Pencil size={14} />}
                  {manualImageModel ? 'Choose from list' : 'Enter manually'}
                </button>
              )}
            </div>
            {manualImageModel || imageModelChoices.length === 0 ? (
              <input
                id="image-model"
                type="text"
                value={settings.imageModel}
                placeholder="Leave blank to use the main model"
                onChange={(event) => update('imageModel', event.target.value)}
                spellCheck={false}
              />
            ) : (
              <select
                id="image-model"
                value={settings.imageModel}
                onChange={(event) => update('imageModel', event.target.value)}
              >
                <option value="">Same as main model</option>
                {imageModelChoices.map((model) => (
                  <option key={model} value={model}>
                    {model === 'gpt-5.6-luna' ? `${model} (recommended)` : model}
                  </option>
                ))}
              </select>
            )}
            <span className="field-hint">
              Use gpt-5.6-luna for speed, or gpt-5.6-terra for small or dense image text.
            </span>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <div className="section-heading">
          <div>
            <h2>Translation behavior</h2>
            <p>English output, page handling, and throughput</p>
          </div>
        </div>

        <div className="setting-rows">
          <div className="setting-row">
            <div>
              <strong>Extension enabled</strong>
              <span>Allow translation on supported browser pages</span>
            </div>
            <Toggle checked={settings.enabled} onChange={(checked) => update('enabled', checked)} />
          </div>
          <div className="setting-row">
            <div>
              <strong>Translate automatically</strong>
              <span>Translate only content currently visible on screen</span>
            </div>
            <Toggle
              checked={settings.autoTranslate}
              onChange={(checked) => update('autoTranslate', checked)}
            />
          </div>
          <div className="setting-row setting-row-policy">
            <div>
              <strong id="english-page-policy-label">English page policy</strong>
              <span id="english-page-policy-description">
                Strong evidence preserves clear mixed-language passages; strict skips Latin-script
                text on English pages.
              </span>
            </div>
            <fieldset
              className="policy-segmented"
              aria-labelledby="english-page-policy-label"
              aria-describedby="english-page-policy-description"
            >
              <legend className="visually-hidden">English page policy</legend>
              <label>
                <input
                  type="radio"
                  name="english-page-policy"
                  value="strong-evidence"
                  checked={settings.englishPagePolicy === 'strong-evidence'}
                  onChange={() => update('englishPagePolicy', 'strong-evidence')}
                />
                <span>Strong evidence</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="english-page-policy"
                  value="strict"
                  checked={settings.englishPagePolicy === 'strict'}
                  onChange={() => update('englishPagePolicy', 'strict')}
                />
                <span>Strict English</span>
              </label>
            </fieldset>
          </div>
          <div className="setting-row">
            <div>
              <strong>Writing translator</strong>
              <span>Offer translation beside supported text editors</span>
            </div>
            <Toggle
              checked={settings.writingTranslatorEnabled}
              onChange={(checked) => update('writingTranslatorEnabled', checked)}
            />
          </div>
          <div className="setting-row">
            <div>
              <strong>Image translator</strong>
              <span>Show a manual translation control over supported webpage images</span>
            </div>
            <Toggle
              checked={settings.imageTranslatorEnabled}
              onChange={(checked) => update('imageTranslatorEnabled', checked)}
            />
          </div>
          <div className="setting-row">
            <div>
              <strong>Target language</strong>
              <span>Version 1 translates into English</span>
            </div>
            <output className="fixed-value">English</output>
          </div>
          <div className="setting-row">
            <div>
              <strong>Maximum concurrent requests</strong>
              <span>Turbo mode defaults to 8 and reduces automatically after rate limits</span>
            </div>
            <input
              className="number-input"
              type="number"
              min="1"
              max="24"
              aria-label="Maximum concurrent requests"
              value={settings.concurrency}
              onChange={(event) => update('concurrency', Number(event.target.value))}
            />
          </div>
        </div>
      </section>

      <section className="settings-section">
        <div className="section-heading">
          <div>
            <h2>Cache and privacy</h2>
            <p>Repeated translations stay in this browser</p>
          </div>
          <button className="danger-button" type="button" onClick={() => void clearCache()} disabled={Boolean(loading)}>
            {loading === 'cache' ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}
            Clear cache
          </button>
        </div>

        <div className="setting-rows">
          <div className="setting-row">
            <div>
              <strong>Translation memory</strong>
              <span>Cache matching text and model results locally</span>
            </div>
            <Toggle checked={settings.useCache} onChange={(checked) => update('useCache', checked)} />
          </div>
          <div className="setting-row">
            <div>
              <strong>Cache lifetime</strong>
              <span>Expired entries are removed automatically</span>
            </div>
            <div className="number-suffix">
              <input
                className="number-input"
                type="number"
                min="1"
                max="365"
                value={settings.cacheTtlDays}
                onChange={(event) => update('cacheTtlDays', Number(event.target.value))}
              />
              <span>days</span>
            </div>
          </div>
        </div>

        <div className="domain-editor">
          <label className="field">
            <span>Excluded domains</span>
            <div className="domain-input">
              <input
                value={domain}
                placeholder="mail.example.com"
                onChange={(event) => setDomain(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addDomain();
                  }
                }}
                spellCheck={false}
              />
              <button type="button" title="Add domain" aria-label="Add domain" onClick={addDomain}>
                <Plus size={18} />
              </button>
            </div>
          </label>
          <div className="domain-list">
            {settings.excludedDomains.length === 0 ? (
              <span className="empty-list">No domains excluded</span>
            ) : (
              settings.excludedDomains.map((item) => (
                <span className="domain-chip" key={item}>
                  {item}
                  <button
                    type="button"
                    title={`Remove ${item}`}
                    aria-label={`Remove ${item}`}
                    onClick={() =>
                      update(
                        'excludedDomains',
                        settings.excludedDomains.filter((domainName) => domainName !== item),
                      )
                    }
                  >
                    <X size={14} />
                  </button>
                </span>
              ))
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span />
    </label>
  );
}
