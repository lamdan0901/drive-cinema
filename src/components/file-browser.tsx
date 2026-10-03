'use client';
import {
  ArrowUpRight,
  File,
  FileVideo,
  Folder,
  Pin,
  PinOff,
  SquarePen,
  Trash2,
} from 'lucide-react';
import type { DriveFile } from '@/lib/types';
export function formatSize(bytes?: string): string {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return n >= 1024 ** 3
    ? (n / 1024 ** 3).toFixed(1) + ' GB'
    : n >= 1024 ** 2
      ? (n / 1024 ** 2).toFixed(0) + ' MB'
      : Math.ceil(n / 1024) + ' KB';
}
export function FileBrowser({
  files,
  onFolder,
  onVideo,
  onRename,
  onDelete,
  onPin,
  pinnedIds = [],
  busy = false,
  view = 'list',
}: {
  files: DriveFile[];
  onFolder: (f: DriveFile) => void;
  onVideo: (f: DriveFile) => void;
  onRename?: (f: DriveFile) => void;
  onDelete?: (f: DriveFile) => void;
  onPin: (f: DriveFile) => void;
  pinnedIds?: string[];
  busy?: boolean;
  view?: 'list' | 'grid';
}) {
  return (
    <div className={`file-list${view === 'grid' ? ' file-grid' : ''}`}>
      {files.map((file) => {
        const folder = file.mimeType === 'application/vnd.google-apps.folder';
        const video = file.mimeType.startsWith('video/');
        const pinned = pinnedIds.includes(file.id);
        const OpenElement = folder || video ? 'button' : 'a';
        return (
          <div className="file-row" key={file.id}>
            <OpenElement
              className="file-open"
              aria-label={`${folder ? 'Open folder' : video ? 'Play' : 'Open file'} ${file.name}`}
              onClick={folder ? () => onFolder(file) : video ? () => onVideo(file) : undefined}
              href={
                !folder && !video
                  ? `https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view`
                  : undefined
              }
              target={!folder && !video ? '_blank' : undefined}
              rel={!folder && !video ? 'noopener noreferrer' : undefined}
            >
              <span className={`file-icon ${folder ? 'folder-icon' : ''}`} aria-hidden>
                {folder ? <Folder /> : video ? <FileVideo /> : <File />}
              </span>
              <span className="file-name">
                <strong>{file.name}</strong>
                <span>
                  {folder
                    ? 'Folder'
                    : video
                      ? file.mimeType.replace('video/', '').toUpperCase() + ' video'
                      : 'File'}
                </span>
              </span>
              <span className="file-size">{folder ? '' : formatSize(file.size)}</span>
              <span className="row-action" aria-hidden>
                <ArrowUpRight size={18} />
              </span>
            </OpenElement>
            <div className="file-actions">
              {folder && (
                <button
                  className="text-button icon-button"
                  aria-label={`${pinned ? 'Unpin' : 'Pin'} ${file.name}`}
                  title={pinned ? 'Unpin' : 'Pin'}
                  aria-pressed={pinned}
                  disabled={busy}
                  onClick={() => onPin(file)}
                >
                  {pinned ? (
                    <PinOff size={18} aria-hidden="true" />
                  ) : (
                    <Pin size={18} aria-hidden="true" />
                  )}
                </button>
              )}
              {onRename && (
                <button
                  className="text-button icon-button"
                  aria-label={`Rename ${file.name}`}
                  title="Rename"
                  disabled={busy || file.capabilities?.canRename !== true}
                  onClick={() => onRename(file)}
                >
                  <SquarePen size={18} aria-hidden="true" />
                </button>
              )}
              {onDelete && (
                <button
                  className="text-button icon-button delete-button"
                  aria-label={`Delete ${file.name}`}
                  title="Delete"
                  disabled={busy || file.capabilities?.canTrash !== true}
                  onClick={() => onDelete(file)}
                >
                  <Trash2 size={18} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
