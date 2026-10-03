import { NextResponse } from 'next/server';
import { createTransaction, authorizationUrl } from '@/lib/auth/oauth';
import { seal, cookieOptions, TRANSACTION_COOKIE } from '@/lib/auth/session';
import { errorResponse } from '@/lib/errors';
export const runtime = 'nodejs';
export async function GET() {
  try {
    const t = createTransaction();
    const r = NextResponse.redirect(authorizationUrl(t));
    r.headers.set('Cache-Control', 'private, no-store');
    r.cookies.set(TRANSACTION_COOKIE, await seal(t, 600), cookieOptions(600));
    return r;
  } catch (e) {
    return errorResponse(e);
  }
}
