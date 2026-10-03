import { NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';
import { validateTransaction, exchangeCode } from '@/lib/auth/oauth';
import {
  cookieValue,
  unseal,
  setSession,
  cookieOptions,
  TRANSACTION_COOKIE,
} from '@/lib/auth/session';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  const c = getConfig();
  let r: NextResponse;
  try {
    const url = new URL(request.url);
    if (url.searchParams.get('error')) throw new Error('Denied');
    const t = validateTransaction(
      await unseal(cookieValue(request, TRANSACTION_COOKIE)),
      url.searchParams.get('state') ?? '',
    );
    const code = url.searchParams.get('code');
    if (!code) throw new Error('Missing code');
    const session = await exchangeCode(code, t);
    r = NextResponse.redirect(new URL('/', c.origin));
    await setSession(r, session);
  } catch {
    r = NextResponse.redirect(new URL('/?error=signin', c.origin));
  }
  r.headers.set('Cache-Control', 'private, no-store');
  r.cookies.set(TRANSACTION_COOKIE, '', cookieOptions(0));
  return r;
}
