import { NextResponse } from 'next/server';
import { requireSession, setSession } from '@/lib/auth/session';
import { listFiles } from '@/lib/drive/files';
import { errorResponse } from '@/lib/errors';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const p = new URL(request.url).searchParams;
    const result = await listFiles(await requireSession(request), {
      parent: p.get('parent') ?? 'root',
      query: p.get('q') ?? undefined,
      pageToken: p.get('pageToken') ?? undefined,
    });
    const r = NextResponse.json(result.page, { headers: { 'Cache-Control': 'private, no-store' } });
    if (result.changed) await setSession(r, result.session);
    return r;
  } catch (e) {
    return errorResponse(e);
  }
}
