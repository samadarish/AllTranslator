export function normalizeApiBaseUrl(input: string): string {
  let value = input.trim().replace(/\/+$/, '');
  if (!value) return '';

  value = value.replace(/\/chat\/completions$/i, '');
  if (!/\/v1$/i.test(value)) value = `${value}/v1`;

  const url = new URL(value);
  const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalhost)) {
    throw new Error('Use HTTPS for remote providers. HTTP is allowed only on localhost.');
  }

  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/$/, '');
}

export function getModelsUrl(baseUrl: string): string {
  return `${normalizeApiBaseUrl(baseUrl)}/models`;
}

export function getChatCompletionsUrl(baseUrl: string): string {
  return `${normalizeApiBaseUrl(baseUrl)}/chat/completions`;
}

export function normalizeDomain(input: string): string {
  const value = input.trim().toLowerCase();
  if (!value) return '';

  try {
    const withProtocol = value.includes('://') ? value : `https://${value}`;
    return new URL(withProtocol).hostname.replace(/^\*\./, '').replace(/^www\./, '');
  } catch {
    return value.replace(/^\*\./, '').replace(/^www\./, '').split('/')[0] ?? '';
  }
}

export function isDomainExcluded(hostname: string, exclusions: string[]): boolean {
  const host = normalizeDomain(hostname);
  return exclusions.some((entry) => {
    const excluded = normalizeDomain(entry);
    return excluded.length > 0 && (host === excluded || host.endsWith(`.${excluded}`));
  });
}
