import 'server-only';
import { EncryptJWT, jwtDecrypt } from 'jose';
import { NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';
import { expired } from '@/lib/errors';
import type { Session } from '@/lib/types';
export const SESSION_COOKIE = 'drive_session';
export const TRANSACTION_COOKIE = 'drive_oauth';
const key = () => Buffer.from(getConfig().sessionSecret, 'hex');
export async function seal(payload: object, seconds: number): Promise<string> {
  return new EncryptJWT({ ...payload })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setIssuer('drive-cinema')
    .setAudience('drive-cinema')
    .setExpirationTime(Math.floor(Date.now() / 1000) + seconds)
    .encrypt(key());
}
export async function unseal(value: string): Promise<Record<string, unknown> | null> {
  try {
    return (
      await jwtDecrypt(value, key(), {
        issuer: 'drive-cinema',
        audience: 'drive-cinema',
        keyManagementAlgorithms: ['dir'],
        contentEncryptionAlgorithms: ['A256GCM'],
      })
    ).payload;
  } catch {
    return null;
  }
}
export function cookieValue(request: Request, name: string): string {
  return (
    request.headers
      .get('cookie')
      ?.split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith(name + '='))
      ?.slice(name.length + 1) ?? ''
  );
}
export const cookieOptions = (seconds: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: seconds,
});
export async function readSession(request: Request): Promise<Session | null> {
  const p = await unseal(cookieValue(request, SESSION_COOKIE));
  if (
    !p ||
    typeof p.subject !== 'string' ||
    typeof p.accessToken !== 'string' ||
    !p.accessToken ||
    typeof p.accessExpiresAt !== 'number' ||
    typeof p.sessionExpiresAt !== 'number' ||
    p.sessionExpiresAt <= Date.now() ||
    (p.refreshToken !== undefined && typeof p.refreshToken !== 'string')
  )
    return null;
  return {
    subject: p.subject,
    name: typeof p.name === 'string' ? p.name : undefined,
    accessToken: p.accessToken,
    refreshToken: p.refreshToken as string | undefined,
    accessExpiresAt: p.accessExpiresAt,
    sessionExpiresAt: p.sessionExpiresAt,
  };
}
export async function requireSession(request: Request): Promise<Session> {
  const s = await readSession(request);
  if (!s) throw expired();
  return s;
}
export async function setSession(response: NextResponse, session: Session): Promise<void> {
  const ttl = Math.max(0, Math.floor((session.sessionExpiresAt - Date.now()) / 1000));
  const value = await seal(session, ttl);
  if (value.length > 3600) throw new Error('Session cookie exceeds safe size.');
  response.cookies.set(SESSION_COOKIE, value, cookieOptions(ttl));
}
export function clearSession(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, '', cookieOptions(0));
  response.cookies.set(TRANSACTION_COOKIE, '', cookieOptions(0));
}
