// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Library } from '@/components/library';

const folderType = 'application/vnd.google-apps.folder';
const root = { id: 'drive-root', name: 'My Drive', mimeType: folderType };
const movies = { id: 'movies', name: 'Movies', mimeType: folderType, parents: [root.id] };
const collection = { id: 'collection', name: 'Sci-fi', mimeType: folderType, parents: [movies.id] };
const movie = {
  id: 'movie',
  name: 'Dune.mp4',
  mimeType: 'video/mp4',
  parents: [collection.id],
  capabilities: { canDownload: true, canTrash: true },
};

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input, window.location.origin);
      if (url.pathname === '/api/drive/files') {
        const parent = url.searchParams.get('parent');
        return Response.json({
          files: parent === 'movies' ? [collection] : parent === 'collection' ? [movie] : [movies],
        });
      }
      const files = [root, movies, collection, movie];
      return Response.json(
        url.pathname.endsWith('/root')
          ? root
          : files.find((file) => url.pathname.endsWith('/' + file.id)),
      );
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('writes folder and file navigation to the URL and restores both after reload', async () => {
  let library = render(<Library accountId="viewer" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Open folder Movies' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Open folder Sci-fi' }));
  expect(new URL(window.location.href).searchParams.get('folder')).toBe('collection');
  fireEvent.click(await screen.findByRole('button', { name: 'Play Dune.mp4' }));
  await screen.findByRole('region', { name: 'Video player' });
  expect(new URL(window.location.href).searchParams.get('file')).toBe('movie');
  library.unmount();
  library = render(<Library accountId="viewer" />);
  expect(await screen.findByRole('region', { name: 'Video player' })).toHaveTextContent('Dune');
  expect(document.querySelector('video')).toHaveAttribute('src', '/api/video/movie');
  const breadcrumbs = within(screen.getByRole('navigation', { name: 'Folder breadcrumbs' }));
  expect(breadcrumbs.getAllByRole('button').map((button) => button.textContent)).toEqual([
    'My Drive',
    'Movies',
    'Sci-fi',
  ]);
  expect(breadcrumbs.getByRole('button', { name: 'Sci-fi' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Close video' }));
  expect(new URL(window.location.href).searchParams.get('file')).toBeNull();
  expect(new URL(window.location.href).searchParams.get('folder')).toBe('collection');
  library.unmount();
  render(<Library accountId="viewer" />);
  await screen.findByRole('button', { name: 'Play Dune.mp4' });
  expect(screen.queryByRole('region', { name: 'Video player' })).not.toBeInTheDocument();
});

it('restores folder-only links and searches and lets breadcrumbs return to root', async () => {
  window.history.replaceState(null, '', '/?folder=collection&q=Dune');
  render(<Library accountId="viewer" />);
  await screen.findByRole('button', { name: 'Play Dune.mp4' });
  expect(screen.getByLabelText('Search this folder')).toHaveValue('Dune');
  expect(screen.getByText('Results for “Dune”')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Movies' }));
  await screen.findByRole('button', { name: 'Open folder Sci-fi' });
  expect(window.location.search).toBe('?folder=movies');
  fireEvent.click(screen.getByRole('button', { name: 'My Drive' }));
  await screen.findByRole('button', { name: 'Open folder Movies' });
  expect(window.location.search).toBe('');
});

it('follows browser Back and Forward between a folder and its selected video', async () => {
  window.history.replaceState(null, '', '/?folder=collection');
  render(<Library accountId="viewer" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Play Dune.mp4' }));
  await screen.findByRole('region', { name: 'Video player' });
  act(() => window.history.back());
  await waitFor(() =>
    expect(screen.queryByRole('region', { name: 'Video player' })).not.toBeInTheDocument(),
  );
  expect(window.location.search).toBe('?folder=collection');
  act(() => window.history.forward());
  expect(await screen.findByRole('region', { name: 'Video player' })).toHaveTextContent('Dune');
});

it('updates the URL for submitted searches and pasted Drive links', async () => {
  render(<Library accountId="viewer" />);
  await screen.findByRole('button', { name: 'Open folder Movies' });
  fireEvent.change(screen.getByLabelText('Search this folder'), {
    target: { value: ' Dune & friends ' },
  });
  fireEvent.submit(screen.getByRole('search'));
  expect(new URL(window.location.href).searchParams.get('q')).toBe('Dune & friends');
  fireEvent.change(screen.getByLabelText('Google Drive link or file ID'), {
    target: { value: 'collection' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Open ↗' }));
  await screen.findByRole('button', { name: 'Play Dune.mp4' });
  expect(window.location.search).toBe('?folder=collection');
});

it('shows inaccessible URL items and retries without dropping the requested location', async () => {
  window.history.replaceState(null, '', '/?folder=collection');
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (...args) =>
    args[0] === '/api/drive/files/collection'
      ? Response.json({ error: 'Folder unavailable.' }, { status: 404 })
      : original(...args),
  );
  render(<Library accountId="viewer" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Folder unavailable.');
  expect(window.location.search).toBe('?folder=collection');
  vi.mocked(fetch).mockImplementation(original);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('button', { name: 'Play Dune.mp4' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Sci-fi' })).toHaveAttribute('aria-current', 'page');
});

it('returns to My Drive when the app brand is clicked', async () => {
  window.history.replaceState(null, '', '/?folder=collection&file=movie');
  render(<Library accountId="viewer" />);
  await screen.findByRole('region', { name: 'Video player' });
  fireEvent.click(screen.getByRole('link', { name: 'Drive Cinema' }));
  await screen.findByRole('button', { name: 'Open folder Movies' });
  expect(window.location.search).toBe('');
  expect(screen.queryByRole('region', { name: 'Video player' })).not.toBeInTheDocument();
});

it('restores actual ancestors when a folder shortcut is opened from another folder', async () => {
  window.history.replaceState(null, '', '/?folder=collection');
  render(<Library accountId="viewer" />);
  await screen.findByRole('button', { name: 'Play Dune.mp4' });
  fireEvent.change(screen.getByLabelText('Google Drive link or file ID'), {
    target: { value: 'movies' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Open ↗' }));
  await screen.findByRole('button', { name: 'Open folder Sci-fi' });
  const breadcrumbs = within(screen.getByRole('navigation', { name: 'Folder breadcrumbs' }));
  expect(breadcrumbs.getAllByRole('button').map((button) => button.textContent)).toEqual([
    'My Drive',
    'Movies',
  ]);
  expect(window.location.search).toBe('?folder=movies');
});

it('does not let a delayed location restore override breadcrumb navigation', async () => {
  window.history.replaceState(null, '', '/?folder=collection&file=movie');
  let resolve: (r: Response) => void = () => {};
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (...args) =>
    args[0] === '/api/drive/files/movie'
      ? new Promise<Response>((r) => {
          resolve = r;
        })
      : original(...args),
  );
  render(<Library accountId="viewer" />);
  fireEvent.click(screen.getByRole('button', { name: 'My Drive' }));
  await screen.findByRole('button', { name: 'Open folder Movies' });
  await act(async () => resolve(Response.json(movie)));
  expect(window.location.search).toBe('');
  expect(screen.getByRole('button', { name: 'My Drive' })).toHaveAttribute('aria-current', 'page');
  expect(screen.queryByRole('region', { name: 'Video player' })).not.toBeInTheDocument();
});

it('removes the playing file from the URL when it is deleted', async () => {
  window.history.replaceState(null, '', '/?folder=collection&file=movie');
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.mocked(fetch).mockImplementation(async (...args) =>
    args[1]?.method === 'DELETE' ? Response.json({ ...movie, trashed: true }) : original(...args),
  );
  render(<Library accountId="viewer" />);
  await screen.findByRole('region', { name: 'Video player' });
  fireEvent.click(await screen.findByRole('button', { name: 'Delete Dune.mp4' }));
  await waitFor(() =>
    expect(screen.queryByRole('region', { name: 'Video player' })).not.toBeInTheDocument(),
  );
  expect(window.location.search).toBe('?folder=collection');
});

it('opens a file-only URL and rejects files without playback permission', async () => {
  window.history.replaceState(null, '', '/?file=movie');
  const library = render(<Library accountId="viewer" />);
  await screen.findByRole('region', { name: 'Video player' });
  expect(document.querySelector('video')).toHaveAttribute('aria-label', 'Dune.mp4');
  library.unmount();
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (...args) =>
    args[0] === '/api/drive/files/movie'
      ? Response.json({ ...movie, capabilities: { canDownload: false } })
      : original(...args),
  );
  render(<Library accountId="viewer" />);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'does not allow downloads or direct playback',
  );
  expect(screen.queryByRole('region', { name: 'Video player' })).not.toBeInTheDocument();
});

it('keeps the root listing when Forward closes a video opened from My Drive', async () => {
  render(<Library accountId="viewer" />);
  await screen.findByRole('button', { name: 'Open folder Movies' });
  fireEvent.change(screen.getByLabelText('Google Drive link or file ID'), {
    target: { value: 'movie' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Open ↗' }));
  await screen.findByRole('region', { name: 'Video player' });
  fireEvent.click(screen.getByRole('button', { name: 'Close video' }));
  act(() => window.history.back());
  await screen.findByRole('region', { name: 'Video player' });
  await screen.findByRole('button', { name: 'Open folder Movies' });
  act(() => window.history.forward());
  await waitFor(() => expect(window.location.search).toBe(''));
  expect(await screen.findByRole('button', { name: 'Open folder Movies' })).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Video player' })).not.toBeInTheDocument();
});
