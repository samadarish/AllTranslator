# Fast AI Translator

Fast AI Translator is a Chrome and Edge extension that translates visible website text, writing drafts, and text inside webpage images through an OpenAI-compatible API such as Sub2API.

## Features

- Fast translation of all safe, visible viewport text, including sidebars and navigation
- OpenAI-compatible `/v1/models` and `/v1/chat/completions` support
- Dynamic page and single-page application updates
- Mixed-language application support, including virtualized Telegram messages
- English-page filtering that avoids sending already-English text to the provider
- In-place translation without removing links or formatting
- One-click restoration of original text
- Local translation memory with model-aware cache keys
- English popup and settings interface
- Domain exclusions, request concurrency controls, and local-only API key storage
- Turbo batching with 8 concurrent requests by default, a maximum of 24, and automatic rate-limit backoff
- Apple-red pending feedback followed by a brief apple-green success flash
- An opt-in writing control for selected text or complete drafts, with preview and confirm-to-replace behavior
- Common global and Indian writing targets, custom language codes, and per-host target memory
- A manual image control that translates text in the selected visible webpage image into a preview
- Searchable image target languages, retry and rate-limit states, and one-click copy
- Provider timing in the popup and connection test for comparing model speed
- Passwords, one-time codes, numeric/email/URL fields, code editors, and oversized drafts are excluded

## Writing translation

Focus a supported editor and select the Languages control, or press `Alt+Shift+Enter`. The translator uses the selected text when there is a selection and the complete draft otherwise. Review the preview and choose **Replace**, or press `Alt+Shift+Enter` again to confirm it. The extension never submits or sends the result.

## Image translation

Hover or focus a substantial webpage image and select its Languages control. The extension captures the visible part of that image only after the control is selected, translates readable text into English by default, and shows a text preview. Change the target from the searchable language picker, then choose **Copy**. Images are never modified and no action is submitted automatically.

High-detail image translation can take longer than page text, so image requests have a 45-second deadline while page and writing requests remain at 12 seconds. If an image still times out, select `gpt-5.6-luna`, use **Test image model**, and retry. Retry reuses the in-memory image crop instead of capturing the page again.

## English-page filtering

Under **Translation behavior**, **Strong evidence** is the default English page policy. It skips text that appears to already be English while preserving clear mixed-language passages. **Strict English** skips all Latin-script text on English pages to minimize provider requests; non-Latin text can still be translated in either mode.

## Build

```powershell
npm install
npm run check
```

The unpacked extension is generated at:

- Chrome: `.output/chrome-mv3`
- Edge: `.output/edge-mv3`

ZIP packages can be generated with `npm run zip` and `npm run zip:edge`.

## Install in Chrome or Edge

1. Open the browser extension management page.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select `.output/chrome-mv3` for Chrome or `.output/edge-mv3` for Edge.
5. Open **Fast AI Translator** and select **Configure provider**.

## Configure Sub2API

1. Enter the hosted API base URL, with or without `/v1`.
2. Enter the Sub2API API key.
3. Select **Load models** and choose a model for page and writing translation.
4. For image translation, choose `gpt-5.6-luna` for speed or `gpt-5.6-terra` for small or dense text when those models are available from your provider. Leaving **Image model** blank uses the main model.
5. Choose a **Reasoning effort** when the selected model and provider support it, or leave it at **Provider default**.
6. Under **Translation behavior**, keep **Strong evidence** for mixed-language pages or choose **Strict English** to minimize requests on English pages.
7. Select **Test connection** and **Test image model**.
8. Save the settings and reload the page to translate automatically.

The API key is stored in browser extension storage. It is never committed to this repository or inserted into website JavaScript. Page text is sent to the configured provider when translation is enabled. Draft translations are cached only in bounded extension memory; persistent storage contains only the selected target language for recently used hostnames, never draft content.

The extension requests access to all webpages for page translation and browser-supported image capture, while its content scripts remain limited to HTTP and HTTPS pages. Image capture is manual and starts only after selecting an image's Languages control. The selected image crop and translated image text are held only in bounded extension memory and are never written to persistent storage.
