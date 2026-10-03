import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { seal, unseal, readSession, setSession, requireSession } from '@/lib/auth/session';
import { NextResponse } from 'next/server';
import {
  createTransaction,
  challenge,
  authorizationUrl,
  validateTransaction,
  exchangeCode,
} from '@/lib/auth/oauth';
import { authorizedFetch, resetRefreshCache } from '@/lib/auth/tokens';
import type { Session } from '@/lib/types';
const session = (): Session => ({
  subject: 'user',
  accessToken: 'old',
  refreshToken: 'refresh',
  accessExpiresAt: Date.now() + 60000,
  sessionExpiresAt: Date.now() + 86400000,
});
beforeEach(() => {
  vi.stubEnv('APP_ORIGIN', 'http://localhost:3000');
  vi.stubEnv('GOOGLE_CLIENT_ID', 'client');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret');
  vi.stubEnv('SESSION_SECRET', 'a'.repeat(64));
  resetRefreshCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it('encrypts tokens and rejects tampering', async () => {
  const value = await seal(session(), 60);
  expect(value).not.toContain('refresh');
  expect(await unseal(value)).toMatchObject({ subject: 'user' });
  expect(await unseal(value.slice(0, -6) + 'abcdef')).toBeNull();
});
it('rejects expired cookies', async () => {
  expect(await unseal(await seal(session(), -1))).toBeNull();
});
it('rejects expired session envelope', async () => {
  const s = session();
  s.sessionExpiresAt = 0;
  const value = await seal(s, 60);
  expect(
    await readSession(
      new Request('http://localhost', { headers: { cookie: `drive_session=${value}` } }),
    ),
  ).toBeNull();
});
it('rejects unauthenticated access', async () => {
  await expect(requireSession(new Request('http://localhost'))).rejects.toMatchObject({
    status: 401,
  });
});
it('sets HttpOnly Lax cookie with bounded size', async () => {
  const r = new NextResponse();
  await setSession(r, session());
  expect(r.headers.get('set-cookie')).toContain('HttpOnly');
  expect(r.headers.get('set-cookie')).toContain('SameSite=lax');
  await expect(setSession(r, { ...session(), accessToken: 'x'.repeat(4000) })).rejects.toThrow();
});
it('binds the OAuth transaction and PKCE', () => {
  const t = createTransaction();
  expect(challenge(t.verifier)).toHaveLength(43);
  const url = authorizationUrl(t);
  expect(url.searchParams.get('code_challenge')).toBe(challenge(t.verifier));
  expect(url.searchParams.get('access_type')).toBe('offline');
  expect(url.searchParams.get('scope')).toBe(
    'openid profile https://www.googleapis.com/auth/drive',
  );
  expect(() => validateTransaction(t, 'wrong')).toThrow();
  expect(() => validateTransaction({ ...t, createdAt: 0 }, t.state)).toThrow();
});
it('requires an identity token in the code exchange', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ access_token: 'a', expires_in: 3600, refresh_token: 'r' })),
  );
  await expect(exchangeCode('code', createTransaction())).rejects.toThrow();
});
it('refreshes concurrently and retains refresh token', async () => {
  const s = { ...session(), accessExpiresAt: 0 };
  let refreshes = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      if (String(url).includes('/token')) {
        refreshes++;
        return Response.json({ access_token: 'new', expires_in: 3600 });
      }
      return new Response('ok');
    }),
  );
  const [a, b] = await Promise.all([
    authorizedFetch(s, new URL('https://www.googleapis.com/drive/v3/files')),
    authorizedFetch(s, new URL('https://www.googleapis.com/drive/v3/files')),
  ]);
  expect(refreshes).toBe(1);
  expect(a.session.refreshToken).toBe('refresh');
  expect(b.session.accessToken).toBe('new');
  expect(a.changed).toBe(true);
});
it('limits authentication retry to once', async () => {
  let media = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) =>
      String(url).includes('/token')
        ? Response.json({ access_token: 'new', expires_in: 3600 })
        : (media++, new Response('', { status: 401 })),
    ),
  );
  await expect(
    authorizedFetch(session(), new URL('https://www.googleapis.com/drive/v3/files')),
  ).rejects.toMatchObject({ status: 401 });
  expect(media).toBe(2);
});
it('handles revoked refresh credentials safely', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ error: 'invalid_grant', secret: 'hidden' }, { status: 400 })),
  );
  await expect(
    authorizedFetch(
      { ...session(), accessExpiresAt: 0 },
      new URL('https://www.googleapis.com/drive/v3/files'),
    ),
  ).rejects.toMatchObject({ status: 401, message: 'Your Google session expired. Sign in again.' });
});
it('does not send tokens to arbitrary URLs', async () => {
  await expect(authorizedFetch(session(), new URL('https://example.com'))).rejects.toThrow();
});
