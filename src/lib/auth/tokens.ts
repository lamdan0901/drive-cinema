import 'server-only';
import { createHash } from 'node:crypto';
import { getConfig } from '@/lib/config';
import { expired } from '@/lib/errors';
import type { Session } from '@/lib/types';
const refreshes = new Map<string, { promise: Promise<Session>; until: number }>();
export function resetRefreshCache() {
  refreshes.clear();
}
async function refresh(session: Session): Promise<Session> {
  if (!session.refreshToken) throw expired();
  const token = session.refreshToken;
  const key = createHash('sha256').update(token).digest('hex');
  for (const [k, v] of refreshes) if (v.until < Date.now()) refreshes.delete(k);
  const previous = refreshes.get(key);
  if (previous) return previous.promise;
  if (refreshes.size >= 1000) refreshes.delete(refreshes.keys().next().value!);
  const promise = (async () => {
    const c = getConfig();
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: c.googleClientId,
        client_secret: c.googleClientSecret,
        refresh_token: token,
        grant_type: 'refresh_token',
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw expired();
    const data = await r.json();
    if (
      typeof data.access_token !== 'string' ||
      !Number.isFinite(data.expires_in) ||
      data.expires_in <= 0
    )
      throw expired();
    return {
      ...session,
      accessToken: data.access_token,
      refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : token,
      accessExpiresAt: Date.now() + data.expires_in * 1000,
    };
  })();
  refreshes.set(key, { promise, until: Date.now() + 30000 });
  try {
    return await promise;
  } catch (e) {
    refreshes.delete(key);
    throw e;
  }
}
export async function authorizedFetch(
  session: Session,
  url: URL,
  init: RequestInit = {},
): Promise<{ response: Response; session: Session; changed: boolean }> {
  if (url.origin !== 'https://www.googleapis.com') throw new Error('Untrusted Google API origin.');
  let current = session;
  if (current.accessExpiresAt <= Date.now() + 30000) current = await refresh(current);
  const send = () => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${current.accessToken}`);
    return fetch(url, { ...init, headers, cache: 'no-store', redirect: 'error' });
  };
  let response = await send();
  if (response.status === 401) {
    await response.body?.cancel();
    current = await refresh(current);
    response = await send();
    if (response.status === 401) {
      await response.body?.cancel();
      throw expired();
    }
  }
  return { response, session: current, changed: current !== session };
}
