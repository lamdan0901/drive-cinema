import { NextResponse } from 'next/server';
import { requireSession, setSession } from '@/lib/auth/session';
import { getConfig } from '@/lib/config';
import { ApiError, errorResponse } from '@/lib/errors';
import { readUploadTicket, sendUploadChunk, startUpload } from '@/lib/drive/uploads';
import { UPLOAD_CHUNK_SIZE } from '@/lib/drive/upload-types';

export const runtime = 'nodejs';

function checkOrigin(request: Request) {
  if (request.headers.get('origin') !== getConfig().origin)
    throw new ApiError(403, 'INVALID_ORIGIN', 'This request is not allowed.');
}

async function readBody(request: Request, limit: number): Promise<ArrayBuffer> {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit))
    throw new ApiError(413, 'UPLOAD_TOO_LARGE', 'This upload chunk is too large.');
  if (!request.body) return new ArrayBuffer(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new ApiError(413, 'UPLOAD_TOO_LARGE', 'This upload chunk is too large.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer;
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const session = await requireSession(request);
    const body = await readBody(request, 4096);
    let input: unknown;
    try {
      input = JSON.parse(new TextDecoder().decode(body));
    } catch {
      throw new ApiError(400, 'INVALID_UPLOAD', 'Choose a valid file and destination folder.');
    }
    const result = await startUpload(session, input, request.signal);
    const response = NextResponse.json(
      { ticket: result.ticket },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
    if (result.changed) await setSession(response, result.session);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    checkOrigin(request);
    const session = await requireSession(request);
    const token = request.headers.get('x-upload-ticket');
    if (!token || token.length > 4096)
      throw new ApiError(
        400,
        'INVALID_UPLOAD_TICKET',
        'This upload session is invalid. Retry the upload.',
      );
    const ticket = await readUploadTicket(token, session);
    const body = await readBody(request, UPLOAD_CHUNK_SIZE);
    const result = await sendUploadChunk(
      session,
      ticket,
      request.headers.get('content-range') ?? '',
      body,
      request.signal,
    );
    const response = NextResponse.json(result.progress, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
    if (result.changed) await setSession(response, result.session);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
