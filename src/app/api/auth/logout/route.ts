import { NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';
import { clearSession } from '@/lib/auth/session';
import { errorResponse, ApiError } from '@/lib/errors';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    const c = getConfig();
    if (request.headers.get('origin') !== c.origin)
      throw new ApiError(403, 'INVALID_ORIGIN', 'This request is not allowed.');
    const r = NextResponse.redirect(new URL('/', c.origin), 303);
    clearSession(r);
    r.headers.set('Cache-Control', 'private, no-store');
    return r;
  } catch (e) {
    return errorResponse(e);
  }
}
