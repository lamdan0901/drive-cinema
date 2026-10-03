import { streamVideo } from '@/lib/media/stream';
export const runtime = 'nodejs';
export async function GET(request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  return streamVideo(request, (await params).fileId);
}
export const HEAD = GET;
