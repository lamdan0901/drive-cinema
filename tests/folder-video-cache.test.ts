import { afterEach, expect, it, vi } from 'vitest';
import { createFolderVideoCache } from '@/lib/media/folder-video-cache';

const movie = { id: 'movie', name: 'Movie.mp4', mimeType: 'video/mp4' };
afterEach(() => vi.unstubAllGlobals());

it('does not let a request started before invalidation repopulate the cache', async () => {
  let resolve!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((r) => {
            resolve = r;
          }),
      )
      .mockResolvedValue(Response.json({ files: [{ ...movie, name: 'Renamed.mp4' }] })),
  );
  const cache = createFolderVideoCache();
  const old = cache.load('folder', new AbortController().signal);
  cache.invalidate('folder');
  resolve(Response.json({ files: [movie] }));
  await old;
  expect(await cache.load('folder', new AbortController().signal)).toEqual([
    { ...movie, name: 'Renamed.mp4' },
  ]);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('does not cache partial lists when a later page fails or the load is cancelled', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(Response.json({ files: [movie], nextPageToken: 'more' }))
      .mockResolvedValueOnce(Response.json({ error: 'Unavailable' }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ files: [movie] })),
  );
  const cache = createFolderVideoCache();
  await expect(cache.load('folder', new AbortController().signal)).rejects.toThrow('Unavailable');
  expect(await cache.load('folder', new AbortController().signal)).toEqual([movie]);
  expect(fetch).toHaveBeenCalledTimes(3);
  cache.invalidate('folder');
  const controller = new AbortController();
  vi.mocked(fetch).mockImplementationOnce(async () => {
    controller.abort();
    return Response.json({ files: [{ ...movie, name: 'Stale.mp4' }] });
  });
  await expect(cache.load('folder', controller.signal)).rejects.toThrow();
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ files: [movie] }));
  expect(await cache.load('folder', new AbortController().signal)).toEqual([movie]);
});

it('keeps folder caches separate and invalidating one preserves another', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(Response.json({ files: [movie] }))
      .mockResolvedValueOnce(
        Response.json({ files: [{ ...movie, id: 'other', name: 'Other.mp4' }] }),
      )
      .mockResolvedValueOnce(Response.json({ files: [] })),
  );
  const cache = createFolderVideoCache();
  const signal = new AbortController().signal;
  await cache.load('first', signal);
  await cache.load('second', signal);
  cache.invalidate('first');
  expect(await cache.load('second', signal)).toEqual([
    { ...movie, id: 'other', name: 'Other.mp4' },
  ]);
  expect(await cache.load('first', signal)).toEqual([]);
  expect(fetch).toHaveBeenCalledTimes(3);
});
