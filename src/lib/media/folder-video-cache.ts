import type { DriveFile, FilePage } from '@/lib/types';

const CACHE_DURATION_MS = 60 * 60 * 1000;

// Owned by the library instance so private folder data stays within its page session.
export function createFolderVideoCache() {
  const entries = new Map<string, { files: DriveFile[]; expiresAt: number }>();
  return {
    invalidate(folderId: string) {
      entries.delete(folderId);
    },
    async load(folderId: string, signal: AbortSignal): Promise<DriveFile[]> {
      signal.throwIfAborted();
      const cached = entries.get(folderId);
      if (cached && cached.expiresAt > Date.now()) return cached.files;

      // Identity guards prevent an invalidated in-flight load from caching stale data.
      const entry = { files: [] as DriveFile[], expiresAt: 0 };
      entries.set(folderId, entry);
      const videos = new Map<string, DriveFile>();
      let token: string | undefined;
      do {
        const params = new URLSearchParams({
          parent: folderId,
          ...(token ? { pageToken: token } : {}),
        });
        const response = await fetch('/api/drive/files?' + params, {
          signal,
          cache: 'no-store',
        });
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error ?? 'Could not load folder videos.');
        }
        const page: FilePage = await response.json();
        signal.throwIfAborted();
        for (const file of page.files)
          if (file.mimeType.startsWith('video/')) videos.set(file.id, file);
        token = page.nextPageToken;
      } while (token);

      const files = [...videos.values()];
      if (entries.get(folderId) === entry) {
        entry.files = files;
        entry.expiresAt = Date.now() + CACHE_DURATION_MS;
      }
      return files;
    },
  };
}

export type FolderVideoCache = ReturnType<typeof createFolderVideoCache>;
