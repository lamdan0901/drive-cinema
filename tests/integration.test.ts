import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { seal } from '@/lib/auth/session';
import { resetRefreshCache } from '@/lib/auth/tokens';
import { GET as files } from '@/app/api/drive/files/route';
import { GET as metadata } from '@/app/api/drive/files/[fileId]/route';
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
