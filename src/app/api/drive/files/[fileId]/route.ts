import { NextResponse } from 'next/server';
import { requireSession, setSession } from '@/lib/auth/session';
import { getFile } from '@/lib/drive/files';
import { errorResponse } from '@/lib/errors';
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
