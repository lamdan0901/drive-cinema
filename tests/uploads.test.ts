import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { POST, PUT } from '@/app/api/drive/uploads/route';
import { seal, unseal } from '@/lib/auth/session';
import { resetRefreshCache } from '@/lib/auth/tokens';
import { UPLOAD_CHUNK_SIZE } from '@/lib/drive/upload-types';
import type { Session } from '@/lib/types';

const origin = 'http://localhost:3000';
const googleUrl =
  'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=session';
const session: Session = {
  subject: 'viewer',
  accessToken: 'private-token',
  refreshToken: 'refresh',
  accessExpiresAt: Date.now() + 3600000,
  sessionExpiresAt: Date.now() + 86400000,
};
const metadata = { name: 'movie.mp4', size: 8, mimeType: 'video/mp4', parent: 'movies' };
let cookie: string;
beforeEach(async () => {
  vi.stubEnv('APP_ORIGIN', origin);
  vi.stubEnv('SESSION_SECRET', 'a'.repeat(64));
  vi.stubEnv('GOOGLE_CLIENT_ID', 'client');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret');
  resetRefreshCache();
  cookie = `drive_session=${await seal(session, 600)}`;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function request(method: string, body?: BodyInit, headers: Record<string, string> = {}) {
  return new Request(origin + '/api/drive/uploads', {
    method,
    body,
    headers: { origin, cookie, ...headers },
  });
}
async function ticket(size = metadata.size, accountId = session.subject) {
  return seal(
    { kind: 'drive-upload', accountId, size, mimeType: metadata.mimeType, url: googleUrl },
    600,
  );
}
function google() {
  const mock = vi.fn(async (url: URL, init: RequestInit) => {
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer private-token');
    if (url.pathname === '/drive/v3/files/movies')
      return Response.json({
        id: 'movies',
        name: 'Movies',
        mimeType: 'application/vnd.google-apps.folder',
        capabilities: { canAddChildren: true },
      });
    return new Response(null, { headers: { location: googleUrl } });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}
it('starts a resumable upload in the chosen folder without exposing Google credentials', async () => {
  const mock = google();
  const result = await POST(request('POST', JSON.stringify(metadata)));
  expect(result.status).toBe(200);
  const value = await result.json();
  expect(Object.keys(value)).toEqual(['ticket']);
  expect(JSON.stringify(value)).not.toContain('private-token');
  expect((await unseal(value.ticket))?.accountId).toBe('viewer');
  const [url, init] = mock.mock.calls[1];
  expect(url.searchParams.get('uploadType')).toBe('resumable');
  expect(init.method).toBe('POST');
  expect(JSON.parse(init.body as string)).toEqual({
    name: 'movie.mp4',
    mimeType: 'video/mp4',
    parents: ['movies'],
  });
  expect(new Headers(init.headers).get('x-upload-content-length')).toBe('8');
  expect(result.headers.get('cache-control')).toBe('private, no-store');
});
it('refreshes expired Google credentials and persists the renewed session at initiation', async () => {
  cookie = `drive_session=${await seal({ ...session, accessExpiresAt: 0 }, 600)}`;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL | string, init: RequestInit) => {
      if (String(url).includes('/token'))
        return Response.json({ access_token: 'new-token', expires_in: 3600 });
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer new-token');
      if (String(url).includes('/drive/v3/files/movies'))
        return Response.json({
          mimeType: 'application/vnd.google-apps.folder',
          capabilities: { canAddChildren: true },
        });
      return new Response(null, { headers: { location: googleUrl } });
    }),
  );
  const result = await POST(request('POST', JSON.stringify(metadata)));
  expect(result.status).toBe(200);
  expect(result.headers.get('set-cookie')).toContain('drive_session=');
});
it.each(['POST', 'PUT'])(
  'rejects cross-origin and signed-out %s requests before contacting Google',
  async (method) => {
    vi.stubGlobal('fetch', vi.fn());
    const handler = method === 'POST' ? POST : PUT;
    expect(
      (await handler(request(method, undefined, { origin: 'https://other.example' }))).status,
    ).toBe(403);
    expect((await handler(request(method, undefined, { cookie: '' }))).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  },
);
it.each([
  null,
  { ...metadata, size: -1 },
  { ...metadata, size: 1.5 },
  { ...metadata, size: 6 * 1024 ** 4 },
  { ...metadata, name: '' },
  { ...metadata, name: 'a\n.mp4' },
  { ...metadata, mimeType: 'text/plain\r\nInjected' },
  { ...metadata, mimeType: 'application/vnd.google-apps.folder' },
  { ...metadata, parent: '../bad' },
])('rejects invalid upload metadata %j', async (body) => {
  vi.stubGlobal('fetch', vi.fn());
  expect((await POST(request('POST', JSON.stringify(body)))).status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});
it('rejects a folder without upload permission and a non-folder destination', async () => {
  const mock = vi.fn();
  vi.stubGlobal('fetch', mock);
  mock.mockResolvedValueOnce(
    Response.json({
      mimeType: 'application/vnd.google-apps.folder',
      capabilities: { canAddChildren: false },
    }),
  );
  expect((await POST(request('POST', JSON.stringify(metadata)))).status).toBe(403);
  mock.mockResolvedValueOnce(
    Response.json({ mimeType: 'video/mp4', capabilities: { canAddChildren: true } }),
  );
  expect((await POST(request('POST', JSON.stringify(metadata)))).status).toBe(400);
  expect(mock).toHaveBeenCalledTimes(2);
});
it('rejects an upstream session URL outside the exact Drive upload endpoint', async () => {
  const mock = google();
  mock.mockResolvedValueOnce(
    Response.json({
      mimeType: 'application/vnd.google-apps.folder',
      capabilities: { canAddChildren: true },
    }),
  );
  mock.mockResolvedValueOnce(
    new Response(null, { headers: { location: 'https://evil.example/upload' } }),
  );
  expect((await POST(request('POST', JSON.stringify(metadata)))).status).toBe(502);
});
it('binds upload tickets to their account and rejects forged tickets before forwarding', async () => {
  vi.stubGlobal('fetch', vi.fn());
  for (const token of ['forged', await ticket(8, 'other-viewer')]) {
    const result = await PUT(
      request('PUT', undefined, { 'x-upload-ticket': token, 'content-range': 'bytes */8' }),
    );
    expect(result.status).toBeGreaterThanOrEqual(400);
  }
  expect(fetch).not.toHaveBeenCalled();
});
it('reports expired tickets as resumable-session expiry so retry can restart', async () => {
  vi.stubGlobal('fetch', vi.fn());
  const token = await seal(
    { kind: 'drive-upload', accountId: 'viewer', url: googleUrl, size: 8, mimeType: 'video/mp4' },
    -1,
  );
  expect(
    (
      await PUT(
        request('PUT', undefined, { 'x-upload-ticket': token, 'content-range': 'bytes */8' }),
      )
    ).status,
  ).toBe(410);
  expect(fetch).not.toHaveBeenCalled();
});
it('queries Drive for the acknowledged offset instead of assuming the whole previous chunk arrived', async () => {
  const mock = vi.fn(async (_url: URL, init: RequestInit) => {
    expect(init.method).toBe('PUT');
    expect(new Headers(init.headers).get('content-range')).toBe('bytes */8');
    expect(new Headers(init.headers).get('content-length')).toBe('0');
    return new Response(null, { status: 308, headers: { range: 'bytes=0-3' } });
  });
  vi.stubGlobal('fetch', mock);
  const result = await PUT(
    request('PUT', undefined, { 'x-upload-ticket': await ticket(), 'content-range': 'bytes */8' }),
  );
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({ done: false, nextOffset: 4 });
});
it('forwards exact file bytes and verifies the completed file size', async () => {
  const mock = vi.fn(async (_url: URL, init: RequestInit) => {
    expect(new Uint8Array(init.body as ArrayBuffer)).toEqual(
      new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
    );
    expect(new Headers(init.headers).get('content-range')).toBe('bytes 0-7/8');
    return Response.json({
      id: 'uploaded',
      name: 'movie.mp4',
      mimeType: 'video/mp4',
      size: '8',
      parents: ['movies'],
    });
  });
  vi.stubGlobal('fetch', mock);
  const result = await PUT(
    request('PUT', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), {
      'x-upload-ticket': await ticket(),
      'content-range': 'bytes 0-7/8',
    }),
  );
  expect((await result.json()).file.id).toBe('uploaded');
  mock.mockResolvedValueOnce(
    Response.json({ id: 'uploaded', name: 'movie.mp4', mimeType: 'video/mp4', size: '7' }),
  );
  expect(
    (
      await PUT(
        request('PUT', undefined, {
          'x-upload-ticket': await ticket(),
          'content-range': 'bytes */8',
        }),
      )
    ).status,
  ).toBe(502);
});
it('uploads zero-byte files with an empty final request', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({ id: 'empty', name: 'empty.txt', mimeType: 'text/plain', size: '0' }),
    ),
  );
  const result = await PUT(
    request('PUT', undefined, { 'x-upload-ticket': await ticket(0), 'content-range': 'bytes */0' }),
  );
  expect(result.status).toBe(200);
  expect((await result.json()).file.size).toBe('0');
});
it.each(['bytes 0-7/9', 'bytes 0-6/8', 'bytes 1-8/8', 'bytes -1-6/8'])(
  'rejects invalid range %s',
  async (range) => {
    vi.stubGlobal('fetch', vi.fn());
    const result = await PUT(
      request('PUT', new Uint8Array(8), {
        'x-upload-ticket': await ticket(),
        'content-range': range,
      }),
    );
    expect(result.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  },
);
it('rejects non-final chunks not aligned to 256 KiB', async () => {
  vi.stubGlobal('fetch', vi.fn());
  expect(
    (
      await PUT(
        request('PUT', new Uint8Array(4), {
          'x-upload-ticket': await ticket(),
          'content-range': 'bytes 0-3/8',
        }),
      )
    ).status,
  ).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});
it('bounds request bodies even when Content-Length is absent', async () => {
  vi.stubGlobal('fetch', vi.fn());
  const result = await PUT(
    request('PUT', new Uint8Array(UPLOAD_CHUNK_SIZE + 1), {
      'x-upload-ticket': await ticket(UPLOAD_CHUNK_SIZE + 1),
      'content-range': `bytes 0-${UPLOAD_CHUNK_SIZE}/${UPLOAD_CHUNK_SIZE + 1}`,
    }),
  );
  expect(result.status).toBe(413);
  expect(fetch).not.toHaveBeenCalled();
});
it('returns safe, actionable storage and expired-session errors', async () => {
  const mock = vi.fn();
  vi.stubGlobal('fetch', mock);
  mock.mockResolvedValueOnce(
    Response.json(
      {
        error: {
          message: 'private upstream details',
          errors: [{ reason: 'storageQuotaExceeded' }],
        },
      },
      { status: 403 },
    ),
  );
  const result = await PUT(
    request('PUT', undefined, { 'x-upload-ticket': await ticket(), 'content-range': 'bytes */8' }),
  );
  expect(result.status).toBe(403);
  expect((await result.json()).error).toMatch(/storage is full/);
  mock.mockResolvedValueOnce(new Response(null, { status: 404 }));
  expect(
    (
      await PUT(
        request('PUT', undefined, {
          'x-upload-ticket': await ticket(),
          'content-range': 'bytes */8',
        }),
      )
    ).status,
  ).toBe(410);
});

it.each([
  ['insufficientPermissions', 'UPLOAD_SCOPE_REQUIRED', /grant Drive upload access/],
  ['insufficientFilePermissions', 'UPLOAD_FOLDER_DENIED', /permission to upload into this folder/],
  ['domainPolicy', 'UPLOAD_POLICY_DENIED', /Workspace administrator/],
  ['dailyLimitExceeded', 'UPLOAD_RATE_LIMITED', /daily request limit/],
  ['activeItemCreationLimitExceeded', 'UPLOAD_ITEM_LIMIT', /file creation limit/],
  ['numChildrenInNonRootLimitExceeded', 'UPLOAD_FOLDER_FULL', /folder has reached/],
])(
  'identifies Google upload denial %s rather than assuming a login failure',
  async (reason, code, message) => {
    const mock = google();
    mock.mockResolvedValueOnce(
      Response.json({
        id: 'movies',
        mimeType: 'application/vnd.google-apps.folder',
        capabilities: { canAddChildren: true },
      }),
    );
    mock.mockResolvedValueOnce(
      Response.json(
        { error: { errors: [{ reason }], message: 'PRIVATE upstream text' } },
        { status: 403 },
      ),
    );
    const response = await POST(request('POST', JSON.stringify(metadata)));
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.code).toBe(code);
    expect(data.error).toMatch(message);
    expect(data.error).not.toContain('PRIVATE');
  },
);
it('recognizes modern Google scope errors in ErrorInfo details', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json(
        {
          error: {
            errors: [{ reason: 'forbidden' }],
            details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }],
          },
        },
        { status: 403 },
      ),
    ),
  );
  const response = await PUT(
    request('PUT', undefined, { 'x-upload-ticket': await ticket(), 'content-range': 'bytes */8' }),
  );
  expect((await response.json()).code).toBe('UPLOAD_SCOPE_REQUIRED');
});
it('makes unknown Google denial reasons identifiable without exposing raw upstream text', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json(
        {
          error: {
            errors: [{ reason: 'unexpectedPolicyRestriction' }],
            message: 'secret-token private-file-name',
          },
        },
        { status: 403 },
      ),
    ),
  );
  const response = await PUT(
    request('PUT', undefined, { 'x-upload-ticket': await ticket(), 'content-range': 'bytes */8' }),
  );
  const data = await response.json();
  expect(data.error).toContain('unexpectedPolicyRestriction');
  expect(data.error).not.toMatch(/secret-token|private-file-name/);
});
