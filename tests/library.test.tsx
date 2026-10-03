// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Library } from '@/components/library';
const folder = { id: 'folder', name: 'Movies', mimeType: 'application/vnd.google-apps.folder' };
beforeEach(() => {
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
it('navigates folders with breadcrumbs and empty feedback', async () => {
  render(<Library name="Watcher" />);
  fireEvent.click(await screen.findByRole('button', { name: /Open folder Movies/ }));
  expect(await screen.findByText('Nothing here yet')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'My Drive' })).toBeInTheDocument();
});
it('loads another page and searches within folder', async () => {
  render(<Library />);
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
  render(<Library />);
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
  render(<Library />);
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
  render(<Library />);
  fireEvent.click(await screen.findByRole('button', { name: 'Open folder Movies' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Play Movie.mp4' }));
  fireEvent.click(screen.getByRole('button', { name: 'My Drive' }));
  await screen.findByRole('button', { name: 'Open folder Movies' });
  resolve(Response.json(movie));
  await new Promise((r) => setTimeout(r, 20));
  expect(screen.queryByRole('region', { name: 'Video player' })).not.toBeInTheDocument();
});
