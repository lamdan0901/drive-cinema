import { cookies } from 'next/headers';
import { configurationStatus, getConfig } from '@/lib/config';
import { readSession } from '@/lib/auth/session';
import { Library } from '@/components/library';
export const dynamic = 'force-dynamic';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const query = await searchParams;
  const status = configurationStatus();
  let configurationError = '';
  try {
    if (status.ready) getConfig();
  } catch {
    configurationError = 'Check APP_ORIGIN and SESSION_SECRET in your environment settings.';
  }
  const session =
    status.ready && !configurationError
      ? await readSession(
          new Request('http://internal', { headers: { cookie: (await cookies()).toString() } }),
        )
      : null;
  if (session) return <Library key={session.subject} accountId={session.subject} name={session.name} />;
  return (
    <main className="landing">
      <span className="brand">◉ Drive Cinema</span>
      <p className="eyebrow">A LITTLE SPACE FOR YOUR NEXT WATCH</p>
      <h1>
        Your Drive.
        <br />
        Your cinema.
      </h1>
      <p className="lead">
        Press play on your own collection. Bring your subtitles.
        <br />
        Keep everything in Google Drive.
      </p>
      {status.ready && !configurationError ? (
        <a className="button primary" href="/api/auth/login">
          Continue with Google <span>↗</span>
        </a>
      ) : (
        <div className="notice">
          <strong>Finish your setup</strong>
          <p>
            {configurationError ||
              `Set ${status.missing.join(', ')} in .env.local, then restart the app.`}
          </p>
        </div>
      )}
      {query.error === 'signin' && (
        <p className="error-message" role="alert">
          Google sign-in could not be completed. Check your Google app settings and try again.
        </p>
      )}
      <p className="muted">Personal library · External subtitles · No uploads needed</p>
    </main>
  );
}
