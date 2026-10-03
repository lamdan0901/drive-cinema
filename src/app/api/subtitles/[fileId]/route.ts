import { NextResponse } from 'next/server';
import { requireSession, setSession } from '@/lib/auth/session';
import { authorizedFetch } from '@/lib/auth/tokens';
import { getFile, parseFileId } from '@/lib/drive/files';
import { checkDrive } from '@/lib/drive/client';
import { readBounded } from '@/lib/drive/download';
import { parseSubtitles } from '@/lib/subtitles/parse';
import { serializeVtt } from '@/lib/subtitles/serialize';
import { decodeSubtitle, SUBTITLE_LIMIT } from '@/lib/subtitles/decode';
import { errorResponse, ApiError } from '@/lib/errors';
export const runtime = 'nodejs';
export async function GET(request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  try {
    const id = parseFileId((await params).fileId);
    const original = await requireSession(request);
    const meta = await getFile(original, id);
    if (!/\.(srt|vtt)$/i.test(meta.file.name))
      throw new ApiError(415, 'INVALID_SUBTITLE', 'Choose an SRT or VTT subtitle file.');
    if (meta.file.capabilities?.canDownload !== true)
      throw new ApiError(403, 'DOWNLOAD_DISABLED', 'This subtitle does not allow downloads.');
    if (Number(meta.file.size) > SUBTITLE_LIMIT)
      throw new ApiError(413, 'SUBTITLE_TOO_LARGE', 'Subtitle files must be 2 MiB or smaller.');
    const result = await authorizedFetch(
      meta.session,
      new URL(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`),
      { signal: AbortSignal.timeout(20000) },
    );
    checkDrive(result.response);
    const bytes = await readBounded(result.response, SUBTITLE_LIMIT);
    let vtt: string;
    try {
      vtt = serializeVtt(parseSubtitles(decodeSubtitle(bytes, 'utf-8')));
    } catch (e) {
      throw new ApiError(
        422,
        'INVALID_SUBTITLE',
        e instanceof Error ? e.message : 'Invalid subtitle.',
      );
    }
    const r = new NextResponse(vtt, {
      headers: {
        'Content-Type': 'text/vtt; charset=utf-8',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
    if (meta.changed || result.changed) await setSession(r, result.session);
    return r;
  } catch (e) {
    return errorResponse(e);
  }
}
