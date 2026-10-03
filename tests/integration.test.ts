import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { seal } from '@/lib/auth/session';
import { resetRefreshCache } from '@/lib/auth/tokens';
import { GET as files } from '@/app/api/drive/files/route';
import {
  GET as metadata,
  PATCH as rename,
  DELETE as trash,
} from '@/app/api/drive/files/[fileId]/route';
import { GET as video } from '@/app/api/video/[fileId]/route';
import { GET as subtitles } from '@/app/api/subtitles/[fileId]/route';
let cookie = '';
beforeEach(async () => {
  vi.stubEnv('APP_ORIGIN', 'http://localhost:3000');
  vi.stubEnv('SESSION_SECRET', 'a'.repeat(64));
  vi.stubEnv('GOOGLE_CLIENT_ID', 'client');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret');
  resetRefreshCache();
  cookie = `drive_session=${await seal({ subject: 'viewer', accessToken: 'old', refreshToken: 'refresh', accessExpiresAt: 0, sessionExpiresAt: Date.now() + 86400000 }, 600)}`;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it('connects refreshed browsing, video ranges, and converted subtitles', async () => {
  const movie = {
    id: 'movie',
    name: 'Movie.mp4',
    mimeType: 'video/mp4',
    size: '100',
    parents: ['folder'],
    capabilities: { canDownload: true },
  };
  const sub = {
    id: 'sub',
    name: 'Movie.vi.srt',
    mimeType: 'text/plain',
    size: '50',
    parents: ['folder'],
    capabilities: { canDownload: true },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (u: string | URL, init: RequestInit) => {
      const url = new URL(u);
      if (url.pathname === '/token')
        return Response.json({ access_token: 'fresh', expires_in: 3600 });
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer fresh');
      if (url.searchParams.get('alt') === 'media')
        return url.pathname.endsWith('/movie')
          ? new Response(new Uint8Array([1, 2, 3, 4]), {
              status: 206,
              headers: { 'Content-Length': '4', 'Content-Range': 'bytes 0-3/100' },
            })
          : new Response('1\n00:00:01,000 --> 00:00:02,000\nXin chào');
      if (url.pathname.endsWith('/movie')) return Response.json(movie);
      if (url.pathname.endsWith('/sub')) return Response.json(sub);
      return Response.json({ files: [movie, sub] });
    }),
  );
  const request = (url: string, headers = {}) =>
    new Request(url, { headers: { cookie, ...headers } });
  const list = await files(request('http://localhost/api/drive/files?parent=folder'));
  expect(list.status).toBe(200);
  expect(list.headers.get('Set-Cookie')).toContain('HttpOnly');
  expect((await list.json()).files).toHaveLength(2);
  const meta = await metadata(request('http://localhost'), {
    params: Promise.resolve({ fileId: 'movie' }),
  });
  expect((await meta.json()).id).toBe('movie');
  const stream = await video(request('http://localhost', { Range: 'bytes=0-3' }), {
    params: Promise.resolve({ fileId: 'movie' }),
  });
  expect(stream.status).toBe(206);
  expect(stream.headers.get('Set-Cookie')).toContain('drive_session=');
  expect(new Uint8Array(await stream.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
  const text = await subtitles(request('http://localhost'), {
    params: Promise.resolve({ fileId: 'sub' }),
  });
  expect(await text.text()).toContain('00:00:01.000 --> 00:00:02.000\nXin chào');
});
it('rejects unauthenticated file routes', async () => {
  expect((await files(new Request('http://localhost'))).status).toBe(401);
  expect(
    (
      await metadata(new Request('http://localhost'), {
        params: Promise.resolve({ fileId: 'movie' }),
      })
    ).status,
  ).toBe(401);
});

const context = { params: Promise.resolve({ fileId: 'folder' }) };
function mutationRequest(method: string, body?: string, origin = 'http://localhost:3000') {
  return new Request('http://localhost:3000/api/drive/files/folder', {
    method,
    headers: { cookie, origin, 'Content-Type': 'application/json' },
    body,
  });
}
it.each([
  ['PATCH', { name: 'Renamed' }, rename],
  ['DELETE', { trashed: true }, trash],
] as const)(
  'authenticates and refreshes a %s metadata update without permanently deleting',
  async (method, patch, handler) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL, init: RequestInit) => {
        if (String(url).includes('/token'))
          return Response.json({ access_token: 'fresh', expires_in: 3600 });
        expect(new URL(url).pathname).toBe('/drive/v3/files/folder');
        expect(init.method).toBe('PATCH');
        expect(JSON.parse(init.body as string)).toEqual(patch);
        expect(new Headers(init.headers).get('authorization')).toBe('Bearer fresh');
        return Response.json({
          id: 'folder',
          name: 'Renamed',
          mimeType: 'application/vnd.google-apps.folder',
          ...patch,
        });
      }),
    );
    const result = await handler(
      mutationRequest(method, method === 'PATCH' ? JSON.stringify(patch) : undefined),
      context,
    );
    expect(result.status).toBe(200);
    expect((await result.json()).id).toBe('folder');
    expect(result.headers.get('set-cookie')).toContain('HttpOnly');
    expect(result.headers.get('cache-control')).toBe('private, no-store');
  },
);
it('rejects cross-origin and unauthenticated mutations before contacting Google', async () => {
  vi.stubGlobal('fetch', vi.fn());
  for (const [method, handler] of [
    ['PATCH', rename],
    ['DELETE', trash],
  ] as const) {
    expect(
      (await handler(mutationRequest(method, undefined, 'https://evil.example'), context)).status,
    ).toBe(403);
    const request = mutationRequest(method);
    request.headers.delete('cookie');
    expect((await handler(request, context)).status).toBe(401);
  }
  expect(fetch).not.toHaveBeenCalled();
});
it.each([
  '{',
  'null',
  '{}',
  '{"name":"   "}',
  '{"name":123}',
  JSON.stringify({ name: 'x'.repeat(256) }),
  '{"name":"ok","trashed":true}',
])('rejects an invalid rename body %s without contacting Google', async (body) => {
  vi.stubGlobal('fetch', vi.fn());
  expect((await rename(mutationRequest('PATCH', body), context)).status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});
it('returns an actionable, safe mutation permission error', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) =>
      String(url).includes('/token')
        ? Response.json({ access_token: 'fresh', expires_in: 3600 })
        : Response.json({ error: 'secret upstream details' }, { status: 403 }),
    ),
  );
  const result = await trash(mutationRequest('DELETE'), context);
  expect(result.status).toBe(403);
  expect((await result.json()).error).toMatch(/sign in again/i);
});
