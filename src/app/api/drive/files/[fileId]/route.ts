import { NextResponse } from 'next/server';
import { requireSession, setSession } from '@/lib/auth/session';
import { getFile, updateFile } from '@/lib/drive/files';
import { getConfig } from '@/lib/config';
import { ApiError, errorResponse } from '@/lib/errors';
export const runtime = 'nodejs';
export async function GET(request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  try {
    const result = await getFile(await requireSession(request), (await params).fileId);
    const r = NextResponse.json(result.file, { headers: { 'Cache-Control': 'private, no-store' } });
    if (result.changed) await setSession(r, result.session);
    return r;
  } catch (e) {
    return errorResponse(e);
  }
}

async function change(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> },
  trash: boolean,
) {
  try {
    if (request.headers.get('origin') !== getConfig().origin)
      throw new ApiError(403, 'INVALID_ORIGIN', 'This request is not allowed.');
    const session = await requireSession(request);
    let patch: { name: string } | { trashed: true } = { trashed: true };
    if (!trash) {
      const body = await request.json().catch(() => {
        throw new ApiError(400, 'INVALID_NAME', 'Enter a name between 1 and 255 characters.');
      });
      if (
        !body ||
        typeof body.name !== 'string' ||
        Object.keys(body).length !== 1 ||
        !body.name.trim() ||
        body.name.trim().length > 255 ||
        /[\u0000-\u001f\u007f]/.test(body.name)
      )
        throw new ApiError(
          400,
          'INVALID_NAME',
          'Enter a name between 1 and 255 characters without control characters.',
        );
      patch = { name: body.name.trim() };
    }
    const result = await updateFile(session, (await params).fileId, patch);
    const r = NextResponse.json(result.file, { headers: { 'Cache-Control': 'private, no-store' } });
    if (result.changed) await setSession(r, result.session);
    return r;
  } catch (e) {
    return errorResponse(e);
  }
}
export async function PATCH(request: Request, context: { params: Promise<{ fileId: string }> }) {
  return change(request, context, false);
}
export async function DELETE(request: Request, context: { params: Promise<{ fileId: string }> }) {
  return change(request, context, true);
}
