import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { configurationStatus, getConfig } from '@/lib/config';
beforeEach(() => {
  vi.stubEnv('APP_ORIGIN', 'http://localhost:3000');
  vi.stubEnv('GOOGLE_CLIENT_ID', 'test-client');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test-secret');
  vi.stubEnv('SESSION_SECRET', 'a'.repeat(64));
});
afterEach(() => vi.unstubAllEnvs());
it('uses a fixed callback origin', () =>
  expect(new URL('/api/auth/callback', getConfig().origin).href).toBe(
    'http://localhost:3000/api/auth/callback',
  ));
it('reports missing names without leaking secrets', () => {
  vi.stubEnv('GOOGLE_CLIENT_ID', '');
  expect(configurationStatus()).toEqual({ ready: false, missing: ['GOOGLE_CLIENT_ID'] });
  expect(() => getConfig()).toThrow('configuration');
});
it.each(['https://example.com/path', 'https://user:pass@example.com', 'http://example.com', 'bad'])(
  'rejects unsafe origin %s',
  (origin) => {
    vi.stubEnv('APP_ORIGIN', origin);
    expect(() => getConfig()).toThrow();
  },
);
it('rejects weak encryption secrets', () => {
  vi.stubEnv('SESSION_SECRET', 'weak');
  expect(() => getConfig()).toThrow();
});
