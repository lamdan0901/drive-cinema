import 'server-only';
const names = ['APP_ORIGIN', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SESSION_SECRET'] as const;
export function configurationStatus() {
  const missing = names.filter((name) => !process.env[name]?.trim());
  return { ready: missing.length === 0, missing };
}
export function getConfig() {
  if (!configurationStatus().ready) throw new Error('Application configuration is incomplete.');
  const { APP_ORIGIN: raw, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SESSION_SECRET } = process.env;
  let url: URL;
  try {
    url = new URL(raw!);
  } catch {
    throw new Error('APP_ORIGIN must be a valid origin.');
  }
  if (
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  )
    throw new Error('APP_ORIGIN must be an HTTPS origin (HTTP is allowed for localhost).');
  if (!/^[a-fA-F0-9]{64}$/.test(SESSION_SECRET!))
    throw new Error('SESSION_SECRET must contain 64 hex characters.');
  return {
    origin: url.origin,
    googleClientId: GOOGLE_CLIENT_ID!,
    googleClientSecret: GOOGLE_CLIENT_SECRET!,
    sessionSecret: SESSION_SECRET!,
  };
}
