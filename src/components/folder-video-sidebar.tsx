'use client';

import { FileVideo, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { DriveFile } from '@/lib/types';
import type { FolderVideoCache } from '@/lib/media/folder-video-cache';

type Contents =
  | { status: 'loading' }
  | { status: 'ready'; files: DriveFile[] }
  | { status: 'error'; message: string };

export function FolderVideoSidebar({
  folderId,
  folderName,
  selectedId,
  busy,
  cache,
  onPlay,
  onClose,
}: {
  folderId: string;
  folderName: string;
  selectedId?: string;
  busy: boolean;
  cache: FolderVideoCache;
  onPlay: (id: string, onFailure: (error: unknown) => void) => void;
  onClose: () => void;
}) {
  const [contents, setContents] = useState<Contents>({ status: 'loading' });
  const [retry, setRetry] = useState(0);
  const [selectionError, setSelectionError] = useState<{
    message: string;
    needsSignIn: boolean;
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const files = await cache.load(folderId, controller.signal);
        if (!controller.signal.aborted) setContents({ status: 'ready', files });
      } catch (error) {
        if (!controller.signal.aborted)
          setContents({
            status: 'error',
            message: error instanceof Error ? error.message : 'Could not load folder videos.',
          });
      }
    })();
    return () => controller.abort();
  }, [folderId, retry, cache]);

  return (
    <aside id="folder-video-sidebar" className="folder-video-sidebar" aria-label="Folder videos">
      <div className="folder-video-sidebar-heading">
        <div>
          <span className="eyebrow">FOLDER VIDEOS</span>
          <h2>{folderName}</h2>
        </div>
        <button
          type="button"
          className="text-button"
          aria-label="Close folder videos"
          title="Close folder videos (P)"
          onClick={onClose}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      <div className="folder-video-sidebar-content" aria-busy={contents.status === 'loading'}>
        {selectionError && (
          <p className="error-message" role="alert">
            {selectionError.message}{' '}
            {selectionError.needsSignIn && (
              <a className="inline-link" href="/api/auth/login">
                Sign in again
              </a>
            )}
          </p>
        )}
        {contents.status === 'loading' && (
          <p className="loading" role="status">
            Loading folder videos…
          </p>
        )}
        {contents.status === 'error' && (
          <>
            <p className="error-message" role="alert">
              {contents.message}
            </p>
            <button
              type="button"
              className="button"
              aria-label="Retry folder videos"
              onClick={() => {
                setContents({ status: 'loading' });
                setRetry((value) => value + 1);
              }}
            >
              Retry
            </button>
          </>
        )}
        {contents.status === 'ready' &&
          (contents.files.length ? (
            <ul>
              {contents.files.map((file) => (
                <li key={file.id}>
                  <button
                    type="button"
                    className="folder-video-sidebar-item"
                    aria-label={`Play ${file.name}`}
                    aria-current={file.id === selectedId ? 'true' : undefined}
                    disabled={busy || file.capabilities?.canDownload === false}
                    onClick={() => {
                      setSelectionError(null);
                      onPlay(file.id, (error) => {
                        const status = (error as { status?: number })?.status;
                        setSelectionError({
                          message:
                            error instanceof Error ? error.message : 'Could not open this video.',
                          needsSignIn: status === 401 || status === 403,
                        });
                      });
                    }}
                  >
                    <FileVideo size={20} aria-hidden="true" />
                    <span>{file.name}</span>
                    {file.id === selectedId && <small>Now playing</small>}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No videos in this folder.</p>
          ))}
      </div>
      <p className="folder-video-sidebar-hint">P to show or hide · Select a video to play</p>
    </aside>
  );
}
