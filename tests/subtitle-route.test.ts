import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { readBounded } from '@/lib/drive/download';
import { GET } from '@/app/api/subtitles/[fileId]/route';
import { seal } from '@/lib/auth/session';
let cookie = '';
beforeEach(async () => {
  vi.stubEnv('APP_ORIGIN', 'http://localhost:3000');
  vi.stubEnv('GOOGLE_CLIENT_ID', 'c');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 's');
  vi.stubEnv('SESSION_SECRET', 'a'.repeat(64));
  cookie = `drive_session=${await seal({ subject: 'u', accessToken: 'a', accessExpiresAt: Date.now() + 999999, sessionExpiresAt: Date.now() + 999999 }, 600)}`;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it('bounds reads even when length header is absent and cancels reader', async () => {
  let canceled = false;
  const r = new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(2097153));
      },
      cancel() {
        canceled = true;
      },
    }),
  );
  await expect(readBounded(r, 2097152)).rejects.toMatchObject({ status: 413 });
  expect(canceled).toBe(true);
});
it('rejects metadata over 2 MiB before downloading', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        id: 'sub',
        name: 'Movie.srt',
        mimeType: 'text/plain',
        size: '2097153',
        capabilities: { canDownload: true },
      }),
    ),
  );
  const r = await GET(new Request('http://localhost', { headers: { cookie } }), {
    params: Promise.resolve({ fileId: 'sub' }),
  });
  expect(r.status).toBe(413);
});
it('returns converted VTT and private headers', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (u: string | URL) =>
      String(u).includes('alt=media')
        ? new Response('1\n00:00:01,000 --> 00:00:02,000\nXin chào\n\nContinuation')
        : Response.json({
            id: 'sub',
            name: 'Movie.vi.srt',
            mimeType: 'text/plain',
            size: '60',
            capabilities: { canDownload: true },
          }),
    ),
  );
  const r = await GET(new Request('http://localhost', { headers: { cookie } }), {
    params: Promise.resolve({ fileId: 'sub' }),
  });
  expect(r.status).toBe(200);
  expect(r.headers.get('Content-Type')).toContain('text/vtt');
  expect(await r.text()).toBe('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nXin chào\nContinuation\n');
});
it('rejects a non-subtitle file', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        id: 'sub',
        name: 'movie.mp4',
        mimeType: 'video/mp4',
        capabilities: { canDownload: true },
      }),
    ),
  );
  expect(
    (
      await GET(new Request('http://localhost', { headers: { cookie } }), {
        params: Promise.resolve({ fileId: 'sub' }),
      })
    ).status,
  ).toBe(415);
});
