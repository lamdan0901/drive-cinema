// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Library } from '@/components/library';
import { uploadFile } from '@/lib/drive/upload-client';

vi.mock('@/lib/drive/upload-client', async (original) => ({
  ...(await original<typeof import('@/lib/drive/upload-client')>()),
  uploadFile: vi.fn(),
}));
const folder = { id: 'movies', name: 'Movies', mimeType: 'application/vnd.google-apps.folder' };
const uploaded = {
  id: 'new-movie',
  name: 'Uploaded.mp4',
  mimeType: 'video/mp4',
  size: '3',
  parents: ['movies'],
};
let present: boolean;
beforeEach(() => {
  present = false;
  window.history.replaceState(null, '', '/');
  localStorage.clear();
  vi.mocked(uploadFile).mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const parent = new URL(input, window.location.origin).searchParams.get('parent');
      return Response.json({ files: parent === 'movies' ? (present ? [uploaded] : []) : [folder] });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('automatically refreshes the current folder after an upload completes', async () => {
  vi.mocked(uploadFile).mockImplementation(async () => {
    present = true;
    return uploaded;
  });
  render(<Library accountId="viewer" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Open folder Movies' }));
  await screen.findByText('Nothing here yet');
  fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
  fireEvent.change(screen.getByLabelText('Choose files to upload'), {
    target: { files: [new File(['abc'], 'Uploaded.mp4')] },
  });
  expect(await screen.findByRole('button', { name: 'Play Uploaded.mp4' })).toBeInTheDocument();
  expect(vi.mocked(uploadFile).mock.calls[0][1]).toBe('movies');
});
it('keeps navigation intact when an upload to another folder finishes', async () => {
  let finish!: (file: typeof uploaded) => void;
  vi.mocked(uploadFile).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<Library accountId="viewer" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Open folder Movies' }));
  await screen.findByText('Nothing here yet');
  fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
  fireEvent.change(screen.getByLabelText('Choose files to upload'), {
    target: { files: [new File(['abc'], 'Uploaded.mp4')] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'My Drive' }));
  await screen.findByRole('button', { name: 'Open folder Movies' });
  await act(async () => {
    present = true;
    finish(uploaded);
  });
  expect(screen.getByRole('button', { name: 'Open folder Movies' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Play Uploaded.mp4' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Open folder Movies' }));
  expect(await screen.findByRole('button', { name: 'Play Uploaded.mp4' })).toBeInTheDocument();
});
