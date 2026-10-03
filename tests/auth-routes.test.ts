import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { GET as login } from '@/app/api/auth/login/route';
import { GET as callback } from '@/app/api/auth/callback/route';
import { POST as logout } from '@/app/api/auth/logout/route';
import { createTransaction } from '@/lib/auth/oauth';
import { seal } from '@/lib/auth/session';
vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    async verifyIdToken() {
      throw new Error('Invalid audience');
    }
  },
}));
beforeEach(() => {
  vi.stubEnv('APP_ORIGIN', 'http://localhost:3000');
  vi.stubEnv('GOOGLE_CLIENT_ID', 'client');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret');
  vi.stubEnv('SESSION_SECRET', 'a'.repeat(64));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it('login redirects with PKCE and protected transaction cookie', async () => {
  const r = await login();
  expect(r.status).toBe(307);
  expect(r.headers.get('location')).toContain('code_challenge_method=S256');
  expect(r.headers.get('set-cookie')).toContain('HttpOnly');
});
it('hostile callback state clears transaction and never exchanges code', async () => {
  const t = createTransaction();
  const r = await callback(
    new Request('http://localhost:3000/api/auth/callback?state=hostile&code=abc', {
      headers: { cookie: `drive_oauth=${await seal(t, 600)}` },
    }),
  );
  expect(r.headers.get('location')).toBe('http://localhost:3000/?error=signin');
  expect(r.headers.get('set-cookie')).toContain('Max-Age=0');
});
it('invalid issuer or audience prevents session creation', async () => {
  const t = createTransaction();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        access_token: 'a',
        refresh_token: 'r',
        id_token: 'invalid',
        expires_in: 3600,
      }),
    ),
  );
  const r = await callback(
    new Request(`http://localhost:3000/api/auth/callback?code=abc&state=${t.state}`, {
      headers: { cookie: `drive_oauth=${await seal(t, 600)}` },
    }),
  );
  expect(r.headers.get('location')).toContain('error=signin');
  expect(r.cookies.get('drive_session')).toBeUndefined();
});
it('rejects cross-origin logout', async () => {
  const r = await logout(
    new Request('http://localhost:3000/api/auth/logout', {
      method: 'POST',
      headers: { origin: 'https://hostile.com' },
    }),
  );
  expect(r.status).toBe(403);
});
it('same-origin logout clears sessions', async () => {
  const r = await logout(
    new Request('http://localhost:3000/api/auth/logout', {
      method: 'POST',
      headers: { origin: 'http://localhost:3000' },
    }),
  );
  expect(r.status).toBe(303);
  expect(r.headers.get('set-cookie')).toContain('drive_session=;');
});
