// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Library } from '@/components/library';

const movie = {
  id: 'movie',
  name: 'First.mp4',
  mimeType: 'video/mp4',
  capabilities: { canDownload: true },
};
const second = { ...movie, id: 'second', name: 'Second.mp4' };
const folder = { id: 'folder', name: 'Movies', mimeType: 'application/vnd.google-apps.folder' };

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, 'fullscreenElement');
});

it('reuses the complete cached folder list until one hour, then fetches it again', async () => {
  mockFolder();
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
  render(<Library accountId="viewer" />);
  await screen.findByRole('button', { name: 'Play First.mp4' });
  fireEvent.keyDown(window, { key: 'p' });
  const sidebar = () => within(screen.getByRole('complementary', { name: 'Folder videos' }));
  await sidebar().findByRole('button', { name: 'Play Second.mp4' });
  fireEvent.keyDown(window, { key: 'p' });
  const requests = vi.mocked(fetch).mock.calls.length;
  now.mockReturnValue(1_000_000 + 3_600_000 - 1);
  fireEvent.keyDown(window, { key: 'p' });
  await sidebar().findByRole('button', { name: 'Play Second.mp4' });
  expect(fetch).toHaveBeenCalledTimes(requests);
  fireEvent.keyDown(window, { key: 'p' });
  now.mockReturnValue(1_000_000 + 3_600_000);
  fireEvent.keyDown(window, { key: 'p' });
  await sidebar().findByRole('button', { name: 'Play Second.mp4' });
  expect(fetch).toHaveBeenCalledTimes(requests + 2);
});

it('invalidates the cached list after successful rename and deletion, including while hidden', async () => {
  mockFolder();
  let files = [{ ...movie, capabilities: { canDownload: true, canRename: true, canTrash: true } }];
  vi.mocked(fetch).mockImplementation(async (_input, init) => {
    if (init?.method === 'PATCH') {
      files = [{ ...files[0], name: 'Renamed.mp4' }];
      return Response.json(files[0]);
    }
    if (init?.method === 'DELETE') {
      files = [];
      return Response.json({ id: movie.id });
    }
    return Response.json({ files });
  });
  vi.spyOn(window, 'prompt').mockReturnValue('Renamed.mp4');
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<Library accountId="viewer" />);
  await screen.findByRole('button', { name: 'Rename First.mp4' });
  fireEvent.keyDown(window, { key: 'p' });
  const sidebar = () => within(screen.getByRole('complementary', { name: 'Folder videos' }));
  await sidebar().findByRole('button', { name: 'Play First.mp4' });
  fireEvent.click(screen.getByRole('button', { name: 'Rename First.mp4' }));
  await waitFor(() =>
    expect(sidebar().getByRole('button', { name: 'Play Renamed.mp4' })).toBeInTheDocument(),
  );
  expect(sidebar().queryByRole('button', { name: 'Play First.mp4' })).not.toBeInTheDocument();
  fireEvent.keyDown(window, { key: 'p' });
  fireEvent.click(await screen.findByRole('button', { name: 'Delete Renamed.mp4' }));
  await screen.findByText('Nothing here yet');
  fireEvent.keyDown(window, { key: 'p' });
  expect(await sidebar().findByText('No videos in this folder.')).toBeInTheDocument();
});

it('uses a player overlay button and P to toggle the same sidebar state in fullscreen', async () => {
  mockFolder();
  const { container } = render(<Library accountId="viewer" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Play First.mp4' }));
  await screen.findByRole('region', { name: 'Video player' });
  const toggle = screen.getByRole('button', { name: 'Toggle folder videos' });
  const stage = container.querySelector('.media-player')!;
  expect(stage).toContainElement(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(toggle);
  await screen.findByRole('complementary', { name: 'Folder videos' });
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  fireEvent.keyDown(toggle, { key: 'p' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: stage });
  fireEvent(document, new Event('fullscreenchange'));
  fireEvent.click(toggle);
  expect(stage).toContainElement(
    await screen.findByRole('complementary', { name: 'Folder videos' }),
  );
  fireEvent.click(toggle);
  expect(screen.queryByRole('complementary', { name: 'Folder videos' })).not.toBeInTheDocument();
});

function mockFolder() {
  window.history.replaceState(null, '', '/');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input, window.location.origin);
      if (url.pathname === '/api/drive/files/movie') return Response.json(movie);
      if (url.pathname === '/api/drive/files/second') return Response.json(second);
      if (url.searchParams.get('parent') === 'folder') return Response.json({ files: [second] });
      if (url.searchParams.has('q')) return Response.json({ files: [movie] });
      return Response.json(
        url.searchParams.has('pageToken')
          ? { files: [second] }
          : {
              files: [movie, folder, { id: 'sub', name: 'Other.srt', mimeType: 'text/plain' }],
              nextPageToken: 'more',
            },
      );
    }),
  );
}

it('P toggles the full current-folder video list and a row selects a video', async () => {
  mockFolder();
  const { container } = render(<Library accountId="viewer" />);
  await screen.findByRole('button', { name: 'Play First.mp4' });
  expect(screen.queryByRole('complementary', { name: 'Folder videos' })).not.toBeInTheDocument();
  fireEvent.keyDown(window, { key: 'p' });
  const panel = within(await screen.findByRole('complementary', { name: 'Folder videos' }));
  await panel.findByRole('button', { name: 'Play Second.mp4' });
  expect(panel.getAllByRole('button', { name: /^Play / })).toHaveLength(2);
  expect(panel.queryByText('Other.srt')).not.toBeInTheDocument();
  expect(panel.queryByRole('button', { name: 'Open folder Movies' })).not.toBeInTheDocument();
  fireEvent.click(panel.getByRole('button', { name: 'Play Second.mp4' }));
  await waitFor(() =>
    expect(container.querySelector('video')).toHaveAttribute('src', '/api/video/second'),
  );
  await waitFor(() =>
    expect(
      within(screen.getByRole('complementary', { name: 'Folder videos' })).getByRole('button', {
        name: 'Play Second.mp4',
      }),
    ).toHaveAttribute('aria-current', 'true'),
  );
  expect(container.querySelector('.media-player')).toContainElement(
    screen.getByRole('complementary', { name: 'Folder videos' }),
  );
  fireEvent.keyDown(screen.getByRole('button', { name: 'Close folder videos' }), { key: 'P' });
  expect(screen.queryByRole('complementary', { name: 'Folder videos' })).not.toBeInTheDocument();
});

it('ignores P while typing and with modifiers, repeated keys, or composition', async () => {
  mockFolder();
  render(<Library accountId="viewer" />);
  await screen.findByRole('button', { name: 'Play First.mp4' });
  fireEvent.keyDown(screen.getByLabelText('Search this folder'), { key: 'p' });
  fireEvent.keyDown(screen.getByLabelText('Google Drive link or file ID'), { key: 'P' });
  for (const modifier of ['ctrlKey', 'altKey', 'metaKey', 'repeat', 'isComposing'])
    fireEvent.keyDown(window, { key: 'p', [modifier]: true });
  expect(screen.queryByRole('complementary', { name: 'Folder videos' })).not.toBeInTheDocument();
  fireEvent.keyDown(window, { key: 'P' });
  fireEvent.click(await screen.findByRole('button', { name: 'Close folder videos' }));
  expect(screen.queryByRole('complementary', { name: 'Folder videos' })).not.toBeInTheDocument();
});

it('lists all folder videos independently of the collection search and follows folder navigation', async () => {
  mockFolder();
  render(<Library accountId="viewer" />);
  await screen.findByRole('button', { name: 'Play First.mp4' });
  fireEvent.change(screen.getByLabelText('Search this folder'), { target: { value: 'First' } });
  fireEvent.submit(screen.getByRole('search'));
  await screen.findByText('Results for “First”');
  fireEvent.keyDown(window, { key: 'p' });
  const panel = within(await screen.findByRole('complementary', { name: 'Folder videos' }));
  await panel.findByRole('button', { name: 'Play Second.mp4' });
  fireEvent.click(screen.getByRole('button', { name: 'My Drive' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Open folder Movies' }));
  await waitFor(() => {
    const current = within(screen.getByRole('complementary', { name: 'Folder videos' }));
    expect(current.getByRole('button', { name: 'Play Second.mp4' })).toBeInTheDocument();
    expect(current.queryByRole('button', { name: 'Play First.mp4' })).not.toBeInTheDocument();
    expect(current.getByRole('heading', { name: 'Movies' })).toBeInTheDocument();
  });
});

it('shows folder-list errors and supports retry without disturbing the collection', async () => {
  mockFolder();
  render(<Library accountId="viewer" />);
  await screen.findByRole('button', { name: 'Play First.mp4' });
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({ error: 'Folder unavailable' }, { status: 403 }),
  );
  fireEvent.keyDown(window, { key: 'p' });
  const panel = within(await screen.findByRole('complementary', { name: 'Folder videos' }));
  expect(await panel.findByRole('alert')).toHaveTextContent('Folder unavailable');
  fireEvent.click(panel.getByRole('button', { name: 'Retry folder videos' }));
  expect(await panel.findByRole('button', { name: 'Play Second.mp4' })).toBeInTheDocument();
});

it('shows failed selections and renewed sign-in inside the fullscreen sidebar', async () => {
  mockFolder();
  const { container } = render(<Library accountId="viewer" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Play First.mp4' }));
  await screen.findByRole('region', { name: 'Video player' });
  const stage = container.querySelector('.media-player')!;
  Object.defineProperty(stage, 'requestFullscreen', {
    value: vi.fn(async () => {
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: stage });
      fireEvent(document, new Event('fullscreenchange'));
    }),
  });
  fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }));
  await waitFor(() => expect(stage).toHaveClass('media-player--fullscreen'));
  fireEvent.keyDown(window, { key: 'p' });
  const panel = within(await screen.findByRole('complementary', { name: 'Folder videos' }));
  const nextVideo = await panel.findByRole('button', { name: 'Play Second.mp4' });
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({ error: 'Sign in again to access this video.' }, { status: 403 }),
  );
  fireEvent.click(nextVideo);
  expect(await panel.findByRole('alert')).toHaveTextContent('Sign in again to access this video.');
  expect(panel.getByRole('link', { name: 'Sign in again' })).toHaveAttribute(
    'href',
    '/api/auth/login',
  );
  expect(container.querySelector('video')).toHaveAttribute('src', '/api/video/movie');
  expect(stage).toHaveClass('media-player--fullscreen');
});
