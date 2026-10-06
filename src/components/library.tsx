'use client';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import type { DriveFile, FilePage, SubtitleCandidate } from '@/lib/types';
import { matchSubtitles } from '@/lib/media/match';
import { readPins, writePins, type PinnedFolder } from '@/lib/media/pins';
import { FileBrowser } from './file-browser';
import { VideoPlayer } from './video-player';
import { FolderVideoSidebar } from './folder-video-sidebar';
import { UploadControl } from './upload-control';
import { createFolderVideoCache } from '@/lib/media/folder-video-cache';
const folderType = 'application/vnd.google-apps.folder';
const viewStorageKey = 'drive-cinema:view';
const rootPath = [{ id: 'root', name: 'My Drive' }];
function updateLocation(values: { folder?: string; file?: string; q?: string }) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(values)) {
    if (value && !(key === 'folder' && value === 'root')) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  if (url.href !== window.location.href) window.history.pushState(null, '', url);
}
function checkVideo(file: DriveFile) {
  if (!file.mimeType.startsWith('video/'))
    throw new Error('Choose a video file or folder from Google Drive.');
  if (file.capabilities?.canDownload !== true)
    throw new Error('This video does not allow downloads or direct playback.');
}
async function folderPath(id: string, signal: AbortSignal) {
  if (id === 'root') return rootPath;
  const [root, folder] = await Promise.all([
    json<DriveFile>('/api/drive/files/root', signal),
    json<DriveFile>('/api/drive/files/' + encodeURIComponent(id), signal),
  ]);
  const parts: { id: string; name: string }[] = [];
  const seen = new Set<string>();
  let current = folder;
  while (current.id !== root.id && current.id !== 'root') {
    if (current.mimeType !== folderType || seen.has(current.id))
      throw new Error('Could not restore this folder path.');
    seen.add(current.id);
    parts.unshift({ id: current.id, name: current.name });
    const parentId = current.parents?.[0];
    if (!parentId || parentId === root.id || parentId === 'root') break;
    current = await json<DriveFile>('/api/drive/files/' + encodeURIComponent(parentId), signal);
  }
  return [...rootPath, ...parts];
}
async function json<T>(url: string, signal: AbortSignal, init: RequestInit = {}): Promise<T> {
  const r = await fetch(url, { ...init, signal, cache: 'no-store' });
  const value = await r.json();
  if (!r.ok) {
    const e = new Error(value.error ?? 'Could not load your Drive. Please try again.');
    Object.assign(e, { status: r.status });
    throw e;
  }
  return value;
}
export function Library({ name, accountId }: { name?: string; accountId: string }) {
  const [path, setPath] = useState(rootPath);
  const [locationReady, setLocationReady] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [folderVideoCache] = useState(createFolderVideoCache);
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        !locationReady ||
        event.defaultPrevented ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.repeat ||
        event.isComposing
      )
        return;
      if (
        event.target instanceof Element &&
        event.target.closest(
          'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]',
        )
      )
        return;
      if (event.key.toLowerCase() === 'p') {
        event.preventDefault();
        setSidebarOpen((value) => !value);
      } else if (event.key === 'Escape') setSidebarOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [locationReady]);
  const [restoreRetry, setRestoreRetry] = useState(0);
  const currentPath = useRef(path);
  useEffect(() => {
    currentPath.current = path;
  }, [path]);
  const parent = path.at(-1)!.id;
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [view, setView] = useState<'list' | 'grid'>('list');
  useEffect(() => {
    try {
      const saved = localStorage.getItem(viewStorageKey);
      if (saved === 'list' || saved === 'grid') setView(saved);
    } catch {
      // Use the default view when browser storage is unavailable.
    }
  }, []);
  function chooseView(nextView: 'list' | 'grid') {
    setView(nextView);
    try {
      localStorage.setItem(viewStorageKey, nextView);
    } catch {
      // View switching still works for this session when storage is blocked.
    }
  }
  const [next, setNext] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [unauthorized, setUnauthorized] = useState(false);
  const [retry, setRetry] = useState(0);
  const [link, setLink] = useState('');
  const [opening, setOpening] = useState(false);
  const [video, setVideo] = useState<DriveFile | null>(null);
  const [candidates, setCandidates] = useState<SubtitleCandidate[]>([]);
  const [pins, setPins] = useState<PinnedFolder[]>([]);
  const currentPins = useRef<PinnedFolder[]>([]);
  const [pinError, setPinError] = useState('');
  const [busy, setBusy] = useState(false);
  const mutation = useRef<AbortController | null>(null);
  const listRequest = useRef<{ controller: AbortController; id: number } | null>(null);
  const selection = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  function showError(e: unknown) {
    setError(e instanceof Error ? e.message : 'Please try again.');
    const status = (e as { status?: number })?.status;
    setUnauthorized(status === 401 || status === 403);
  }
  const restoreLocation = useEffectEvent(() => {
    selection.current?.abort();
    listRequest.current?.controller.abort();
    ++sequence.current;
    const controller = new AbortController();
    selection.current = controller;
    const params = new URLSearchParams(window.location.search);
    const folderId = params.get('folder') || 'root';
    const fileId = params.get('file');
    const savedQuery = params.get('q') || '';
    setLocationReady(false);
    setLoading(true);
    setOpening(!!fileId);
    setError('');
    setUnauthorized(false);
    setFiles([]);
    setNext(undefined);
    setVideo(null);
    setCandidates([]);
    setSearch(savedQuery);
    setQuery(savedQuery);
    (async () => {
      const [nextPath, nextVideo] = await Promise.all([
        folderPath(folderId, controller.signal),
        fileId
          ? json<DriveFile>('/api/drive/files/' + encodeURIComponent(fileId), controller.signal)
          : null,
      ]);
      if (controller.signal.aborted) return;
      if (nextVideo) checkVideo(nextVideo);
      currentPath.current = nextPath;
      setPath(nextPath);
      setVideo(nextVideo);
      setLocationReady(true);
    })()
      .catch((e) => {
        if (!controller.signal.aborted) showError(e);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
          setOpening(false);
        }
      });
  });
  useEffect(() => {
    restoreLocation();
    const onPopState = () => restoreLocation();
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      selection.current?.abort();
    };
  }, [restoreRetry]);
  useEffect(() => {
    if (!video) return;
    const controller = new AbortController();
    (async () => {
      const subtitleFiles: DriveFile[] = [];
      let token: string | undefined;
      do {
        const p = new URLSearchParams({
          parent: video.parents?.[0] ?? parent,
          ...(token ? { pageToken: token } : {}),
        });
        const page = await json<FilePage>('/api/drive/files?' + p, controller.signal);
        subtitleFiles.push(...page.files.filter((f) => /\.(srt|vtt)$/i.test(f.name)));
        token = page.nextPageToken;
      } while (token && !controller.signal.aborted);
      if (!controller.signal.aborted) setCandidates(matchSubtitles(video.name, subtitleFiles));
    })().catch((e) => {
      if (!controller.signal.aborted) showError(e);
    });
    return () => controller.abort();
  }, [video, parent, retry]);
  useEffect(() => {
    currentPins.current = readPins(accountId);
    setPins(currentPins.current);
  }, [accountId]);
  function savePins(nextPins: PinnedFolder[]) {
    currentPins.current = nextPins;
    setPins(nextPins);
    try {
      writePins(accountId, nextPins);
      setPinError('');
    } catch {
      setPinError('Pinned folders work for this session, but could not be saved on this browser.');
    }
  }
  function togglePin(file: DriveFile) {
    savePins(
      currentPins.current.some((pin) => pin.id === file.id)
        ? currentPins.current.filter((pin) => pin.id !== file.id)
        : [
            ...currentPins.current,
            { id: file.id, name: file.name, path: [...path, { id: file.id, name: file.name }] },
          ],
    );
  }
  useEffect(() => {
    if (!locationReady) return;
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
  }, [parent, query, retry, locationReady]);
  useEffect(
    () => () => {
      selection.current?.abort();
      listRequest.current?.controller.abort();
      mutation.current?.abort();
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
    currentPath.current = nextPath;
    setPath(nextPath);
    setLocationReady(true);
    setSearch('');
    setQuery('');
    updateLocation({ folder: nextPath.at(-1)!.id, file: undefined, q: undefined });
  }
  function folder(file: DriveFile) {
    navigate([...path, { id: file.id, name: file.name }]);
  }
  async function open(
    idOrLink: string,
    pinned?: PinnedFolder,
    onFailure?: (error: unknown) => void,
  ) {
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
        if (!controller.signal.aborted) {
          if (pinned) {
            const nextPath = pinned.path.map((part) =>
              part.id === file.id ? { id: part.id, name: file.name } : part,
            );
            if (pinned.name !== file.name)
              savePins(
                currentPins.current.map((pin) =>
                  pin.id === file.id ? { ...pin, name: file.name, path: nextPath } : pin,
                ),
              );
            navigate(nextPath);
          } else {
            const nextPath = await folderPath(file.id, controller.signal);
            if (!controller.signal.aborted) navigate(nextPath);
          }
        }
        return;
      }
      checkVideo(file);
      if (controller.signal.aborted) return;
      if (video?.id !== file.id) setCandidates([]);
      setVideo(file);
      updateLocation({ file: file.id });
    } catch (e) {
      if (!controller.signal.aborted) {
        showError(e);
        onFailure?.(e);
      }
    } finally {
      if (selection.current === controller) setOpening(false);
    }
  }
  async function change(file: DriveFile, action: 'rename' | 'delete') {
    if (mutation.current) return;
    let newName: string | undefined;
    if (action === 'rename') {
      const value = window.prompt(`Rename “${file.name}”`, file.name);
      if (value === null || value.trim() === file.name) return;
      newName = value.trim();
      if (!newName || newName.length > 255 || /[\u0000-\u001f\u007f]/.test(newName)) {
        setError('Enter a name between 1 and 255 characters without control characters.');
        return;
      }
    } else if (
      !window.confirm(
        file.mimeType === folderType
          ? `Move “${file.name}” and all its contents to Google Drive Trash? You can restore them in Drive.`
          : `Move “${file.name}” to Google Drive Trash? You can restore it in Drive.`,
      )
    )
      return;
    const controller = new AbortController();
    mutation.current = controller;
    setBusy(true);
    setError('');
    selection.current?.abort();
    setOpening(false);
    try {
      const updated = await json<DriveFile>(
        '/api/drive/files/' + encodeURIComponent(file.id),
        controller.signal,
        {
          method: action === 'rename' ? 'PATCH' : 'DELETE',
          ...(action === 'rename'
            ? {
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newName }),
              }
            : {}),
        },
      );
      if (controller.signal.aborted) return;
      for (const folderId of new Set([parent, ...(file.parents ?? []), ...(updated.parents ?? [])]))
        folderVideoCache.invalidate(folderId);
      if (file.mimeType === folderType) folderVideoCache.invalidate(file.id);
      listRequest.current?.controller.abort();
      selection.current?.abort();
      setOpening(false);
      ++sequence.current;
      setFiles((old) =>
        action === 'delete'
          ? old.filter((f) => f.id !== file.id)
          : old.map((f) => (f.id === file.id ? updated : f)),
      );
      if (action === 'delete') setCandidates((old) => old.filter((c) => c.file.id !== file.id));
      const selectedFileId = new URLSearchParams(window.location.search).get('file');
      if (
        action === 'delete' &&
        (selectedFileId === file.id ||
          (selectedFileId === video?.id && video?.parents?.includes(file.id)))
      )
        updateLocation({ file: undefined });
      setVideo((old) =>
        action === 'delete' && (old?.id === file.id || old?.parents?.includes(file.id))
          ? null
          : old?.id === file.id
            ? updated
            : old,
      );
      const deletedIndex = currentPath.current.findIndex((part) => part.id === file.id);
      if (action === 'delete' && deletedIndex > 0)
        navigate(currentPath.current.slice(0, deletedIndex));
      else
        setPath((old) =>
          old.map((part) => (part.id === file.id ? { ...part, name: updated.name } : part)),
        );
      if (currentPins.current.some((pin) => pin.path.some((part) => part.id === file.id)))
        savePins(
          action === 'delete'
            ? currentPins.current.filter((pin) => !pin.path.some((part) => part.id === file.id))
            : currentPins.current.map((pin) => ({
                ...pin,
                name: pin.id === file.id ? updated.name : pin.name,
                path: pin.path.map((part) =>
                  part.id === file.id ? { ...part, name: updated.name } : part,
                ),
              })),
        );
      setRetry((n) => n + 1);
    } catch (e) {
      if (!controller.signal.aborted) showError(e);
    } finally {
      if (!controller.signal.aborted) {
        mutation.current = null;
        setBusy(false);
      }
    }
  }
  const visible = files;
  const videos = visible.filter((f) => f.mimeType.startsWith('video/')).length;
  const sidebar =
    sidebarOpen && locationReady ? (
      <FolderVideoSidebar
        key={`${parent}:${retry}`}
        folderId={parent}
        folderName={path.at(-1)!.name}
        selectedId={video?.id}
        busy={busy || opening}
        cache={folderVideoCache}
        onPlay={(id, onFailure) => void open(id, undefined, onFailure)}
        onClose={() => setSidebarOpen(false)}
      />
    ) : null;
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link
          className="brand"
          href="/"
          onClick={(e) => {
            if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
              e.preventDefault();
              navigate(rootPath);
            }
          }}
        >
          <Image
            className="brand-icon"
            src="/brand/cloud-play.png"
            alt=""
            width={32}
            height={32}
            loading="eager"
          />
          <span>Drive Cinema</span>
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
              <button
                className="text-button"
                onClick={() => {
                  if (locationReady) setRetry((n) => n + 1);
                  else setRestoreRetry((n) => n + 1);
                }}
              >
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
            sidebar={sidebar}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={() => setSidebarOpen((value) => !value)}
            onClose={() => {
              selection.current?.abort();
              setVideo(null);
              setOpening(false);
              updateLocation({ file: undefined });
            }}
          />
        )}
        {pinError && (
          <p className="error-message" role="alert">
            {pinError}
          </p>
        )}
        {pins.length > 0 && (
          <section className="collection-panel pinned-panel" aria-label="Pinned folders">
            <div className="section-label">
              <span>PINNED FOLDERS</span>
              <span>Quick access</span>
            </div>
            <FileBrowser
              view={view}
              files={pins.map((pin) => ({ id: pin.id, name: pin.name, mimeType: folderType }))}
              onFolder={(file) =>
                void open(
                  file.id,
                  pins.find((pin) => pin.id === file.id),
                )
              }
              onVideo={() => {}}
              onPin={togglePin}
              pinnedIds={pins.map((pin) => pin.id)}
              busy={busy}
            />
          </section>
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
                updateLocation({ q: search.trim() });
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
            <div className="collection-display">
              <span>
                {videos} video{videos === 1 ? '' : 's'}
              </span>
              <div className="view-toggle" role="group" aria-label="Collection view">
                <button
                  type="button"
                  aria-label="List view"
                  aria-pressed={view === 'list'}
                  onClick={() => chooseView('list')}
                >
                  List
                </button>
                <button
                  type="button"
                  aria-label="Grid view"
                  aria-pressed={view === 'grid'}
                  onClick={() => chooseView('grid')}
                >
                  Grid
                </button>
              </div>
            </div>
          </div>
          <FileBrowser
            view={view}
            files={visible}
            onFolder={folder}
            onVideo={(f) => void open(f.id)}
            onRename={(f) => void change(f, 'rename')}
            onDelete={(f) => void change(f, 'delete')}
            onPin={togglePin}
            pinnedIds={pins.map((pin) => pin.id)}
            busy={busy || loading}
          />
          {busy && (
            <p className="loading" role="status">
              Updating your Drive…
            </p>
          )}
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
                  : 'Upload files, open a folder with videos, or paste a Drive link below.'}
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
      {!video && sidebar}
      <UploadControl
        parent={parent}
        folderName={path.at(-1)!.name}
        disabled={!locationReady || busy}
        onComplete={(_file, destination) => {
          folderVideoCache.invalidate(destination);
          if (
            currentPath.current.at(-1)!.id === destination ||
            video?.parents?.includes(destination)
          )
            setRetry((value) => value + 1);
        }}
      />
    </div>
  );
}
