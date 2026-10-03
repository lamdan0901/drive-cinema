'use client';
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
}: {
  files: DriveFile[];
  onFolder: (f: DriveFile) => void;
  onVideo: (f: DriveFile) => void;
}) {
  return (
    <div className="file-list">
      {files.map((file) => {
        const folder = file.mimeType === 'application/vnd.google-apps.folder';
        return (
          <button
            className="file-row"
            key={file.id}
            aria-label={`${folder ? 'Open folder' : 'Play'} ${file.name}`}
            onClick={() => (folder ? onFolder(file) : onVideo(file))}
          >
            <span className={`file-icon ${folder ? 'folder-icon' : ''}`} aria-hidden>
              {folder ? '▰' : '▶'}
            </span>
            <span className="file-name">
              <strong>{file.name}</strong>
              <span>
                {folder ? 'Folder' : file.mimeType.replace('video/', '').toUpperCase() + ' video'}
              </span>
            </span>
            <span className="file-size">{folder ? '' : formatSize(file.size)}</span>
            <span className="row-action" aria-hidden>
              {folder ? '↗' : 'Play ↗'}
            </span>
          </button>
        );
      })}
    </div>
  );
}
