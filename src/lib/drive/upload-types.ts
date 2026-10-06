import type { DriveFile } from '@/lib/types';

// Keep each request below common hosting body limits and aligned to Drive's 256 KiB chunks.
export const UPLOAD_CHUNK_SIZE = 4 * 1024 * 1024;
export type UploadProgress = { done: false; nextOffset: number } | { done: true; file: DriveFile };
