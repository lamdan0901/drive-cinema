'use client';

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Check, FileUp, List, Upload, X } from 'lucide-react';
import { uploadFile, UploadError } from '@/lib/drive/upload-client';
import type { DriveFile } from '@/lib/types';
import './upload-control.css';

type Status = 'queued' | 'uploading' | 'complete' | 'failed' | 'cancelled';
interface UploadItem {
  id: number;
  file: File;
  parent: string;
  folderName: string;
  status: Status;
  received: number;
  ticket?: string;
  error?: string;
  needsSignIn?: boolean;
}

function size(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function UploadControl({
  parent,
  folderName,
  disabled,
  onComplete,
}: {
  parent: string;
  folderName: string;
  disabled: boolean;
  onComplete: (file: DriveFile, parent: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [items, setItems] = useState<UploadItem[]>([]);
  const queue = useRef<UploadItem[]>([]);
  const running = useRef<{ id: number; controller: AbortController } | null>(null);
  const mounted = useRef(true);
  const nextId = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const completed = useRef(onComplete);
  useEffect(() => {
    completed.current = onComplete;
  }, [onComplete]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      running.current?.controller.abort();
    };
  }, []);
  const active = items.filter(
    (item) => item.status === 'queued' || item.status === 'uploading',
  ).length;
  useEffect(() => {
    if (!active) return;
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [active]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);

  function update(id: number, patch: Partial<UploadItem>) {
    queue.current = queue.current.map((item) => (item.id === id ? { ...item, ...patch } : item));
    if (mounted.current) setItems(queue.current);
  }
  async function pump() {
    if (running.current || !mounted.current) return;
    const item = queue.current.find((entry) => entry.status === 'queued');
    if (!item) return;
    const controller = new AbortController();
    running.current = { id: item.id, controller };
    update(item.id, { status: 'uploading', error: undefined, needsSignIn: false });
    try {
      const file = await uploadFile(item.file, item.parent, {
        signal: controller.signal,
        ticket: item.ticket,
        onTicket: (ticket) => update(item.id, { ticket }),
        onProgress: (received) => update(item.id, { received }),
      });
      // A completed response wins a last-moment cancel, since the file is already in Drive.
      update(item.id, { status: 'complete', received: item.file.size, ticket: undefined });
      if (mounted.current) completed.current(file, item.parent);
    } catch (error) {
      update(item.id, {
        status: controller.signal.aborted ? 'cancelled' : 'failed',
        error: controller.signal.aborted
          ? undefined
          : error instanceof Error
            ? error.message
            : 'Could not upload this file. Retry to continue.',
        needsSignIn:
          error instanceof UploadError &&
          (error.status === 401 || error.code === 'UPLOAD_SCOPE_REQUIRED'),
      });
    } finally {
      running.current = null;
      void pump();
    }
  }
  function add(files: FileList | File[]) {
    if (disabled || !files.length) return;
    queue.current = [
      ...queue.current,
      ...Array.from(files).map((file) => ({
        id: ++nextId.current,
        file,
        parent,
        folderName,
        status: 'queued' as const,
        received: 0,
      })),
    ];
    setItems(queue.current);
    setOpen(true);
    void pump();
  }
  function cancel(id: number) {
    if (running.current?.id === id) running.current.controller.abort();
    else update(id, { status: 'cancelled' });
  }

  const receiveDrop = useEffectEvent((event: DragEvent) => {
    if (event.dataTransfer?.files.length) add(event.dataTransfer.files);
  });
  useEffect(() => {
    // Track entry/exit across descendants so the overlay doesn't flicker over child elements.
    let depth = 0;
    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files');
    const reset = () => {
      depth = 0;
      setDragging(false);
    };
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      ++depth;
      setDragging(true);
    };
    const over = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const drop = (event: DragEvent) => {
      reset();
      if (event.defaultPrevented || (!hasFiles(event) && !event.dataTransfer?.files.length)) return;
      event.preventDefault();
      receiveDrop(event);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') reset();
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    window.addEventListener('dragend', reset);
    window.addEventListener('blur', reset);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
      window.removeEventListener('dragend', reset);
      window.removeEventListener('blur', reset);
      window.removeEventListener('keydown', escape);
    };
  }, [disabled]);

  return (
    <>
      {dragging && (
        <div className="upload-overlay" role="status" aria-label="Drop files to upload">
          <div className="upload-overlay-content">
            <Upload size={40} aria-hidden="true" />
            <h2>{disabled ? 'Uploads are temporarily unavailable' : 'Drop files to upload'}</h2>
            <p>
              {disabled ? (
                'Try again in a moment.'
              ) : (
                <>
                  Upload to <strong>{folderName}</strong>
                </>
              )}
            </p>
          </div>
        </div>
      )}
      <aside className="upload-control" aria-label="Drive uploads">
        <input
          ref={input}
          type="file"
          multiple
          hidden
          disabled={disabled}
          aria-label="Choose files to upload"
          onChange={(event) => {
            if (event.target.files) add(event.target.files);
            event.target.value = '';
          }}
        />
        {open && items.length > 0 && (
          <section id="upload-panel" className="upload-panel" aria-label="Upload files">
            <div className="upload-heading">
              <div>
                <h2>Upload files</h2>
              </div>
              <button
                type="button"
                className="text-button upload-close"
                aria-label="Hide uploads"
                onClick={() => {
                  setOpen(false);
                  toggle.current?.focus();
                }}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            {items.length > 0 && (
              <ul className="upload-queue" aria-label="Upload queue">
                {items.map((item) => {
                  const percent =
                    item.status === 'complete'
                      ? 100
                      : item.file.size > 0
                        ? Math.min(99, Math.floor((item.received / item.file.size) * 100))
                        : 0;
                  const inProgress = item.status === 'uploading' || item.status === 'queued';
                  return (
                    <li key={item.id} className="upload-item">
                      <div className="upload-item-heading">
                        {item.status === 'complete' ? (
                          <Check size={17} className="upload-check" aria-hidden="true" />
                        ) : (
                          <FileUp size={17} aria-hidden="true" />
                        )}
                        <span className="upload-filename" title={item.file.name}>
                          {item.file.name}
                        </span>
                        {inProgress ? (
                          <button
                            type="button"
                            className="text-button"
                            aria-label={`Cancel ${item.file.name}`}
                            onClick={() => cancel(item.id)}
                          >
                            Cancel
                          </button>
                        ) : item.status !== 'complete' ? (
                          <button
                            type="button"
                            className="text-button"
                            aria-label={`Retry ${item.file.name}`}
                            onClick={() => {
                              update(item.id, { status: 'queued' });
                              void pump();
                            }}
                          >
                            Retry
                          </button>
                        ) : null}
                      </div>
                      <div className="upload-item-detail">
                        <span title={item.folderName}>
                          {item.folderName} · {size(item.file.size)}
                        </span>
                        <span>
                          {item.status === 'complete'
                            ? 'Uploaded'
                            : item.status === 'cancelled'
                              ? 'Cancelled'
                              : item.status === 'failed'
                                ? 'Failed'
                                : item.status === 'queued'
                                  ? 'Queued'
                                  : `${percent}%`}
                        </span>
                      </div>
                      {item.status === 'uploading' && (
                        <progress
                          max={100}
                          value={percent}
                          aria-label={`Upload progress for ${item.file.name}`}
                        />
                      )}
                      {item.error && (
                        <p className="upload-error" role="alert">
                          {item.error}
                          {item.needsSignIn && (
                            <>
                              {' '}
                              <a className="inline-link" href="/api/auth/login">
                                Sign in again
                              </a>
                            </>
                          )}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="upload-summary">
              <span role="status">
                {active
                  ? `${active} file${active === 1 ? '' : 's'} remaining`
                  : items.length
                    ? 'No uploads running'
                    : 'Select one or more files'}
              </span>
              {items.some((item) => item.status === 'complete' || item.status === 'cancelled') && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    queue.current = queue.current.filter(
                      (item) => item.status !== 'complete' && item.status !== 'cancelled',
                    );
                    setItems(queue.current);
                    if (!queue.current.length) setOpen(false);
                  }}
                >
                  Clear finished
                </button>
              )}
            </div>
          </section>
        )}
        <div className="upload-actions">
          {!open && items.length > 0 && (
            <button
              type="button"
              className="button upload-queue-toggle"
              aria-label="Show uploads"
              title="Show uploads"
              aria-controls="upload-panel"
              onClick={() => setOpen(true)}
            >
              <List size={19} aria-hidden="true" />
            </button>
          )}
          <button
            ref={toggle}
            type="button"
            className="button primary upload-toggle"
            disabled={disabled}
            title={`Upload files to ${folderName}`}
            onClick={() => input.current?.click()}
          >
            <Upload size={19} aria-hidden="true" />
            Upload
            {active > 0 && (
              <span className="upload-count" aria-hidden="true">
                {active}
              </span>
            )}
          </button>
        </div>
      </aside>
    </>
  );
}
