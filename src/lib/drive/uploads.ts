import 'server-only';
import { seal, unseal } from '@/lib/auth/session';
import { authorizedFetch } from '@/lib/auth/tokens';
import { ApiError } from '@/lib/errors';
import type { DriveFile, Session } from '@/lib/types';
import { getFile, parseFileId } from './files';
import { UPLOAD_CHUNK_SIZE, type UploadProgress } from './upload-types';

interface UploadTicket {
  kind: 'drive-upload';
  accountId: string;
  url: string;
  size: number;
  mimeType: string;
}
const invalid = () =>
  new ApiError(400, 'INVALID_UPLOAD', 'Choose a valid file and destination folder.');
const expiredUpload = () =>
  new ApiError(410, 'UPLOAD_EXPIRED', 'This upload session expired. Retry to start a new upload.');

function uploadUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.origin !== 'https://www.googleapis.com' ||
    url.pathname !== '/upload/drive/v3/files' ||
    url.searchParams.get('uploadType') !== 'resumable' ||
    !url.searchParams.get('upload_id') ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new ApiError(502, 'INVALID_UPLOAD_URL', 'Drive returned an invalid upload session.');
  return url;
}

async function checkUpload(response: Response) {
  if (response.ok || response.status === 308) return;
  if (response.status === 404 || response.status === 410) throw expiredUpload();
  if (response.status === 403) {
    const data = (await response.json().catch(() => null)) as {
      error?: { errors?: { reason?: unknown }[]; details?: { reason?: unknown }[] };
    } | null;
    const reasons = [
      ...(Array.isArray(data?.error?.errors) ? data.error.errors : []),
      ...(Array.isArray(data?.error?.details) ? data.error.details : []),
    ].map((entry) => entry?.reason);
    const rawReason = reasons.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT')
      ? 'insufficientPermissions'
      : reasons[0];
    const reason =
      typeof rawReason === 'string' && /^[A-Za-z0-9_]{1,80}$/.test(rawReason)
        ? rawReason
        : 'unknown';
    switch (reason) {
      case 'insufficientPermissions':
        throw new ApiError(
          403,
          'UPLOAD_SCOPE_REQUIRED',
          'Google sign-in succeeded, but Drive upload access was not granted. Sign in again and grant Drive upload access.',
        );
      case 'insufficientFilePermissions':
        throw new ApiError(
          403,
          'UPLOAD_FOLDER_DENIED',
          'You do not have permission to upload into this folder. Choose a folder you can edit.',
        );
      case 'storageQuotaExceeded':
        throw new ApiError(
          403,
          'UPLOAD_STORAGE_FULL',
          'Your Google Drive storage is full. Free up space and retry.',
        );
      case 'rateLimitExceeded':
      case 'userRateLimitExceeded':
        throw new ApiError(
          403,
          'UPLOAD_RATE_LIMITED',
          'Google Drive is busy. Wait a moment and retry.',
        );
      case 'dailyLimitExceeded':
        throw new ApiError(
          403,
          'UPLOAD_RATE_LIMITED',
          'This app has reached its Google Drive API daily request limit. Check the project quota in Google Cloud Console.',
        );
      case 'domainPolicy':
        throw new ApiError(
          403,
          'UPLOAD_POLICY_DENIED',
          'Your Google Workspace administrator has blocked this app from uploading to Drive.',
        );
      case 'activeItemCreationLimitExceeded':
        throw new ApiError(
          403,
          'UPLOAD_ITEM_LIMIT',
          'Your Google account has reached its Drive file creation limit. Remove files in Google Drive before retrying.',
        );
      case 'numChildrenInNonRootLimitExceeded':
        throw new ApiError(
          403,
          'UPLOAD_FOLDER_FULL',
          'This folder has reached its Google Drive file limit. Choose another folder.',
        );
      default:
        throw new ApiError(
          403,
          'UPLOAD_DENIED',
          `Google Drive denied this upload (${reason}). Share this reason to identify the restriction.`,
        );
    }
  }
  throw new ApiError(
    response.status === 429 ? 429 : 502,
    'UPLOAD_FAILED',
    'Google Drive could not finish this upload. Retry to continue from its saved progress.',
  );
}

export async function startUpload(session: Session, input: unknown, signal: AbortSignal) {
  const body = input as {
    name?: unknown;
    size?: unknown;
    mimeType?: unknown;
    parent?: unknown;
  } | null;
  if (
    !body ||
    typeof body.name !== 'string' ||
    !body.name.trim() ||
    body.name.length > 255 ||
    /[\u0000-\u001f\u007f]/.test(body.name) ||
    typeof body.size !== 'number' ||
    !Number.isSafeInteger(body.size) ||
    body.size < 0 ||
    body.size > 5 * 1024 ** 4 ||
    typeof body.parent !== 'string' ||
    typeof body.mimeType !== 'string' ||
    !/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(body.mimeType) ||
    body.mimeType.startsWith('application/vnd.google-apps.')
  )
    throw invalid();
  const parent = parseFileId(body.parent);
  const destination = await getFile(session, parent);
  if (destination.file.mimeType !== 'application/vnd.google-apps.folder') throw invalid();
  if (destination.file.capabilities?.canAddChildren !== true)
    throw new ApiError(
      403,
      'UPLOAD_DENIED',
      'You do not have permission to upload into this folder.',
    );
  const url = new URL('https://www.googleapis.com/upload/drive/v3/files');
  url.search = new URLSearchParams({
    uploadType: 'resumable',
    supportsAllDrives: 'true',
    fields: 'id,name,mimeType,size,parents,capabilities(canDownload,canRename,canTrash)',
  }).toString();
  const result = await authorizedFetch(destination.session, url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': body.mimeType,
      'X-Upload-Content-Length': String(body.size),
    },
    body: JSON.stringify({ name: body.name, mimeType: body.mimeType, parents: [parent] }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
  });
  await checkUpload(result.response);
  const location = result.response.headers.get('location');
  if (!location)
    throw new ApiError(502, 'MISSING_UPLOAD_URL', 'Drive did not start the upload. Retry.');
  const ticket = await seal(
    {
      kind: 'drive-upload',
      accountId: session.subject,
      url: uploadUrl(location).href,
      size: body.size,
      mimeType: body.mimeType,
    } satisfies UploadTicket,
    7 * 86400,
  );
  return {
    ticket,
    session: result.session,
    changed: destination.changed || result.changed,
  };
}

export async function readUploadTicket(value: string, session: Session): Promise<UploadTicket> {
  const data = await unseal(value);
  if (!data) throw expiredUpload();
  if (
    data.kind !== 'drive-upload' ||
    data.accountId !== session.subject ||
    typeof data.url !== 'string' ||
    typeof data.size !== 'number' ||
    !Number.isSafeInteger(data.size) ||
    data.size < 0 ||
    typeof data.mimeType !== 'string'
  )
    throw new ApiError(
      400,
      'INVALID_UPLOAD_TICKET',
      'This upload session is invalid. Retry the upload.',
    );
  uploadUrl(data.url);
  return data as unknown as UploadTicket;
}

export function validateUploadChunk(ticket: UploadTicket, range: string, length: number) {
  if (range === `bytes */${ticket.size}` && length === 0) return;
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
  if (!match) throw invalid();
  const start = Number(match[1]),
    end = Number(match[2]),
    total = Number(match[3]);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    total !== ticket.size ||
    start < 0 ||
    end < start ||
    end >= total ||
    end - start + 1 !== length ||
    length > UPLOAD_CHUNK_SIZE ||
    (end !== total - 1 && length % (256 * 1024) !== 0)
  )
    throw invalid();
}

export async function sendUploadChunk(
  session: Session,
  ticket: UploadTicket,
  range: string,
  chunk: ArrayBuffer,
  signal: AbortSignal,
) {
  validateUploadChunk(ticket, range, chunk.byteLength);
  const result = await authorizedFetch(session, uploadUrl(ticket.url), {
    method: 'PUT',
    headers: {
      'Content-Type': ticket.mimeType,
      'Content-Length': String(chunk.byteLength),
      'Content-Range': range,
    },
    body: chunk,
    signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]),
  });
  await checkUpload(result.response);
  let progress: UploadProgress;
  if (result.response.status === 308) {
    const received = result.response.headers.get('range');
    const match = received ? /^bytes=0-(\d+)$/.exec(received) : null;
    const nextOffset = received === null ? 0 : match ? Number(match[1]) + 1 : NaN;
    if (!Number.isSafeInteger(nextOffset) || nextOffset < 0 || nextOffset > ticket.size)
      throw new ApiError(
        502,
        'INVALID_UPLOAD_PROGRESS',
        'Drive returned invalid upload progress. Retry.',
      );
    progress = { done: false, nextOffset };
  } else {
    const file = (await result.response.json()) as DriveFile;
    if (
      typeof file.id !== 'string' ||
      typeof file.name !== 'string' ||
      typeof file.mimeType !== 'string' ||
      Number(file.size) !== ticket.size
    )
      throw new ApiError(
        502,
        'INVALID_UPLOADED_FILE',
        'Could not verify the uploaded file. Retry to check its status.',
      );
    progress = { done: true, file };
  }
  return { progress, session: result.session, changed: result.changed };
}
