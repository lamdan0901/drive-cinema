'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { DriveFile, FilePage, SubtitleCandidate } from '@/lib/types';
import { matchSubtitles } from '@/lib/media/match';
import { FileBrowser } from './file-browser';
import { VideoPlayer } from './video-player';
const folderType = 'application/vnd.google-apps.folder';
async function json<T>(url: string, signal: AbortSignal): Promise<T> {
  const r = await fetch(url, { signal, cache: 'no-store' });
  const value = await r.json();
  if (!r.ok) {
    const e = new Error(value.error ?? 'Could not load your Drive. Please try again.');
    Object.assign(e, { status: r.status });
    throw e;
  }
  return value;
}
export function Library({ name }: { name?: string }) {
  const [path, setPath] = useState([{ id: 'root', name: 'My Drive' }]);
  const parent = path.at(-1)!.id;
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [next, setNext] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [unauthorized, setUnauthorized] = useState(false);
  const [retry, setRetry] = useState(0);
  const [link, setLink] = useState('');
  const [opening, setOpening] = useState(false);
  const [video, setVideo] = useState<DriveFile | null>(null);
  const [candidates, setCandidates] = useState<SubtitleCandidate[]>([]);
  const listRequest = useRef<{ controller: AbortController; id: number } | null>(null);
  const selection = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  function showError(e: unknown) {
    setError(e instanceof Error ? e.message : 'Please try again.');
    setUnauthorized((e as { status?: number })?.status === 401);
  }
  useEffect(() => {
    const controller = new AbortController();
    const id = ++sequence.current;
    listRequest.current?.controller.abort();
    listRequest.current = { controller, id };
    setLoading(true);
    setError('');
    setUnauthorized(false);
    setFiles([]);
    setNext(undefined);
    const p = new URLSearchParams({ parent, ...(query ? { q: query } : {}) });
    json<FilePage>('/api/drive/files?' + p, controller.signal)
      .then((page) => {
        if (sequence.current !== id) return;
        setFiles(page.files);
        setNext(page.nextPageToken);
      })
      .catch((e) => {
        if (!controller.signal.aborted) showError(e);
      })
      .finally(() => {
        if (sequence.current === id) setLoading(false);
      });
    return () => controller.abort();
  }, [parent, query, retry]);
  useEffect(
    () => () => {
      selection.current?.abort();
      listRequest.current?.controller.abort();
    },
    [],
  );
  async function more() {
    if (!next) return;
    listRequest.current?.controller.abort();
    const controller = new AbortController(),
      id = ++sequence.current;
    listRequest.current = { controller, id };
    setLoading(true);
    setError('');
    try {
      const p = new URLSearchParams({ parent, ...(query ? { q: query } : {}), pageToken: next });
      const page = await json<FilePage>('/api/drive/files?' + p, controller.signal);
      if (sequence.current === id) {
        setFiles((old) =>
          Array.from(new Map([...old, ...page.files].map((f) => [f.id, f])).values()),
        );
        setNext(page.nextPageToken);
      }
    } catch (e) {
      if (!controller.signal.aborted) showError(e);
    } finally {
      if (sequence.current === id) setLoading(false);
    }
  }
  function navigate(nextPath: { id: string; name: string }[]) {
    selection.current?.abort();
    setOpening(false);
    setVideo(null);
    setCandidates([]);
    setPath(nextPath);
    setSearch('');
    setQuery('');
  }
  function folder(file: DriveFile) {
    navigate([...path, { id: file.id, name: file.name }]);
  }
  async function open(idOrLink: string) {
    selection.current?.abort();
    const controller = new AbortController();
    selection.current = controller;
    setOpening(true);
    setError('');
    try {
      const file = await json<DriveFile>(
        '/api/drive/files/' + encodeURIComponent(idOrLink),
        controller.signal,
      );
      if (file.mimeType === folderType) {
        if (!controller.signal.aborted) folder(file);
        return;
      }
      if (!file.mimeType.startsWith('video/'))
        throw new Error('Choose a video file or folder from Google Drive.');
      if (file.capabilities?.canDownload !== true)
        throw new Error('This video does not allow downloads or direct playback.');
      if (controller.signal.aborted) return;
      setCandidates([]);
      setVideo(file);
      const subtitleFiles: DriveFile[] = [];
      let token: string | undefined;
      do {
        const p = new URLSearchParams({
          parent: file.parents?.[0] ?? parent,
          ...(token ? { pageToken: token } : {}),
        });
        const page = await json<FilePage>('/api/drive/files?' + p, controller.signal);
        subtitleFiles.push(...page.files.filter((f) => /\.(srt|vtt)$/i.test(f.name)));
        token = page.nextPageToken;
      } while (token && !controller.signal.aborted);
      if (!controller.signal.aborted) setCandidates(matchSubtitles(file.name, subtitleFiles));
    } catch (e) {
      if (!controller.signal.aborted) showError(e);
    } finally {
      if (selection.current === controller) setOpening(false);
    }
  }
  const visible = files.filter((f) => f.mimeType === folderType || f.mimeType.startsWith('video/'));
  const videos = visible.filter((f) => f.mimeType.startsWith('video/')).length;
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link className="brand" href="/">
          ◉ <span>Drive Cinema</span>
        </Link>
        <div className="account">
          <span>{name ?? 'Your library'}</span>
          <form action="/api/auth/logout" method="post">
            <button className="text-button" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="library">
        <div className="library-heading">
          <div>
            <p className="eyebrow">YOUR PERSONAL SCREENING ROOM</p>
            <h1>One more good watch.</h1>
            <p className="lead">Your collection, right where you left it.</p>
          </div>
          <span className="drive-badge">
            <i />
            Connected to Drive
          </span>
        </div>
        {error && (
          <div className="error-message" role="alert">
            {error}{' '}
            {unauthorized ? (
              <a className="inline-link" href="/api/auth/login">
                Sign in again
              </a>
            ) : (
              <button className="text-button" onClick={() => setRetry((n) => n + 1)}>
                Retry
              </button>
            )}
          </div>
        )}
        {video && (
          <VideoPlayer
            key={video.id}
            video={video}
            subtitleCandidates={candidates}
            onClose={() => {
              selection.current?.abort();
              setVideo(null);
              setOpening(false);
            }}
          />
        )}
        <div className="collection-panel">
          <div className="collection-tools">
            <nav aria-label="Folder breadcrumbs" className="breadcrumbs">
              {path.map((f, i) => (
                <span key={i}>
                  {i > 0 && (
                    <span className="separator" aria-hidden>
                      /
                    </span>
                  )}
                  <button
                    onClick={() => {
                      navigate(path.slice(0, i + 1));
                    }}
                    aria-current={i === path.length - 1 ? 'page' : undefined}
                  >
                    {f.name}
                  </button>
                </span>
              ))}
            </nav>
            <form
              role="search"
              className="search"
              onSubmit={(e) => {
                e.preventDefault();
                setQuery(search.trim());
              }}
            >
              <span aria-hidden>⌕</span>
              <input
                aria-label="Search this folder"
                placeholder="Search this folder"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                maxLength={200}
              />
              <button type="submit" aria-label="Run search">
                ↵
              </button>
            </form>
          </div>
          <div className="section-label">
            <span>{query ? `Results for “${query}”` : 'IN THIS FOLDER'}</span>
            <span>
              {videos} video{videos === 1 ? '' : 's'}
            </span>
          </div>
          <FileBrowser files={visible} onFolder={folder} onVideo={(f) => void open(f.id)} />
          {loading && (
            <p className="loading" role="status">
              Loading your collection…
            </p>
          )}
          {!loading && !visible.length && !error && (
            <div className="empty">
              <span aria-hidden>▰</span>
              <h2>Nothing here yet</h2>
              <p>
                {query
                  ? 'Try a different search in this folder.'
                  : 'Open a folder with videos, or paste a Drive link below.'}
              </p>
            </div>
          )}
          {next && (
            <button className="button more" disabled={loading} onClick={() => void more()}>
              Load more
            </button>
          )}
        </div>
        <form
          className="shortcut"
          onSubmit={(e) => {
            e.preventDefault();
            if (link.trim()) void open(link.trim());
          }}
        >
          <div>
            <h2>Have a link?</h2>
            <p>Jump straight to a video or folder in your Drive.</p>
          </div>
          <div className="link-controls">
            <input
              aria-label="Google Drive link or file ID"
              placeholder="Paste a Google Drive link or file ID"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              required
            />
            <button className="button primary" disabled={opening}>
              {opening ? 'Opening…' : 'Open ↗'}
            </button>
          </div>
        </form>
        <footer>
          <span>Keep your files. Bring your subtitles.</span>
          <span>SRT + VTT · Browser-compatible videos</span>
        </footer>
      </main>
    </div>
  );
}
