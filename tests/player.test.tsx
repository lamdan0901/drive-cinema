// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { webcrypto } from 'node:crypto';
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
  vi.stubGlobal('crypto', webcrypto);
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
it('adjusts subtitle delay by 50 ms with buttons and resets it', () => {
  const { el } = readyPlayer();
  el.currentTime = 20;
  const offset = screen.getByLabelText('Subtitle offset in seconds');
  fireEvent.click(screen.getByRole('button', { name: 'Subtitles earlier' }));
  expect(offset).toHaveValue(-0.05);
  fireEvent.click(screen.getByRole('button', { name: 'Subtitles later' }));
  fireEvent.click(screen.getByRole('button', { name: 'Subtitles later' }));
  expect(offset).toHaveValue(0.05);
  expect(JSON.parse(localStorage.getItem('drive-cinema:movie')!).offset).toBe(0.05);
  fireEvent.click(screen.getByRole('button', { name: 'Reset subtitle delay' }));
  expect(offset).toHaveValue(0);
  expect(JSON.parse(localStorage.getItem('drive-cinema:movie')!).offset).toBe(0);
  expect(el.currentTime).toBe(20);
});
it('G/H rebuild subtitle timestamps immediately without seeking or fetching again', async () => {
  vi.stubGlobal('Blob', NodeBlob);
  const { container } = render(
    <VideoPlayer video={video} subtitleCandidates={candidates} onClose={() => {}} />,
  );
  const el = container.querySelector('video')!;
  el.currentTime = 20;
  await waitFor(() => expect(container.querySelector('track')).not.toBeNull());
  fireEvent.keyDown(el, { key: 'h' });
  const shifted = vi.mocked(URL.createObjectURL).mock.calls.at(-1)![0] as NodeBlob;
  expect(await shifted.text()).toContain('00:00:01.050 --> 00:00:03.050');
  fireEvent.keyDown(window, { key: 'G' });
  const restored = vi.mocked(URL.createObjectURL).mock.calls.at(-1)![0] as NodeBlob;
  expect(await restored.text()).toContain('00:00:01.000 --> 00:00:03.000');
  expect(fetch).toHaveBeenCalledOnce();
  expect(el.currentTime).toBe(20);
});
it('reveals subtitle delay feedback inside fullscreen when controls are hidden', () => {
  vi.useFakeTimers();
  const { el, container } = readyPlayer();
  const stage = container.querySelector('.media-player')!;
  Object.defineProperty(window.document, 'fullscreenElement', { configurable: true, value: stage });
  fireEvent(window.document, new Event('fullscreenchange'));
  fireEvent.play(el);
  act(() => vi.advanceTimersByTime(2500));
  expect(stage).not.toHaveClass('media-player--controls-visible');
  fireEvent.keyDown(window, { key: 'h' });
  expect(stage).toHaveClass('media-player--controls-visible');
  const feedback = screen.getByRole('status', { name: 'Subtitle delay' });
  expect(stage).toContainElement(feedback);
  expect(feedback).toHaveTextContent('+50 ms');
  fireEvent.keyDown(screen.getByRole('button', { name: 'Exit fullscreen' }), { key: 'G' });
  fireEvent.keyDown(window, { key: 'g' });
  expect(feedback).toHaveTextContent('-50 ms');
});
it('ignores subtitle shortcuts while editing, composing, using modifiers, or already handled', () => {
  readyPlayer();
  const offset = screen.getByLabelText('Subtitle offset in seconds');
  for (const key of ['g', 'h']) {
    fireEvent.keyDown(offset, { key });
    fireEvent.keyDown(screen.getByLabelText('Subtitle track'), { key });
    for (const modifier of ['ctrlKey', 'altKey', 'metaKey', 'isComposing'])
      fireEvent.keyDown(window, { key, [modifier]: true });
    const event = new KeyboardEvent('keydown', { key, cancelable: true });
    event.preventDefault();
    fireEvent(window, event);
  }
  expect(offset).toHaveValue(0);
  fireEvent.keyDown(window, { key: 'h' });
  expect(offset).toHaveValue(0.05);
});
it('allows held subtitle keys without floating point drift and restores the saved delay', async () => {
  localStorage.setItem(
    'drive-cinema:movie',
    JSON.stringify({ time: 0, offset: 0.1, subtitleId: 'vi' }),
  );
  const { unmount } = readyPlayer();
  for (let i = 0; i < 20; i++) fireEvent.keyDown(window, { key: 'h', repeat: i > 0 });
  expect(screen.getByLabelText('Subtitle offset in seconds')).toHaveValue(1.1);
  unmount();
  render(<VideoPlayer video={video} subtitleCandidates={candidates} onClose={() => {}} />);
  expect(screen.getByLabelText('Subtitle offset in seconds')).toHaveValue(1.1);
  await waitFor(() => expect(screen.getByLabelText('Subtitle track')).toHaveValue('vi'));
});
it.each([
  { initial: 86399.98, key: 'h', expected: 86400 },
  { initial: -86399.98, key: 'g', expected: -86400 },
])('clamps subtitle adjustments at the supported limit ($key)', ({ initial, key, expected }) => {
  readyPlayer();
  const offset = screen.getByLabelText('Subtitle offset in seconds');
  fireEvent.change(offset, { target: { value: String(initial) } });
  fireEvent.keyDown(window, { key });
  fireEvent.keyDown(window, { key, repeat: true });
  expect(offset).toHaveValue(expected);
  expect(JSON.parse(localStorage.getItem('drive-cinema:movie')!).offset).toBe(expected);
});
it('saves a different delay for each video-subtitle pair before video metadata arrives', async () => {
  const tracks = [
    ...candidates,
    {
      file: { id: 'en', name: 'Movie.en.srt', mimeType: 'text/plain' },
      language: 'en',
      matched: false,
    },
  ];
  const view = render(<VideoPlayer video={video} subtitleCandidates={tracks} onClose={() => {}} />);
  const select = screen.getByLabelText('Subtitle track');
  const offset = screen.getByLabelText('Subtitle offset in seconds');
  await waitFor(() => expect(select).toHaveValue('vi'));
  fireEvent.change(offset, { target: { value: '-1.25' } });
  fireEvent.change(select, { target: { value: 'en' } });
  expect(offset).toHaveValue(0);
  fireEvent.change(offset, { target: { value: '2.5' } });
  fireEvent.change(select, { target: { value: 'off' } });
  fireEvent.change(select, { target: { value: 'vi' } });
  expect(offset).toHaveValue(-1.25);
  fireEvent.change(select, { target: { value: 'en' } });
  expect(offset).toHaveValue(2.5);
  view.unmount();
  const other = render(
    <VideoPlayer
      video={{ ...video, id: 'other-movie' }}
      subtitleCandidates={tracks}
      onClose={() => {}}
    />,
  );
  await waitFor(() => expect(screen.getByLabelText('Subtitle track')).toHaveValue('vi'));
  expect(screen.getByLabelText('Subtitle offset in seconds')).toHaveValue(0);
  fireEvent.change(screen.getByLabelText('Subtitle offset in seconds'), { target: { value: '3' } });
  other.unmount();
  render(<VideoPlayer video={video} subtitleCandidates={tracks} onClose={() => {}} />);
  await waitFor(() => expect(screen.getByLabelText('Subtitle track')).toHaveValue('vi'));
  expect(screen.getByLabelText('Subtitle offset in seconds')).toHaveValue(-1.25);
  fireEvent.change(screen.getByLabelText('Subtitle track'), { target: { value: 'en' } });
  expect(screen.getByLabelText('Subtitle offset in seconds')).toHaveValue(2.5);
});
it('restores local subtitle delays by content, including files with the same name', async () => {
  vi.stubGlobal('Blob', NodeBlob);
  const attach = async (text: string) => {
    const file = new File([text], 'local.srt', { type: 'text/plain' });
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => new TextEncoder().encode(text).buffer,
    });
    const previousLoads = vi.mocked(URL.createObjectURL).mock.calls.length;
    fireEvent.change(screen.getByLabelText('Attach subtitle file'), { target: { files: [file] } });
    await waitFor(async () => {
      expect(vi.mocked(URL.createObjectURL).mock.calls.length).toBeGreaterThan(previousLoads);
      const loaded = vi.mocked(URL.createObjectURL).mock.calls.at(-1)![0] as NodeBlob;
      expect(await loaded.text()).toContain(text.split('\n').at(-1)!);
    });
  };
  const first = '1\n00:00:01,000 --> 00:00:03,000\nFirst';
  const second = '1\n00:00:01,000 --> 00:00:03,000\nOther';
  const view = render(<VideoPlayer video={video} subtitleCandidates={[]} onClose={() => {}} />);
  await attach(first);
  fireEvent.change(screen.getByLabelText('Subtitle offset in seconds'), {
    target: { value: '-0.5' },
  });
  await attach(second);
  expect(screen.getByLabelText('Subtitle offset in seconds')).toHaveValue(0);
  fireEvent.change(screen.getByLabelText('Subtitle offset in seconds'), {
    target: { value: '1.5' },
  });
  view.unmount();
  render(<VideoPlayer video={video} subtitleCandidates={[]} onClose={() => {}} />);
  await attach(first);
  expect(screen.getByLabelText('Subtitle offset in seconds')).toHaveValue(-0.5);
  await attach(second);
  expect(screen.getByLabelText('Subtitle offset in seconds')).toHaveValue(1.5);
  expect(fetch).not.toHaveBeenCalled();
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
it('keyboard seeks across the page and on focused controls exactly once', () => {
  const { el } = readyPlayer();
  el.currentTime = 10;
  fireEvent.keyDown(document.body, { key: 'ArrowRight' });
  expect(el.currentTime).toBe(15);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Close video' }), { key: 'ArrowLeft' });
  expect(el.currentTime).toBe(10);
  fireEvent.keyDown(el, { key: 'ArrowRight' });
  expect(el.currentTime).toBe(15);
  fireEvent.keyDown(screen.getByRole('slider', { name: 'Seek' }), { key: 'ArrowRight' });
  expect(el.currentTime).toBe(20);
  fireEvent.keyDown(screen.getByLabelText('Subtitle offset in seconds'), { key: 'ArrowLeft' });
  expect(el.currentTime).toBe(20);
});
it('J/L seek ten seconds, repeat while held, and clamp to the video bounds', () => {
  const { el } = readyPlayer();
  el.currentTime = 30;
  fireEvent.keyDown(window, { key: 'l' });
  expect(el.currentTime).toBe(40);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Fullscreen' }), { key: 'J' });
  expect(el.currentTime).toBe(30);
  fireEvent.keyDown(window, { key: 'L', repeat: true });
  expect(el.currentTime).toBe(40);
  el.currentTime = 117;
  fireEvent.keyDown(window, { key: 'l' });
  expect(el.currentTime).toBe(120);
  el.currentTime = 3;
  fireEvent.keyDown(window, { key: 'j' });
  expect(el.currentTime).toBe(0);
  expect(screen.getByRole('slider', { name: 'Seek' })).toHaveAttribute('aria-valuenow', '0');
});
it.each(['page', 'button', 'seek', 'volume'])(
  'Up/Down adjust volume by 20 percent from $0',
  (focus) => {
    const { el } = readyPlayer();
    const target =
      focus === 'page'
        ? document.body
        : focus === 'button'
          ? screen.getByRole('button', { name: 'Fullscreen' })
          : screen.getByRole('slider', { name: focus === 'seek' ? 'Seek' : 'Volume' });
    el.currentTime = 30;
    el.volume = 0.5;
    fireEvent.volumeChange(el);
    fireEvent.keyDown(target, { key: 'ArrowUp' });
    expect(el.volume).toBeCloseTo(0.7);
    expect(screen.getByRole('slider', { name: 'Volume' })).toHaveValue('0.7');
    fireEvent.keyDown(target, { key: 'ArrowDown' });
    expect(el.volume).toBeCloseTo(0.5);
    expect(el.currentTime).toBe(30);
  },
);
it('volume shortcuts clamp at zero and one and restore audible volume from mute', () => {
  const { el } = readyPlayer();
  fireEvent.keyDown(window, { key: 'ArrowUp' });
  expect(el.volume).toBe(1);
  el.volume = 0.1;
  fireEvent.keyDown(window, { key: 'ArrowDown' });
  expect(el.volume).toBe(0);
  el.muted = true;
  fireEvent.keyDown(window, { key: 'ArrowUp', repeat: true });
  expect(el.volume).toBe(0.2);
  expect(el.muted).toBe(false);
});
it('M toggles mute across the page and preserves volume without repeating while held', () => {
  const { el } = readyPlayer();
  el.volume = 0.6;
  fireEvent.volumeChange(el);
  fireEvent.keyDown(document.body, { key: 'm' });
  expect(el.muted).toBe(true);
  expect(el.volume).toBe(0.6);
  expect(screen.getByRole('button', { name: 'Unmute' })).toBeInTheDocument();
  fireEvent.keyDown(window, { key: 'm', repeat: true });
  expect(el.muted).toBe(true);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Fullscreen' }), { key: 'M' });
  expect(el.muted).toBe(false);
  expect(el.volume).toBe(0.6);
  expect(screen.getByRole('button', { name: 'Mute' })).toBeInTheDocument();
  expect(screen.getByRole('slider', { name: 'Volume' })).toHaveValue('0.6');
});
it('M restores audible volume from zero like the unmute button', () => {
  const { el } = readyPlayer();
  el.volume = 0;
  fireEvent.volumeChange(el);
  fireEvent.keyDown(screen.getByRole('slider', { name: 'Volume' }), { key: 'm' });
  expect(el.volume).toBe(1);
  expect(el.muted).toBe(false);
  expect(screen.getByRole('slider', { name: 'Volume' })).toHaveValue('1');
});
it('Space/K toggle playback across the page without also activating a focused button', () => {
  const { el } = readyPlayer();
  const play = vi.spyOn(el, 'play').mockResolvedValue();
  const pause = vi.spyOn(el, 'pause').mockImplementation(() => {});
  const button = screen.getByRole('button', { name: 'Expand to full width' });
  expect(fireEvent.keyDown(button, { key: ' ' })).toBe(false);
  expect(play).toHaveBeenCalledOnce();
  Object.defineProperty(el, 'paused', { configurable: true, value: false });
  fireEvent.keyDown(document.body, { key: 'K' });
  expect(pause).toHaveBeenCalledOnce();
  fireEvent.keyDown(window, { key: 'k', repeat: true });
  expect(pause).toHaveBeenCalledOnce();
});
it('ignores playback shortcuts while editing, composing, modified, or already handled', () => {
  const { el } = readyPlayer();
  const play = vi.spyOn(el, 'play').mockResolvedValue();
  el.currentTime = 30;
  el.volume = 0.5;
  for (const key of [' ', 'k', 'j', 'l', 'm', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
    fireEvent.keyDown(screen.getByLabelText('Subtitle offset in seconds'), { key });
    fireEvent.keyDown(screen.getByLabelText('Subtitle track'), { key });
    for (const modifier of ['ctrlKey', 'altKey', 'metaKey', 'isComposing'])
      fireEvent.keyDown(el, { key, [modifier]: true });
    const event = new KeyboardEvent('keydown', { key, cancelable: true });
    event.preventDefault();
    fireEvent(window, event);
  }
  expect(el.currentTime).toBe(30);
  expect(el.volume).toBe(0.5);
  expect(el.muted).toBe(false);
  expect(play).not.toHaveBeenCalled();
});
it('releases page shortcuts when the player is closed', () => {
  const { el, unmount } = readyPlayer();
  const play = vi.spyOn(el, 'play').mockResolvedValue();
  el.currentTime = 30;
  unmount();
  for (const key of [' ', 'l', 'm', 'ArrowDown', 'f', 't', 'h'])
    expect(fireEvent.keyDown(window, { key })).toBe(true);
  expect(el.currentTime).toBe(30);
  expect(el.volume).toBe(1);
  expect(play).not.toHaveBeenCalled();
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
