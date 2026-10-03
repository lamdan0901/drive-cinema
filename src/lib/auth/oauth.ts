import 'server-only';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { getConfig } from '@/lib/config';
import { ApiError } from '@/lib/errors';
import type { Session } from '@/lib/types';
export interface Transaction {
  state: string;
  verifier: string;
  nonce: string;
  createdAt: number;
}
export function createTransaction(): Transaction {
  return {
    state: randomBytes(32).toString('base64url'),
    verifier: randomBytes(48).toString('base64url'),
    nonce: randomBytes(32).toString('base64url'),
    createdAt: Date.now(),
  };
}
export function challenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}
export function authorizationUrl(t: Transaction): URL {
  const c = getConfig();
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: c.googleClientId,
    redirect_uri: c.origin + '/api/auth/callback',
    response_type: 'code',
    scope: 'openid profile https://www.googleapis.com/auth/drive.readonly',
    access_type: 'offline',
    prompt: 'consent',
    state: t.state,
    nonce: t.nonce,
    code_challenge: challenge(t.verifier),
    code_challenge_method: 'S256',
  }).toString();
  return url;
}
export function validateTransaction(value: unknown, state: string): Transaction {
  const t = value as Transaction | null;
  if (
    !t ||
    typeof t.state !== 'string' ||
    typeof t.verifier !== 'string' ||
    typeof t.nonce !== 'string' ||
    typeof t.createdAt !== 'number' ||
    t.createdAt > Date.now() + 5000 ||
    Date.now() - t.createdAt > 600000
  )
    throw new ApiError(400, 'INVALID_STATE', 'Sign-in expired. Please try again.');
  const a = Buffer.from(t.state),
    b = Buffer.from(state);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    throw new ApiError(400, 'INVALID_STATE', 'Sign-in could not be verified. Please try again.');
  return t;
}
export async function exchangeCode(code: string, t: Transaction): Promise<Session> {
  const c = getConfig();
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: c.googleClientId,
      client_secret: c.googleClientSecret,
      code,
      code_verifier: t.verifier,
      redirect_uri: c.origin + '/api/auth/callback',
      grant_type: 'authorization_code',
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw new ApiError(400, 'OAUTH_FAILED', 'Google sign-in failed. Please try again.');
  const data = await response.json();
  if (
    typeof data.id_token !== 'string' ||
    typeof data.access_token !== 'string' ||
    typeof data.refresh_token !== 'string' ||
    !Number.isFinite(data.expires_in) ||
    data.expires_in <= 0
  )
    throw new ApiError(
      400,
      'OAUTH_FAILED',
      'Google did not provide the required credentials. Please try signing in again.',
    );
  const ticket = await new OAuth2Client(c.googleClientId).verifyIdToken({
    idToken: data.id_token,
    audience: c.googleClientId,
  });
  const identity = ticket.getPayload();
  if (!identity?.sub || identity.nonce !== t.nonce)
    throw new ApiError(400, 'OAUTH_FAILED', 'Google identity could not be verified.');
  return {
    subject: identity.sub,
    name: identity.name?.slice(0, 100),
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    accessExpiresAt: Date.now() + data.expires_in * 1000,
    sessionExpiresAt: Date.now() + 7 * 86400000,
  };
}
