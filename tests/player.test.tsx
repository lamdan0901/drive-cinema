// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { VideoPlayer } from '@/components/video-player';
const video = { id: 'movie', name: 'Movie.mp4', mimeType: 'video/mp4' };
const candidates = [
  {
    file: { id: 'vi', name: 'Movie.vi.srt', mimeType: 'text/plain' },
    language: 'vi',
    matched: true,
  },
];
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHi')),
  );
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:subtitle');
      static revokeObjectURL = vi.fn();
    },
  );
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('restores position only when metadata is ready', () => {
  localStorage.setItem(
    'drive-cinema:movie',
    JSON.stringify({ time: 12, offset: 0, subtitleId: 'off' }),
  );
  const { container } = render(
    <VideoPlayer video={video} subtitleCandidates={[]} onClose={() => {}} />,
  );
  const el = container.querySelector('video')!;
  Object.defineProperty(el, 'duration', { value: 100 });
  expect(el.currentTime).toBe(0);
  fireEvent.loadedMetadata(el);
  expect(el.currentTime).toBe(12);
});
it('switches subtitles off and revokes its object URL', async () => {
  render(<VideoPlayer video={video} subtitleCandidates={candidates} onClose={() => {}} />);
  await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
  fireEvent.change(screen.getByLabelText('Subtitle track'), { target: { value: 'off' } });
  await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:subtitle'));
});
it('offset rebuilds cues from original timestamps', async () => {
  const { container } = render(
    <VideoPlayer video={video} subtitleCandidates={candidates} onClose={() => {}} />,
  );
  await waitFor(() => expect(container.querySelector('track')).not.toBeNull());
  fireEvent.change(screen.getByLabelText('Subtitle offset in seconds'), {
    target: { value: '-2' },
  });
  await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(2));
  expect(screen.getByText(/Earlier by 2/)).toBeInTheDocument();
});
it('keeps local subtitle upload in the browser', async () => {
  render(<VideoPlayer video={video} subtitleCandidates={[]} onClose={() => {}} />);
  const file = new File(['1\n00:00:01,000 --> 00:00:03,000\nLocal'], 'local.srt', {
    type: 'text/plain',
  });
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => new TextEncoder().encode('1\n00:00:01,000 --> 00:00:03,000\nLocal').buffer,
  });
  fireEvent.change(screen.getByLabelText('Attach subtitle file'), { target: { files: [file] } });
  await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
  expect(fetch).not.toHaveBeenCalled();
});
it('releases subtitle URL on unmount', async () => {
  const { unmount } = render(
    <VideoPlayer video={video} subtitleCandidates={candidates} onClose={() => {}} />,
  );
  await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalled();
});
it('throttles resume writes and keeps saving after replay', () => {
  const { container } = render(
    <VideoPlayer video={video} subtitleCandidates={[]} onClose={() => {}} />,
  );
  const el = container.querySelector('video')!;
  Object.defineProperty(el, 'duration', { value: 100 });
  fireEvent.loadedMetadata(el);
  const now = vi.spyOn(Date, 'now').mockReturnValue(10000);
  el.currentTime = 10;
  fireEvent.timeUpdate(el);
  expect(JSON.parse(localStorage.getItem('drive-cinema:movie')!).time).toBe(10);
  now.mockReturnValue(11000);
  el.currentTime = 11;
  fireEvent.timeUpdate(el);
  expect(JSON.parse(localStorage.getItem('drive-cinema:movie')!).time).toBe(10);
  fireEvent.ended(el);
  expect(JSON.parse(localStorage.getItem('drive-cinema:movie')!).time).toBe(0);
  fireEvent.play(el);
  now.mockReturnValue(15000);
  el.currentTime = 5;
  fireEvent.timeUpdate(el);
  expect(JSON.parse(localStorage.getItem('drive-cinema:movie')!).time).toBe(5);
});
it('keyboard seeks only when the player has focus', () => {
  const { container } = render(
    <VideoPlayer video={video} subtitleCandidates={[]} onClose={() => {}} />,
  );
  const el = container.querySelector('video')!;
  Object.defineProperty(el, 'duration', { value: 100 });
  el.currentTime = 10;
  fireEvent.keyDown(el, { key: 'ArrowRight' });
  expect(el.currentTime).toBe(15);
  fireEvent.keyDown(screen.getByLabelText('Subtitle offset in seconds'), { key: 'ArrowLeft' });
  expect(el.currentTime).toBe(15);
});
it('rejects oversized local subtitles before reading', async () => {
  render(<VideoPlayer video={video} subtitleCandidates={[]} onClose={() => {}} />);
  const f = new File(['a'], 'large.srt');
  Object.defineProperty(f, 'size', { value: 2097153 });
  fireEvent.change(screen.getByLabelText('Attach subtitle file'), { target: { files: [f] } });
  expect(await screen.findByRole('alert')).toHaveTextContent('2 MiB');
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
