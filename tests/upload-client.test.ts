import { afterEach, expect, it, vi } from 'vitest';
import { uploadFile } from '@/lib/drive/upload-client';
import { UPLOAD_CHUNK_SIZE } from '@/lib/drive/upload-types';

afterEach(() => vi.unstubAllGlobals());
const uploaded = {
  id: 'done',
  name: 'video.mp4',
  mimeType: 'video/mp4',
  size: String(UPLOAD_CHUNK_SIZE + 3),
};
function options(ticket?: string) {
  return { signal: new AbortController().signal, ticket, onTicket: vi.fn(), onProgress: vi.fn() };
}
it('uploads bounded chunks with exact ranges and confirmed progress', async () => {
  const file = new File([new Uint8Array(UPLOAD_CHUNK_SIZE + 3)], 'video.mp4', {
    type: 'video/mp4',
  });
  const mock = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ ticket: 'session' }))
    .mockResolvedValueOnce(Response.json({ done: false, nextOffset: UPLOAD_CHUNK_SIZE }))
    .mockResolvedValueOnce(Response.json({ done: true, file: uploaded }));
  vi.stubGlobal('fetch', mock);
  const callbacks = options();
  expect(await uploadFile(file, 'movies', callbacks)).toEqual(uploaded);
  expect(JSON.parse(mock.mock.calls[0][1].body)).toMatchObject({
    parent: 'movies',
    name: 'video.mp4',
    size: file.size,
  });
  expect(mock.mock.calls[1][1].headers['Content-Range']).toBe(
    `bytes 0-${UPLOAD_CHUNK_SIZE - 1}/${file.size}`,
  );
  expect(mock.mock.calls[1][1].body.size).toBe(UPLOAD_CHUNK_SIZE);
  expect(mock.mock.calls[2][1].headers['Content-Range']).toBe(
    `bytes ${UPLOAD_CHUNK_SIZE}-${file.size - 1}/${file.size}`,
  );
  expect(callbacks.onProgress.mock.calls.map(([bytes]) => bytes)).toEqual([
    0,
    UPLOAD_CHUNK_SIZE,
    file.size,
  ]);
  expect(callbacks.onTicket).toHaveBeenCalledWith('session');
});
it('resumes using Drive saved offset after a partial acknowledgement', async () => {
  const file = new File(['abcdefgh'], 'video.mp4');
  const mock = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ done: false, nextOffset: 3 }))
    .mockResolvedValueOnce(Response.json({ done: true, file: uploaded }));
  vi.stubGlobal('fetch', mock);
  await uploadFile(file, 'movies', options('existing'));
  expect(mock.mock.calls[0][1].headers['Content-Range']).toBe('bytes */8');
  expect(mock.mock.calls[1][1].headers['Content-Range']).toBe('bytes 3-7/8');
  expect(await mock.mock.calls[1][1].body.text()).toBe('defgh');
  expect(mock.mock.calls.every((call) => call[1].method === 'PUT')).toBe(true);
});
it('recovers a lost completion response without creating a duplicate', async () => {
  const mock = vi
    .fn<(url: string, init: RequestInit) => Promise<Response>>()
    .mockResolvedValue(Response.json({ done: true, file: uploaded }));
  vi.stubGlobal('fetch', mock);
  expect(await uploadFile(new File(['abc'], 'video.mp4'), 'movies', options('existing'))).toEqual(
    uploaded,
  );
  expect(mock).toHaveBeenCalledTimes(1);
  expect(mock.mock.calls[0][1].method).toBe('PUT');
});
it('restarts an expired resumable session when retried', async () => {
  const mock = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ error: 'Expired' }, { status: 410 }))
    .mockResolvedValueOnce(Response.json({ ticket: 'replacement' }))
    .mockResolvedValueOnce(Response.json({ done: true, file: uploaded }));
  vi.stubGlobal('fetch', mock);
  const callbacks = options('expired');
  await uploadFile(new File(['abc'], 'video.mp4'), 'movies', callbacks);
  expect(mock.mock.calls[1][1].method).toBe('POST');
  expect(callbacks.onTicket).toHaveBeenCalledWith('replacement');
  expect(mock.mock.calls[2][1].headers['X-Upload-Ticket']).toBe('replacement');
});
it('preserves errors and avoids retrying permission failures automatically', async () => {
  const mock = vi.fn(async () => Response.json({ error: 'No folder permission' }, { status: 403 }));
  vi.stubGlobal('fetch', mock);
  await expect(
    uploadFile(new File(['abc'], 'video.mp4'), 'movies', options()),
  ).rejects.toMatchObject({ message: 'No folder permission', status: 403 });
  expect(mock).toHaveBeenCalledTimes(1);
});
it('stops after cancellation and never starts the next chunk', async () => {
  const controller = new AbortController();
  const mock = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ ticket: 'session' }))
    .mockImplementationOnce(async () => {
      controller.abort();
      throw new DOMException('Aborted', 'AbortError');
    });
  vi.stubGlobal('fetch', mock);
  await expect(
    uploadFile(new File([new Uint8Array(UPLOAD_CHUNK_SIZE + 1)], 'video.mp4'), 'movies', {
      ...options(),
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(mock).toHaveBeenCalledTimes(2);
});
it('fails visibly when Drive confirms no progress instead of looping forever', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ticket: 'session' }))
      .mockResolvedValueOnce(Response.json({ done: false, nextOffset: 0 })),
  );
  await expect(uploadFile(new File(['abc'], 'video.mp4'), 'movies', options())).rejects.toThrow(
    /has not confirmed/,
  );
});

it('preserves the specific Drive denial code for the upload recovery action', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json(
        { error: 'Grant upload access', code: 'UPLOAD_SCOPE_REQUIRED' },
        { status: 403 },
      ),
    ),
  );
  await expect(
    uploadFile(new File(['abc'], 'video.mp4'), 'movies', options()),
  ).rejects.toMatchObject({
    status: 403,
    code: 'UPLOAD_SCOPE_REQUIRED',
  });
});
