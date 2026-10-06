import { UPLOAD_CHUNK_SIZE, type UploadProgress } from './upload-types';
import type { DriveFile } from '@/lib/types';

export class UploadError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

async function request<T>(signal: AbortSignal, init: RequestInit): Promise<T> {
  const response = await fetch('/api/drive/uploads', { ...init, signal, cache: 'no-store' });
  const value = await response.json();
  if (!response.ok)
    throw new UploadError(
      typeof value.error === 'string'
        ? value.error
        : 'Could not upload this file. Retry to continue.',
      response.status,
      typeof value.code === 'string' ? value.code : undefined,
    );
  return value;
}

export async function uploadFile(
  file: File,
  parent: string,
  options: {
    signal: AbortSignal;
    ticket?: string;
    onTicket: (ticket: string) => void;
    onProgress: (received: number) => void;
  },
): Promise<DriveFile> {
  const { signal, onTicket, onProgress } = options;
  let ticket = options.ticket;
  let offset = 0;
  const probe = () =>
    request<UploadProgress>(signal, {
      method: 'PUT',
      headers: { 'X-Upload-Ticket': ticket!, 'Content-Range': `bytes */${file.size}` },
    });
  if (ticket) {
    let progress: UploadProgress;
    try {
      progress = await probe();
    } catch (error) {
      if (!(error instanceof UploadError) || error.status !== 410) throw error;
      ticket = undefined;
      progress = { done: false, nextOffset: 0 };
    }
    if (progress.done) {
      onProgress(file.size);
      return progress.file;
    }
    offset = progress.nextOffset;
  }
  if (!ticket) {
    const session = await request<{ ticket: string }>(signal, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: file.name,
        size: file.size,
        mimeType: file.type || 'application/octet-stream',
        parent,
      }),
    });
    if (typeof session.ticket !== 'string' || !session.ticket)
      throw new Error('Could not start the upload. Retry this file.');
    ticket = session.ticket;
    onTicket(ticket);
  }
  onProgress(offset);
  while (true) {
    signal.throwIfAborted();
    const end = Math.min(offset + UPLOAD_CHUNK_SIZE, file.size);
    const progress =
      offset === file.size
        ? await probe()
        : await request<UploadProgress>(signal, {
            method: 'PUT',
            headers: {
              'X-Upload-Ticket': ticket,
              'Content-Type': 'application/octet-stream',
              'Content-Range': `bytes ${offset}-${end - 1}/${file.size}`,
            },
            body: file.slice(offset, end),
          });
    if (progress.done) {
      onProgress(file.size);
      return progress.file;
    }
    if (
      !Number.isSafeInteger(progress.nextOffset) ||
      progress.nextOffset <= offset ||
      progress.nextOffset > end
    )
      throw new Error('Drive has not confirmed this chunk. Retry to check its saved progress.');
    offset = progress.nextOffset;
    onProgress(offset);
  }
}
