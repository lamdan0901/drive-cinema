// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
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
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
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
  vi.useRealTimers();
  Reflect.deleteProperty(window.document, 'exitFullscreen');
  Reflect.deleteProperty(window.document, 'fullscreenElement');
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
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
it('switches a removed Drive subtitle off and releases its track', async () => {
  const view = render(
    <VideoPlayer video={video} subtitleCandidates={candidates} onClose={() => {}} />,
  );
  await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
  expect(screen.getByLabelText('Subtitle track')).toHaveValue('vi');
  view.rerender(<VideoPlayer video={video} subtitleCandidates={[]} onClose={() => {}} />);
  await waitFor(() => expect(screen.getByLabelText('Subtitle track')).toHaveValue('off'));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:subtitle');
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

function readyPlayer() {
  const view = render(<VideoPlayer video={video} subtitleCandidates={[]} onClose={() => {}} />);
  const el = view.container.querySelector('video')!;
  Object.defineProperty(el, 'duration', { configurable: true, value: 120 });
  fireEvent.loadedMetadata(el);
  return { ...view, el };
}

it('uses custom controls to play, pause, seek, and adjust volume', async () => {
  const { el } = readyPlayer();
  expect(el).not.toHaveAttribute('controls');
  const play = vi.spyOn(el, 'play').mockResolvedValue();
  const pause = vi.spyOn(el, 'pause').mockImplementation(() => {});
  fireEvent.click(screen.getByRole('button', { name: 'Play' }));
  expect(play).toHaveBeenCalledOnce();
  fireEvent.play(el);
  Object.defineProperty(el, 'paused', { configurable: true, value: false });
  fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
  expect(pause).toHaveBeenCalledOnce();
  const seek = screen.getByRole('slider', { name: 'Seek' });
  fireEvent.keyDown(seek, { key: 'ArrowRight' });
  expect(el.currentTime).toBe(5);
  fireEvent.keyDown(seek, { key: 'End' });
  expect(el.currentTime).toBe(120);
  fireEvent.keyDown(seek, { key: 'ArrowRight' });
  expect(el.currentTime).toBe(120);
  fireEvent.keyDown(seek, { key: 'Home' });
  expect(el.currentTime).toBe(0);
  fireEvent.change(screen.getByRole('slider', { name: 'Volume' }), { target: { value: '0.4' } });
  expect(el.volume).toBe(0.4);
  fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
  expect(el.muted).toBe(true);
  fireEvent.volumeChange(el);
  fireEvent.change(screen.getByRole('slider', { name: 'Volume' }), { target: { value: '0.6' } });
  expect(el.volume).toBe(0.6);
  expect(el.muted).toBe(false);
});

it('shows playback time and buffer progress and disables seeking before metadata', () => {
  const { container } = render(
    <VideoPlayer video={video} subtitleCandidates={[]} onClose={() => {}} />,
  );
  const el = container.querySelector('video')!;
  expect(screen.getByRole('slider', { name: 'Seek' })).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByText('0:00 / 0:00')).toBeInTheDocument();
  Object.defineProperty(el, 'duration', { value: 120 });
  Object.defineProperty(el, 'buffered', { value: { length: 1, end: () => 90 } });
  el.currentTime = 30;
  fireEvent.loadedMetadata(el);
  fireEvent.timeUpdate(el);
  expect(screen.getByText('0:30 / 2:00')).toBeInTheDocument();
  expect(screen.getByRole('slider', { name: 'Seek' })).toHaveAttribute('aria-valuenow', '30');
  expect(container.querySelector('.media-player-progress-buffer')).toHaveStyle({ width: '75%' });
});

it('expands to page width and returns to normal without replacing the video', () => {
  const { el, container } = readyPlayer();
  el.currentTime = 42;
  const panel = screen.getByRole('region', { name: 'Video player' });
  expect(panel).not.toHaveClass('player-panel--expanded');
  fireEvent.click(screen.getByRole('button', { name: 'Expand to full width' }));
  expect(panel).toHaveClass('player-panel--expanded');
  fireEvent.click(screen.getByRole('button', { name: 'Normal view' }));
  expect(panel).not.toHaveClass('player-panel--expanded');
  expect(container.querySelector('video')).toBe(el);
  expect(el.currentTime).toBe(42);
});

it('centers the expanded video after layout changes and scrolls to the page top in normal mode', () => {
  const { el } = readyPlayer();
  const scroll = vi.mocked(el.scrollIntoView);
  expect(scroll).not.toHaveBeenCalled();
  expect(window.scrollTo).not.toHaveBeenCalled();
  scroll.mockImplementation(() => {
    expect(screen.getByRole('region', { name: 'Video player' })).toHaveClass(
      'player-panel--expanded',
    );
  });
  fireEvent.click(screen.getByRole('button', { name: 'Expand to full width' }));
  expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
  fireEvent.click(screen.getByRole('button', { name: 'Normal view' }));
  expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  expect(scroll).toHaveBeenCalledOnce();
});

it('fullscreens the video with its controls and restores expanded view after Escape', async () => {
  const { el, container } = readyPlayer();
  const stage = container.querySelector('.media-player')!;
  let fullscreenElement: Element | null = null;
  Object.defineProperty(window.document, 'fullscreenElement', {
    configurable: true,
    get: () => fullscreenElement,
  });
  const request = vi.fn(async () => {
    fullscreenElement = stage;
    fireEvent(window.document, new Event('fullscreenchange'));
  });
  Object.defineProperty(stage, 'requestFullscreen', { configurable: true, value: request });
  const exit = vi.fn(async () => {
    fullscreenElement = null;
    fireEvent(window.document, new Event('fullscreenchange'));
  });
  Object.defineProperty(window.document, 'exitFullscreen', { configurable: true, value: exit });
  fireEvent.click(screen.getByRole('button', { name: 'Expand to full width' }));
  el.currentTime = 42;
  fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }));
  await waitFor(() => expect(stage).toHaveClass('media-player--fullscreen'));
  expect(request).toHaveBeenCalledOnce();
  expect(stage).toContainElement(screen.getByRole('button', { name: 'Exit fullscreen' }));
  fireEvent.click(screen.getByRole('button', { name: 'Exit fullscreen' }));
  await waitFor(() => expect(stage).not.toHaveClass('media-player--fullscreen'));
  expect(exit).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }));
  await waitFor(() => expect(stage).toHaveClass('media-player--fullscreen'));
  // The browser sends fullscreenchange when Escape exits fullscreen.
  fullscreenElement = null;
  fireEvent(window.document, new Event('fullscreenchange'));
  expect(stage).not.toHaveClass('media-player--fullscreen');
  expect(screen.getByRole('region', { name: 'Video player' })).toHaveClass(
    'player-panel--expanded',
  );
  expect(container.querySelector('video')).toBe(el);
  expect(el.currentTime).toBe(42);
  Reflect.deleteProperty(window.document, 'exitFullscreen');
  Reflect.deleteProperty(window.document, 'fullscreenElement');
});

it('F toggles fullscreen and T changes the page view while preserving the video', async () => {
  const { container } = render(
    <VideoPlayer video={video} subtitleCandidates={[]} onClose={() => {}} />,
  );
  const stage = container.querySelector('.media-player')!;
  const el = container.querySelector('video')!;
  const panel = screen.getByRole('region', { name: 'Video player' });
  let full: Element | null = null;
  Object.defineProperty(window.document, 'fullscreenElement', {
    configurable: true,
    get: () => full,
  });
  const request = vi.fn(async () => {
    full = stage;
    fireEvent(window.document, new Event('fullscreenchange'));
  });
  Object.defineProperty(stage, 'requestFullscreen', { value: request });
  const exit = vi.fn(async () => {
    full = null;
    fireEvent(window.document, new Event('fullscreenchange'));
  });
  Object.defineProperty(window.document, 'exitFullscreen', { configurable: true, value: exit });
  el.currentTime = 12;
  fireEvent.keyDown(window, { key: 'f' });
  await waitFor(() => expect(stage).toHaveClass('media-player--fullscreen'));
  fireEvent.keyDown(window, { key: 'F' });
  await waitFor(() => expect(stage).not.toHaveClass('media-player--fullscreen'));
  expect(request).toHaveBeenCalledTimes(1);
  expect(exit).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(window, { key: 't' });
  expect(panel).toHaveClass('player-panel--expanded');
  expect(el.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
  fireEvent.keyDown(window, { key: 'f' });
  await waitFor(() => expect(stage).toHaveClass('media-player--fullscreen'));
  fireEvent.keyDown(window, { key: 'T' });
  await waitFor(() => expect(stage).not.toHaveClass('media-player--fullscreen'));
  expect(panel).not.toHaveClass('player-panel--expanded');
  expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  expect(container.querySelector('video')).toBe(el);
  expect(el.currentTime).toBe(12);
});

it('ignores view keys while typing, composing, repeating, using modifiers, or already handled', () => {
  const { container } = render(
    <VideoPlayer video={video} subtitleCandidates={[]} onClose={() => {}} />,
  );
  const stage = container.querySelector('.media-player')!;
  const request = vi.fn(async () => {});
  Object.defineProperty(stage, 'requestFullscreen', { value: request });
  const input = screen.getByLabelText('Subtitle offset in seconds');
  for (const key of ['f', 't']) {
    fireEvent.keyDown(input, { key });
    for (const modifier of ['ctrlKey', 'altKey', 'metaKey', 'repeat', 'isComposing'])
      fireEvent.keyDown(window, { key, [modifier]: true });
    const event = new KeyboardEvent('keydown', { key, cancelable: true });
    event.preventDefault();
    fireEvent(window, event);
  }
  expect(request).not.toHaveBeenCalled();
  expect(screen.getByRole('region', { name: 'Video player' })).not.toHaveClass(
    'player-panel--expanded',
  );
  fireEvent.keyDown(screen.getByRole('button', { name: 'Fullscreen' }), { key: 't' });
  expect(screen.getByRole('region', { name: 'Video player' })).toHaveClass(
    'player-panel--expanded',
  );
});

it('keeps fullscreen and the page view unchanged if T cannot exit fullscreen', async () => {
  const { container } = render(
    <VideoPlayer video={video} subtitleCandidates={[]} onClose={() => {}} />,
  );
  const stage = container.querySelector('.media-player')!;
  Object.defineProperty(window.document, 'fullscreenElement', { configurable: true, value: stage });
  Object.defineProperty(window.document, 'exitFullscreen', {
    configurable: true,
    value: vi.fn().mockRejectedValue(new Error('Denied')),
  });
  fireEvent(window.document, new Event('fullscreenchange'));
  fireEvent.keyDown(window, { key: 't' });
  expect(await screen.findByRole('alert')).toHaveTextContent('Fullscreen could not close');
  expect(stage).toHaveClass('media-player--fullscreen');
  expect(screen.getByRole('region', { name: 'Video player' })).not.toHaveClass(
    'player-panel--expanded',
  );
});

it('reports rejected playback and fullscreen requests', async () => {
  const { el, container } = readyPlayer();
  vi.spyOn(el, 'play').mockRejectedValue(new Error('blocked'));
  fireEvent.click(screen.getByRole('button', { name: 'Play' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Playback could not start');
  const stage = container.querySelector('.media-player')!;
  Object.defineProperty(stage, 'requestFullscreen', {
    value: vi.fn().mockRejectedValue(new Error('denied')),
  });
  fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Fullscreen could not start'),
  );
  expect(stage).not.toHaveClass('media-player--fullscreen');
});

it('auto-hides controls during playback, reveals on interaction, and stays visible on pause or end', () => {
  vi.useFakeTimers();
  const { el, container } = readyPlayer();
  const stage = container.querySelector('.media-player')!;
  fireEvent.play(el);
  act(() => vi.advanceTimersByTime(2500));
  expect(stage).not.toHaveClass('media-player--controls-visible');
  fireEvent.pointerMove(stage);
  expect(stage).toHaveClass('media-player--controls-visible');
  act(() => vi.advanceTimersByTime(2500));
  fireEvent.pause(el);
  expect(stage).toHaveClass('media-player--controls-visible');
  fireEvent.play(el);
  act(() => vi.advanceTimersByTime(2500));
  fireEvent.ended(el);
  expect(stage).toHaveClass('media-player--controls-visible');
  expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
});

it('keeps controls visible while using the keyboard', () => {
  vi.useFakeTimers();
  const { el, container } = readyPlayer();
  const stage = container.querySelector('.media-player')!;
  fireEvent.play(el);
  const volume = screen.getByRole('slider', { name: 'Volume' });
  // jsdom has no input-modality tracking for the browser's :focus-visible selector.
  vi.spyOn(volume, 'matches').mockReturnValue(true);
  act(() => volume.focus());
  act(() => vi.advanceTimersByTime(3000));
  expect(stage).toHaveClass('media-player--controls-visible');
});

it('auto-hides after pointer playback even if the clicked button remains focused', () => {
  vi.useFakeTimers();
  const { el, container } = readyPlayer();
  const playButton = screen.getByRole('button', { name: 'Play' });
  // Mouse-focused buttons do not match :focus-visible in the browser.
  vi.spyOn(playButton, 'matches').mockReturnValue(false);
  act(() => playButton.focus());
  fireEvent.play(el);
  act(() => vi.advanceTimersByTime(2500));
  expect(container.querySelector('.media-player')).not.toHaveClass(
    'media-player--controls-visible',
  );
});

it('supports pointer seek previews, dragging, and cancellation', () => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  const { el, container } = readyPlayer();
  const seek = screen.getByRole('slider', { name: 'Seek' });
  vi.spyOn(seek, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    width: 200,
    top: 0,
    right: 200,
    bottom: 24,
    height: 24,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  Object.defineProperty(seek, 'setPointerCapture', { value: vi.fn() });
  Object.defineProperty(seek, 'hasPointerCapture', { value: () => true });
  Object.defineProperty(seek, 'releasePointerCapture', { value: vi.fn() });
  fireEvent.pointerMove(seek, { clientX: 50 });
  expect(screen.getByText('0:30')).toBeInTheDocument();
  fireEvent.pointerDown(seek, { clientX: 150, pointerId: 1 });
  expect(el.currentTime).toBe(90);
  fireEvent.pointerMove(seek, { clientX: 250, pointerId: 1 });
  expect(el.currentTime).toBe(120);
  fireEvent.pointerCancel(seek, { pointerId: 1 });
  fireEvent.pointerMove(seek, { clientX: 50 });
  expect(el.currentTime).toBe(120);
  fireEvent.pointerLeave(seek);
  expect(container.querySelector('.media-player-progress-tooltip')).not.toBeInTheDocument();
});
