import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Page from '@/app/page';
vi.mock('next/headers', () => ({ cookies: async () => ({ toString: () => '' }) }));
beforeEach(() => {
  vi.stubEnv('APP_ORIGIN', 'http://localhost:3000');
  vi.stubEnv('GOOGLE_CLIENT_ID', 'client');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret');
  vi.stubEnv('SESSION_SECRET', 'a'.repeat(64));
});
afterEach(() => vi.unstubAllEnvs());
it('explains an unsuccessful Google sign-in safely', async () => {
  const html = renderToStaticMarkup(
    await Page({ searchParams: Promise.resolve({ error: 'signin' }) }),
  );
  expect(html).toContain('Google sign-in could not be completed');
  expect(html).toContain('Continue with Google');
});
