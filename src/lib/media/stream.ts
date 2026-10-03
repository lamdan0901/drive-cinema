import 'server-only';
import { NextResponse } from 'next/server';
import { requireSession, setSession } from '@/lib/auth/session';
import { authorizedFetch } from '@/lib/auth/tokens';
import { getFile, parseFileId } from '@/lib/drive/files';
import { checkDrive } from '@/lib/drive/client';
import { validateRange } from './range';
import { ApiError, errorResponse } from '@/lib/errors';
export async function streamVideo(request: Request, id: string): Promise<NextResponse> {
  try {
    const initial = await requireSession(request);
    const fileId = parseFileId(id);
    const range = validateRange(request.headers.get('range'));
    const meta = await getFile(initial, fileId);
    if (!meta.file.mimeType.startsWith('video/'))
      throw new ApiError(415, 'UNSUPPORTED_FILE', 'Choose a video file.');
    if (meta.file.capabilities?.canDownload !== true)
      throw new ApiError(
        403,
        'DOWNLOAD_DISABLED',
        'This file does not allow downloads or direct playback.',
      );
    if (request.method === 'HEAD') {
      const headers = new Headers({
        'Content-Type': meta.file.mimeType,
        'Cache-Control': 'private, no-store',
      });
      if (meta.file.size) headers.set('Content-Length', meta.file.size);
      const r = new NextResponse(null, { headers });
      if (meta.changed) await setSession(r, meta.session);
      return r;
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.signal.addEventListener('abort', abort, { once: true });
    if (request.signal.aborted) controller.abort();
    const headers = new Headers({ 'Accept-Encoding': 'identity' });
    if (range) headers.set('Range', range);
    for (const name of ['If-Range', 'If-None-Match', 'If-Modified-Since']) {
      const v = request.headers.get(name);
      if (v) headers.set(name, v);
    }
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
    let result;
    try {
      result = await authorizedFetch(meta.session, url, { headers, signal: controller.signal });
    } catch (e) {
      request.signal.removeEventListener('abort', abort);
      throw e;
    }
    const upstream = result.response;
    if (![200, 206, 304, 416].includes(upstream.status)) {
      await upstream.body?.cancel();
      request.signal.removeEventListener('abort', abort);
      checkDrive(upstream);
    }
    const responseHeaders = new Headers({
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    for (const name of [
      'Content-Range',
      'Content-Length',
      'Content-Type',
      'ETag',
      'Last-Modified',
      'Accept-Ranges',
    ]) {
      const v = upstream.headers.get(name);
      if (v) responseHeaders.set(name, v);
    }
    if (
      upstream.headers.get('Content-Encoding') &&
      upstream.headers.get('Content-Encoding') !== 'identity'
    )
      responseHeaders.delete('Content-Length');
    if (!responseHeaders.has('Content-Type'))
      responseHeaders.set('Content-Type', meta.file.mimeType);
    const reader = upstream.body?.getReader();
    const cleanup = () => request.signal.removeEventListener('abort', abort);
    const body =
      reader && upstream.status !== 304
        ? new ReadableStream<Uint8Array>({
            async pull(c) {
              try {
                const chunk = await reader.read();
                if (chunk.done) {
                  cleanup();
                  c.close();
                } else c.enqueue(chunk.value);
              } catch (e) {
                cleanup();
                c.error(e);
              }
            },
            async cancel(reason) {
              controller.abort();
              cleanup();
              await reader.cancel(reason);
            },
          })
        : null;
    if (!body) {
      cleanup();
      await reader?.cancel();
    }
    const response = new NextResponse(body, { status: upstream.status, headers: responseHeaders });
    if (meta.changed || result.changed) await setSession(response, result.session);
    return response;
  } catch (e) {
    return errorResponse(e);
  }
}
