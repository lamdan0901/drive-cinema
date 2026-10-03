import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { validateRange } from '@/lib/media/range';
import { streamVideo } from '@/lib/media/stream';
import { seal } from '@/lib/auth/session';
let cookie = '';
beforeEach(async () => {
  vi.stubEnv('SESSION_SECRET', 'a'.repeat(64));
  vi.stubEnv('APP_ORIGIN', 'http://localhost:3000');
  vi.stubEnv('GOOGLE_CLIENT_ID', 'c');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 's');
  cookie = `drive_session=${await seal({ subject: 'u', accessToken: 'a', accessExpiresAt: Date.now() + 999999, sessionExpiresAt: Date.now() + 999999 }, 900)}`;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it.each(['bytes=0-99', 'bytes=100-', 'bytes=-50'])('accepts single range %s', (r) =>
  expect(validateRange(r)).toBe(r),
);
it.each([
  'bytes=99-0',
  'bytes=-0',
  'bytes=0-1,3-4',
  'items=0-9',
  'bytes=oops',
  'bytes=999999999999999999999-',
])('rejects range %s', (r) => expect(() => validateRange(r)).toThrow());
const request = (headers: Record<string, string> = {}, method = 'GET', signal?: AbortSignal) =>
  new Request('http://localhost/api/video/abc', {
    method,
    headers: { cookie, ...headers },
    signal,
  });
const metadata = (overrides = {}) =>
  Response.json({
    id: 'abc',
    name: 'movie.mp4',
    mimeType: 'video/mp4',
    size: '100',
    capabilities: { canDownload: true },
    ...overrides,
  });
it('rejects unauthenticated video requests', async () =>
  expect((await streamVideo(new Request('http://localhost'), 'abc')).status).toBe(401));
it.each([200, 206, 304, 416])('preserves upstream status %i', async (status) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (u: string | URL) =>
      String(u).includes('alt=media')
        ? new Response(status === 304 ? null : 'abcd', {
            status,
            headers: {
              'Content-Range': status === 416 ? 'bytes */100' : 'bytes 0-3/100',
              'Content-Length': status === 304 ? '0' : '4',
              'Content-Type': 'video/mp4',
            },
          })
        : metadata(),
    ),
  );
  const r = await streamVideo(request({ Range: 'bytes=0-3' }), 'abc');
  expect(r.status).toBe(status);
  expect(r.headers.get('Content-Range')).toBe(status === 416 ? 'bytes */100' : 'bytes 0-3/100');
  expect(r.headers.get('Cache-Control')).toContain('no-store');
});
it('HEAD reads metadata without downloading bytes', async () => {
  let downloads = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (u: string | URL) => {
      if (String(u).includes('alt=media')) downloads++;
      return metadata();
    }),
  );
  const r = await streamVideo(request({}, 'HEAD'), 'abc');
  expect(r.status).toBe(200);
  expect(r.body).toBeNull();
  expect(r.headers.get('content-length')).toBe('100');
  expect(downloads).toBe(0);
});
it('blocks nonvideo and disabled downloads', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => metadata({ mimeType: 'application/pdf' })),
  );
  expect((await streamVideo(request(), 'abc')).status).toBe(415);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => metadata({ capabilities: { canDownload: false } })),
  );
  expect((await streamVideo(request(), 'abc')).status).toBe(403);
});
it('forwards conditional headers and returns before the body is complete', async () => {
  let headers = new Headers();
  let upstreamSignal: AbortSignal | null | undefined;
  let canceled = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (u: string | URL, init: RequestInit) => {
      if (!String(u).includes('alt=media')) return metadata();
      headers = new Headers(init.headers);
      upstreamSignal = init.signal;
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array([1]));
          },
          cancel() {
            canceled = true;
          },
        }),
        { status: 206, headers: { 'Content-Length': '100', 'Content-Range': 'bytes 0-99/100' } },
      );
    }),
  );
  const r = await streamVideo(request({ Range: 'bytes=0-', 'If-Range': 'etag' }), 'abc');
  expect(headers.get('If-Range')).toBe('etag');
  expect(headers.get('Accept-Encoding')).toBe('identity');
  const reader = r.body!.getReader();
  expect((await reader.read()).value).toEqual(new Uint8Array([1]));
  expect(upstreamSignal).toBeDefined();
  await reader.cancel();
  expect(canceled).toBe(true);
});
it('cancels the upstream on reader cancellation', async () => {
  let canceled = false;
  let signal: AbortSignal | null | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (u: string | URL, init: RequestInit) => {
      if (!String(u).includes('alt=media')) return metadata();
      signal = init.signal;
      return new Response(
        new ReadableStream({
          cancel() {
            canceled = true;
          },
        }),
      );
    }),
  );
  const r = await streamVideo(request(), 'abc');
  await r.body!.cancel();
  expect(canceled).toBe(true);
  expect(signal?.aborted).toBe(true);
});
