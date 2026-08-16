import { describe, expect, it } from 'vitest';
import {
  getChatCompletionsUrl,
  getModelsUrl,
  isDomainExcluded,
  normalizeApiBaseUrl,
  normalizeDomain,
} from '../lib/url';

describe('provider URL handling', () => {
  it('normalizes a root URL to an OpenAI-compatible v1 base', () => {
    expect(normalizeApiBaseUrl('https://api.example.com/')).toBe('https://api.example.com/v1');
    expect(normalizeApiBaseUrl('https://api.example.com/v1/')).toBe('https://api.example.com/v1');
  });

  it('accepts a full chat completions endpoint', () => {
    expect(normalizeApiBaseUrl('https://api.example.com/v1/chat/completions')).toBe(
      'https://api.example.com/v1',
    );
  });

  it('constructs provider endpoints', () => {
    expect(getModelsUrl('https://api.example.com')).toBe('https://api.example.com/v1/models');
    expect(getChatCompletionsUrl('https://api.example.com/v1')).toBe(
      'https://api.example.com/v1/chat/completions',
    );
  });

  it('accepts HTTP endpoints, including remote providers', () => {
    expect(normalizeApiBaseUrl('http://103.216.171.59:8080')).toBe(
      'http://103.216.171.59:8080/v1',
    );
    expect(normalizeApiBaseUrl('http://localhost:8080')).toBe('http://localhost:8080/v1');
  });

  it('rejects unsupported URL protocols', () => {
    expect(() => normalizeApiBaseUrl('ftp://api.example.com')).toThrow(/HTTP or HTTPS/);
  });
});

describe('domain exclusions', () => {
  it('normalizes URLs and wildcard domains', () => {
    expect(normalizeDomain('https://www.Example.com/path')).toBe('example.com');
    expect(normalizeDomain('*.example.com')).toBe('example.com');
  });

  it('matches a domain and all of its subdomains', () => {
    expect(isDomainExcluded('mail.example.com', ['example.com'])).toBe(true);
    expect(isDomainExcluded('example.com', ['example.com'])).toBe(true);
    expect(isDomainExcluded('example.org', ['example.com'])).toBe(false);
  });
});
