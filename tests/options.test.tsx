import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../entrypoints/options/App';

const { getStorage, sendMessage, setStorage } = vi.hoisted(() => ({
  getStorage: vi.fn(async (key: string): Promise<Record<string, unknown>> => {
    if (key === 'fastAiTranslator.settings') {
      return {
        [key]: {
          apiBaseUrl: 'http://127.0.0.1:8080/v1',
          model: 'model-a',
        },
      };
    }
    return { [key]: { apiKey: 'test-key' } };
  }),
  sendMessage: vi.fn(async (_request?: { type: string }): Promise<unknown> => ({
    models: ['model-a', 'model-b'],
  })),
  setStorage: vi.fn(async () => undefined),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { sendMessage },
    storage: { local: { get: getStorage, set: setStorage } },
  },
}));

describe('options model picker', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('loads provider models and supports selecting or manually entering a model', async () => {
    render(<App />);

    const picker = await screen.findByRole('combobox', { name: 'Model' });
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'LIST_MODELS' }),
    );
    expect(within(picker).getByRole('option', { name: 'model-b' })).toBeInTheDocument();

    fireEvent.change(picker, { target: { value: 'model-b' } });
    expect(picker).toHaveValue('model-b');

    fireEvent.click(screen.getByRole('button', { name: 'Enter manually' }));
    const manualInput = screen.getByRole('textbox', { name: 'Model' });
    fireEvent.change(manualInput, { target: { value: 'custom-model' } });

    await waitFor(() => expect(manualInput).toHaveValue('custom-model'));

    const imagePicker = screen.getByRole('combobox', { name: 'Image model' });
    expect(within(imagePicker).getByRole('option', { name: 'Same as main model' })).toBeInTheDocument();
    fireEvent.change(imagePicker, { target: { value: 'model-b' } });
    expect(imagePicker).toHaveValue('model-b');
  });

  it('shows measured model latency after testing the connection', async () => {
    sendMessage.mockImplementation(async (request?: { type: string }) =>
      request?.type === 'TEST_CONNECTION'
        ? {
            ok: true,
            message: 'Connection and translation succeeded.',
            models: ['model-a', 'model-b'],
            modelsLatencyMs: 40,
            translationLatencyMs: 245,
          }
        : { models: ['model-a', 'model-b'] },
    );
    render(<App />);
    await screen.findByRole('combobox', { name: 'Model' });

    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));

    expect(await screen.findByText(/Response time: 245 ms/)).toBeInTheDocument();
  });

  it('offers the turbo concurrency range and default', async () => {
    render(<App />);
    await screen.findByRole('combobox', { name: 'Model' });

    const concurrency = screen.getByRole('spinbutton', {
      name: 'Maximum concurrent requests',
    });
    expect(concurrency).toHaveAttribute('min', '1');
    expect(concurrency).toHaveAttribute('max', '24');
    expect(concurrency).toHaveValue(8);
    expect(screen.getByText(/Turbo mode defaults to 8/)).toBeInTheDocument();
    expect(screen.getByText('Writing translator')).toBeInTheDocument();
    expect(screen.getByText('Image translator')).toBeInTheDocument();
  });

  it('selects and persists the global English page policy', async () => {
    render(<App />);
    await screen.findByRole('combobox', { name: 'Model' });

    const strongEvidence = screen.getByRole('radio', { name: 'Strong evidence' });
    const strictEnglish = screen.getByRole('radio', { name: 'Strict English' });
    expect(strongEvidence).toBeChecked();
    expect(strictEnglish).not.toBeChecked();

    fireEvent.click(strictEnglish);
    expect(strictEnglish).toBeChecked();
    expect(screen.getByText(/preserves clear mixed-language passages/)).toBeInTheDocument();

    setStorage.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() =>
      expect(setStorage).toHaveBeenCalledWith({
        'fastAiTranslator.settings': expect.objectContaining({
          englishPagePolicy: 'strict',
          _schemaVersion: 5,
        }),
      }),
    );
  });

  it('recommends and tests the fast image model independently', async () => {
    sendMessage.mockImplementation(async (request?: { type: string }) => {
      if (request?.type === 'TEST_IMAGE_MODEL') {
        return { ok: true, message: 'Image input succeeded.', latencyMs: 180 };
      }
      return { models: ['gpt-5.6-terra', 'gpt-5.6-luna', 'model-a'] };
    });
    render(<App />);

    const imagePicker = await screen.findByRole('combobox', { name: 'Image model' });
    expect(
      within(imagePicker).getByRole('option', { name: 'gpt-5.6-luna (recommended)' }),
    ).toBeInTheDocument();
    fireEvent.change(imagePicker, { target: { value: 'gpt-5.6-luna' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test image model' }));

    expect(await screen.findByText(/Image input succeeded.*180 ms/)).toBeInTheDocument();
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'TEST_IMAGE_MODEL',
      draft: expect.objectContaining({ model: 'gpt-5.6-luna' }),
    });
  });

  it('keeps a stored custom image model editable when model discovery fails', async () => {
    getStorage.mockImplementation(async (key: string): Promise<Record<string, unknown>> => {
      if (key === 'fastAiTranslator.settings') {
        return {
          [key]: {
            apiBaseUrl: 'https://api.example.com/v1',
            model: 'text-model',
            imageModel: 'custom-vision-model',
            _schemaVersion: 5,
          },
        };
      }
      return { [key]: { apiKey: 'test-key' } };
    });
    sendMessage.mockRejectedValue(new Error('Model listing unavailable'));

    render(<App />);

    const imageModel = await screen.findByRole('textbox', { name: 'Image model' });
    expect(imageModel).toHaveValue('custom-vision-model');
  });
});
