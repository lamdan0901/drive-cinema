import 'server-only';
import { ApiError } from '@/lib/errors';
import { authorizedFetch } from '@/lib/auth/tokens';
import { checkDrive } from './client';
import type { Session, DriveFile, FilePage } from '@/lib/types';
const fields = 'id,name,mimeType,size,parents,modifiedTime,capabilities(canDownload)';
export function parseFileId(input: string): string {
  let id = input.trim();
  if (id.startsWith('http')) {
    let url: URL;
    try {
      url = new URL(id);
    } catch {
      throw new ApiError(400, 'INVALID_ID', 'Enter a valid Google Drive link or file ID.');
    }
    if (url.hostname !== 'drive.google.com' || url.protocol !== 'https:')
      throw new ApiError(400, 'INVALID_ID', 'Use a Google Drive link or file ID.');
    id =
      url.pathname.match(/\/(?:file\/d|folders)\/([\w-]+)/)?.[1] ??
      url.searchParams.get('id') ??
      '';
  }
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(id))
    throw new ApiError(400, 'INVALID_ID', 'Enter a valid Google Drive link or file ID.');
  return id;
}
export async function getFile(session: Session, id: string) {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${parseFileId(id)}`);
  url.searchParams.set('fields', fields);
  const result = await authorizedFetch(session, url, { signal: AbortSignal.timeout(20000) });
  checkDrive(result.response);
  const file = (await result.response.json()) as DriveFile;
  return { file, session: result.session, changed: result.changed };
}
const literal = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
export async function listFiles(
  session: Session,
  options: { parent: string; query?: string; pageToken?: string },
) {
  const parent = parseFileId(options.parent);
  const q = [`'${literal(parent)}' in parents`, 'trashed = false'];
  if (options.query) {
    if (options.query.length > 200)
      throw new ApiError(400, 'INVALID_QUERY', 'Keep search under 200 characters.');
    q.push(`name contains '${literal(options.query)}'`);
  }
  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.search = new URLSearchParams({
    q: q.join(' and '),
    spaces: 'drive',
    fields: `nextPageToken,files(${fields})`,
    pageSize: '100',
    orderBy: 'folder,name',
    ...(options.pageToken ? { pageToken: options.pageToken } : {}),
  }).toString();
  const result = await authorizedFetch(session, url, { signal: AbortSignal.timeout(20000) });
  checkDrive(result.response);
  const page = (await result.response.json()) as FilePage;
  return { page, session: result.session, changed: result.changed };
}
