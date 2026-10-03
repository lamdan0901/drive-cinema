import 'server-only';
import { ApiError } from '@/lib/errors';
export function checkDrive(response: Response): void {
  if (response.ok) return;
  const status =
    response.status === 404
      ? 404
      : response.status === 429
        ? 429
        : response.status === 403
          ? 403
          : 502;
  throw new ApiError(
    status,
    'DRIVE_ERROR',
    status === 404
      ? 'This file could not be found in your Google Drive.'
      : 'Google Drive could not provide this file. Check permissions or try again later.',
  );
}
