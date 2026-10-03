// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Library } from '@/components/library';
const folder = {
  id: 'folder',
  name: 'Movies',
  mimeType: 'application/vnd.google-apps.folder',
  capabilities: { canRename: true, canTrash: true },
};
beforeEach(() => {
  window.history.replaceState(null, '', '/');
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (u: string) =>
      Response.json(
        u.includes('parent=folder') ? { files: [] } : { files: [folder], nextPageToken: 'more' },
      ),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('switches both file browsers between list and grid and keeps the view when navigating', async () => {
  render(<Library accountId="viewer" />);
  const openFolder = await screen.findByRole('button', { name: 'Open folder Movies' });
  const list = screen.getByRole('button', { name: 'List view' });
  const grid = screen.getByRole('button', { name: 'Grid view' });
  expect(list).toHaveAttribute('aria-pressed', 'true');
  expect(grid).toHaveAttribute('aria-pressed', 'false');
  expect(openFolder.closest('.file-list')).not.toHaveClass('file-grid');
  fireEvent.click(screen.getByRole('button', { name: 'Pin Movies' }));
  fireEvent.click(grid);
  expect(grid).toHaveAttribute('aria-pressed', 'true');
  expect(list).toHaveAttribute('aria-pressed', 'false');
  for (const button of screen.getAllByRole('button', { name: 'Open folder Movies' })) {
    expect(button.closest('.file-list')).toHaveClass('file-grid');
  }
  fireEvent.click(openFolder);
  expect(await screen.findByText('Nothing here yet')).toBeInTheDocument();
  expect(grid).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'My Drive' }));
  await waitFor(() =>
    expect(screen.getAllByRole('button', { name: 'Open folder Movies' })).toHaveLength(2),
  );
  fireEvent.click(list);
  for (const button of screen.getAllByRole('button', { name: 'Open folder Movies' })) {
    expect(button.closest('.file-list')).not.toHaveClass('file-grid');
  }
});
it('restores each selected view after remounting the library', async () => {
  let library = render(<Library accountId="viewer" />);
  for (const view of ['Grid', 'List']) {
    fireEvent.click(screen.getByRole('button', { name: `${view} view` }));
    library.unmount();
    library = render(<Library accountId="viewer" />);
    const file = await screen.findByRole('button', { name: 'Open folder Movies' });
    expect(screen.getByRole('button', { name: `${view} view` })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(file.closest('.file-list')?.classList.contains('file-grid')).toBe(view === 'Grid');
  }
});
it('ignores an invalid saved view and replaces it when a view is selected', () => {
  localStorage.setItem('drive-cinema:view', 'invalid');
  render(<Library accountId="viewer" />);
  expect(screen.getByRole('button', { name: 'List view' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Grid view' }));
  expect(localStorage.getItem('drive-cinema:view')).toBe('grid');
});
it('still switches views when local storage is blocked', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  render(<Library accountId="viewer" />);
  fireEvent.click(screen.getByRole('button', { name: 'Grid view' }));
  expect(screen.getByRole('button', { name: 'Grid view' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'List view' }));
  expect(screen.getByRole('button', { name: 'List view' })).toHaveAttribute('aria-pressed', 'true');
});
it('navigates folders with breadcrumbs and empty feedback', async () => {
  render(<Library accountId="viewer" name="Watcher" />);
  fireEvent.click(await screen.findByRole('button', { name: /Open folder Movies/ }));
  expect(await screen.findByText('Nothing here yet')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'My Drive' })).toBeInTheDocument();
});
it('loads another page and searches within folder', async () => {
  render(<Library accountId="viewer" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('pageToken=more'),
      expect.anything(),
    ),
  );
  fireEvent.change(screen.getByLabelText('Search this folder'), { target: { value: 'Dune' } });
  fireEvent.submit(screen.getByRole('search'));
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('q=Dune'), expect.anything()),
  );
});
it('does not let a stale root response replace a newly selected folder', async () => {
  let resolve: (value: Response) => void = () => {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (u: string) =>
      u.includes('pageToken=more')
        ? new Promise<Response>((r) => {
            resolve = r;
          })
        : Response.json(
            u.includes('parent=folder')
              ? { files: [] }
              : { files: [folder], nextPageToken: 'more' },
          ),
    ),
  );
  render(<Library accountId="viewer" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
  fireEvent.click(screen.getByRole('button', { name: /Open folder Movies/ }));
  expect(await screen.findByText('Nothing here yet')).toBeInTheDocument();
  resolve(Response.json({ files: [{ id: 'old', name: 'Stale', mimeType: 'video/mp4' }] }));
  await new Promise((r) => setTimeout(r, 20));
  expect(screen.queryByText('Stale')).not.toBeInTheDocument();
});
it('shows safe upstream errors and offers sign-in on 401', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ error: 'Sign in again.' }, { status: 401 })),
  );
  render(<Library accountId="viewer" />);
  expect(await screen.findByRole('link', { name: 'Sign in again' })).toBeInTheDocument();
});
it('invalidates a delayed video selection when navigating via breadcrumbs', async () => {
  let resolve: (r: Response) => void = () => {};
  const movie = {
    id: 'movie',
    name: 'Movie.mp4',
    mimeType: 'video/mp4',
    parents: ['folder'],
    capabilities: { canDownload: true },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (u: string) =>
      u.includes('/api/drive/files/movie')
        ? new Promise<Response>((r) => {
            resolve = r;
          })
        : Response.json({ files: u.includes('parent=folder') ? [movie] : [folder] }),
    ),
  );
  render(<Library accountId="viewer" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Open folder Movies' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Play Movie.mp4' }));
  fireEvent.click(screen.getByRole('button', { name: 'My Drive' }));
  await screen.findByRole('button', { name: 'Open folder Movies' });
  resolve(Response.json(movie));
  await new Promise((r) => setTimeout(r, 20));
  expect(screen.queryByRole('region', { name: 'Video player' })).not.toBeInTheDocument();
});

it('keeps pinned folders above the collection, restores them, and navigates to them from elsewhere', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (u: string) =>
      Response.json(
        u === '/api/drive/files/folder'
          ? folder
          : u.includes('parent=folder')
            ? { files: [] }
            : { files: [folder] },
      ),
    ),
  );
  const view = render(<Library accountId="viewer" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Pin Movies' }));
  const pinned = screen.getByRole('region', { name: 'Pinned folders' });
  const collection = screen.getByRole('navigation', { name: 'Folder breadcrumbs' });
  expect(
    pinned.compareDocumentPosition(collection) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(within(pinned).getByRole('button', { name: 'Open folder Movies' })).toBeInTheDocument();
  view.unmount();
  const restored = render(<Library accountId="viewer" />);
  const restoredPins = await screen.findByRole('region', { name: 'Pinned folders' });
  fireEvent.click(within(restoredPins).getByRole('button', { name: 'Open folder Movies' }));
  expect(await screen.findByText('Nothing here yet')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Movies' })).toHaveAttribute('aria-current', 'page');
  fireEvent.click(within(restoredPins).getByRole('button', { name: 'Unpin Movies' }));
  expect(screen.queryByRole('region', { name: 'Pinned folders' })).not.toBeInTheDocument();
  restored.unmount();
  window.history.replaceState(null, '', '/');
  render(<Library accountId="viewer" />);
  await screen.findByRole('button', { name: 'Pin Movies' });
  expect(screen.queryByRole('region', { name: 'Pinned folders' })).not.toBeInTheDocument();
});
it('isolates saved pins between Google accounts', async () => {
  const view = render(<Library accountId="viewer" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Pin Movies' }));
  view.unmount();
  render(<Library accountId="other-account" />);
  await screen.findByRole('button', { name: 'Pin Movies' });
  expect(screen.queryByRole('region', { name: 'Pinned folders' })).not.toBeInTheDocument();
});
it('renames a folder and its pinned shortcut only after Drive succeeds', async () => {
  vi.spyOn(window, 'prompt').mockReturnValue('New movies');
  let renamed = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_u: string, init: RequestInit) => {
      if (init.method === 'PATCH') {
        expect(JSON.parse(init.body as string)).toEqual({ name: 'New movies' });
        renamed = true;
        return Response.json({ ...folder, name: 'New movies' });
      }
      return Response.json({ files: [{ ...folder, name: renamed ? 'New movies' : folder.name }] });
    }),
  );
  render(<Library accountId="viewer" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Pin Movies' }));
  fireEvent.click(screen.getByRole('button', { name: 'Rename Movies' }));
  expect(await screen.findByRole('button', { name: 'Rename New movies' })).toBeInTheDocument();
  expect(
    within(screen.getByRole('region', { name: 'Pinned folders' })).getByRole('button', {
      name: 'Open folder New movies',
    }),
  ).toBeInTheDocument();
});
it('cancels deletion and removes a deleted folder from the listing and pins after confirmation', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  let deleted = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_u: string, init: RequestInit) => {
      if (init.method === 'DELETE') {
        deleted = true;
        return Response.json({ ...folder, trashed: true });
      }
      return Response.json({ files: deleted ? [] : [folder] });
    }),
  );
  render(<Library accountId="viewer" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Pin Movies' }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete Movies' }));
  expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Delete Movies' }));
  expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/contents.*Trash/));
  expect(await screen.findByText('Nothing here yet')).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Pinned folders' })).not.toBeInTheDocument();
});
it('preserves items and pins on mutation failure and offers renewed sign-in', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_u: string, init: RequestInit) =>
      init.method === 'DELETE'
        ? Response.json({ error: 'Check permissions or sign in again.' }, { status: 403 })
        : Response.json({ files: [folder] }),
    ),
  );
  render(<Library accountId="viewer" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Pin Movies' }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete Movies' }));
  expect(await screen.findByRole('link', { name: 'Sign in again' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Delete Movies' })).toBeEnabled();
  expect(screen.getByRole('region', { name: 'Pinned folders' })).toBeInTheDocument();
});
it('disables rename and delete for items without Drive permissions', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        files: [{ ...folder, capabilities: { canRename: false, canTrash: false } }],
      }),
    ),
  );
  render(<Library accountId="viewer" />);
  expect(await screen.findByRole('button', { name: 'Rename Movies' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Delete Movies' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Pin Movies' })).toBeEnabled();
});

it('renames and deletes non-video files without trying to play them', async () => {
  const subtitle = { ...folder, id: 'subtitle', name: 'Movie.srt', mimeType: 'text/plain' };
  let current = [subtitle];
  vi.spyOn(window, 'prompt').mockReturnValue('Renamed.srt');
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_u: string, init: RequestInit) => {
      if (init.method === 'PATCH') {
        current = [{ ...subtitle, name: 'Renamed.srt' }];
        return Response.json(current[0]);
      }
      if (init.method === 'DELETE') {
        current = [];
        return Response.json({ ...subtitle, trashed: true });
      }
      return Response.json({ files: current });
    }),
  );
  render(<Library accountId="viewer" />);
  const openFile = await screen.findByRole('link', { name: 'Open file Movie.srt' });
  expect(openFile).toHaveAttribute('href', 'https://drive.google.com/file/d/subtitle/view');
  expect(openFile).toHaveAttribute('target', '_blank');
  expect(openFile).toHaveAttribute('rel', 'noopener noreferrer');
  fireEvent.click(screen.getByRole('button', { name: 'Rename Movie.srt' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Delete Renamed.srt' }));
  expect(await screen.findByText('Nothing here yet')).toBeInTheDocument();
});
it('does not restore an unpinned folder when delayed shortcut metadata returns with a new name', async () => {
  let resolve: (r: Response) => void = () => {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (u: string) =>
      u === '/api/drive/files/folder'
        ? new Promise<Response>((r) => {
            resolve = r;
          })
        : Response.json({ files: [folder] }),
    ),
  );
  render(<Library accountId="viewer" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Pin Movies' }));
  const pinned = within(screen.getByRole('region', { name: 'Pinned folders' }));
  fireEvent.click(pinned.getByRole('button', { name: 'Open folder Movies' }));
  fireEvent.click(pinned.getByRole('button', { name: 'Unpin Movies' }));
  resolve(Response.json({ ...folder, name: 'New movies' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'New movies' })).toHaveAttribute(
      'aria-current',
      'page',
    ),
  );
  expect(screen.queryByRole('region', { name: 'Pinned folders' })).not.toBeInTheDocument();
});
it('returns to the parent and clears a search if the currently open folder is deleted by a pending request', async () => {
  let resolve: (r: Response) => void = () => {};
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (u: string, init: RequestInit) =>
      init.method === 'DELETE'
        ? new Promise<Response>((r) => {
            resolve = r;
          })
        : Response.json({ files: u.includes('parent=folder') ? [] : [folder] }),
    ),
  );
  render(<Library accountId="viewer" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Delete Movies' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open folder Movies' }));
  fireEvent.change(screen.getByLabelText('Search this folder'), { target: { value: 'movie' } });
  fireEvent.submit(screen.getByRole('search'));
  await screen.findByText('Results for “movie”');
  resolve(Response.json({ ...folder, trashed: true }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'My Drive' })).toHaveAttribute(
      'aria-current',
      'page',
    ),
  );
  expect(screen.getByLabelText('Search this folder')).toHaveValue('');
});
it('warns when pins cannot be saved, while keeping the shortcut available for this session', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  render(<Library accountId="viewer" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Pin Movies' }));
  expect(screen.getByRole('alert')).toHaveTextContent('could not be saved');
  expect(screen.getByRole('region', { name: 'Pinned folders' })).toBeInTheDocument();
});
it.each(['rename', 'delete'] as const)(
  'refreshes the playing video subtitle menu after subtitle %s',
  async (action) => {
    const movie = {
      ...folder,
      id: 'movie',
      name: 'Movie.mp4',
      mimeType: 'video/mp4',
      parents: ['media'],
      capabilities: { ...folder.capabilities, canDownload: true },
    };
    let subtitles = [{ ...folder, id: 'sub', name: 'Other.srt', mimeType: 'text/plain' }];
    vi.spyOn(window, 'prompt').mockReturnValue('Renamed.srt');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (u: string, init: RequestInit) => {
        if (init.method === 'PATCH') {
          subtitles = [{ ...subtitles[0], name: 'Renamed.srt' }];
          return Response.json(subtitles[0]);
        }
        if (init.method === 'DELETE') {
          subtitles = [];
          return Response.json({ id: 'sub', trashed: true });
        }
        return Response.json(
          u === '/api/drive/files/movie'
            ? movie
            : { files: u.includes('parent=media') ? subtitles : [movie, ...subtitles] },
        );
      }),
    );
    render(<Library accountId="viewer" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Play Movie.mp4' }));
    await screen.findByRole('option', { name: /Other.srt/ });
    fireEvent.click(
      screen.getByRole('button', {
        name: `${action === 'rename' ? 'Rename' : 'Delete'} Other.srt`,
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('option', { name: /Other.srt/ })).not.toBeInTheDocument(),
    );
    if (action === 'rename')
      expect(await screen.findByRole('option', { name: /Renamed.srt/ })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Video player' })).toBeInTheDocument();
  },
);
it('restarts delayed subtitle discovery after an unrelated mutation and ignores its old response', async () => {
  const movie = {
    ...folder,
    id: 'movie',
    name: 'Movie.mp4',
    mimeType: 'video/mp4',
    parents: ['media'],
    capabilities: { ...folder.capabilities, canDownload: true },
  };
  const subtitle = { id: 'sub', name: 'Other.srt', mimeType: 'text/plain' };
  let resolve: (r: Response) => void = () => {};
  let first = true;
  let deleted = false;
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (u: string, init: RequestInit) => {
      if (init.method === 'DELETE') {
        deleted = true;
        return Response.json({ ...folder, trashed: true });
      }
      if (u === '/api/drive/files/movie') return Response.json(movie);
      if (u.includes('parent=media')) {
        if (first) {
          first = false;
          return new Promise<Response>((r) => {
            resolve = r;
          });
        }
        return Response.json({ files: [subtitle] });
      }
      return Response.json({ files: deleted ? [movie] : [folder, movie] });
    }),
  );
  render(<Library accountId="viewer" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Play Movie.mp4' }));
  await waitFor(() => expect(first).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Delete Movies' }));
  expect(await screen.findByRole('option', { name: /Other.srt/ })).toBeInTheDocument();
  resolve(Response.json({ files: [{ ...subtitle, name: 'Stale.srt' }] }));
  await waitFor(() => expect(screen.queryByRole('status', { name: '' })).not.toBeInTheDocument());
  expect(screen.queryByRole('option', { name: /Stale.srt/ })).not.toBeInTheDocument();
});
