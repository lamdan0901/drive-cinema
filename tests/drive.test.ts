import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseFileId, listFiles, getFile, updateFile } from '@/lib/drive/files';
import type { Session } from '@/lib/types';
const s: Session = {
  subject: 'u',
  accessToken: 'a',
  accessExpiresAt: Date.now() + 999999,
  sessionExpiresAt: Date.now() + 999999,
};
beforeEach(() => {});
afterEach(() => vi.unstubAllGlobals());
it.each([
  'Abc_123-x',
  'https://drive.google.com/file/d/Abc_123-x/view',
  'https://drive.google.com/open?id=Abc_123-x',
  'https://drive.google.com/drive/folders/Abc_123-x',
])('extracts file ID from %s', (v) => expect(parseFileId(v)).toBe('Abc_123-x'));
it.each(['bad/../../file', "x' or trashed=false", 'https://evil.com/file/d/a/view', ''])(
  'rejects unsafe ID %s',
  (v) => expect(() => parseFileId(v)).toThrow(),
);
it('escapes Drive query literals and forwards pagination', async () => {
  let url = '';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (u: string | URL) => {
      url = String(u);
      return Response.json({ files: [], nextPageToken: 'next' });
    }),
  );
  const r = await listFiles(s, { parent: 'root', query: "A'B", pageToken: 'page' });
  const p = new URL(url).searchParams;
  expect(p.get('q')).toContain("A\\'B");
  expect(p.get('q')).toContain('trashed = false');
  expect(p.get('pageToken')).toBe('page');
  expect(r.page.nextPageToken).toBe('next');
});
it('rejects trashed metadata so shortcuts cannot open deleted folders', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ id: 'folder', trashed: true })),
  );
  await expect(getFile(s, 'folder')).rejects.toMatchObject({ status: 404, code: 'FILE_TRASHED' });
});
it('cannot mutate My Drive itself', async () => {
  vi.stubGlobal('fetch', vi.fn());
  await expect(updateFile(s, 'root', { trashed: true })).rejects.toMatchObject({ status: 400 });
  expect(fetch).not.toHaveBeenCalled();
});
it('does not expose upstream permission error text', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('token: secret', { status: 403 })),
  );
  await expect(getFile(s, 'abc')).rejects.toMatchObject({
    status: 403,
    message: 'Google Drive could not provide this file. Check permissions or try again later.',
  });
});
