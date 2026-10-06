// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { UploadControl } from '@/components/upload-control';
import { uploadFile, UploadError } from '@/lib/drive/upload-client';

vi.mock('@/lib/drive/upload-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/drive/upload-client')>()),
  uploadFile: vi.fn(),
}));
const upload = vi.mocked(uploadFile);
const done = { id: 'uploaded', name: 'movie.mp4', mimeType: 'video/mp4', size: '3' };
const props = { parent: 'movies', folderName: 'Movies', disabled: false, onComplete: vi.fn() };
beforeEach(() => {
  upload.mockReset();
  props.onComplete.mockReset();
});
afterEach(cleanup);
function select(file = new File(['abc'], 'movie.mp4')) {
  fireEvent.change(screen.getByLabelText('Choose files to upload'), { target: { files: [file] } });
}
it('opens the native picker immediately and waits for files before showing progress', () => {
  render(<UploadControl {...props} />);
  const input = screen.getByLabelText('Choose files to upload');
  const click = vi.spyOn(input, 'click');
  fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
  expect(click).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('region', { name: 'Upload files' })).not.toBeInTheDocument();
  fireEvent.change(input, { target: { files: [] } });
  expect(screen.queryByRole('region', { name: 'Upload files' })).not.toBeInTheDocument();
  expect(upload).not.toHaveBeenCalled();
});
it('shows progress after selection and can reopen hidden progress without opening the picker', async () => {
  upload.mockImplementation(() => new Promise(() => {}));
  render(<UploadControl {...props} />);
  const button = screen.getByRole('button', { name: 'Upload' });
  select();
  expect(screen.getByRole('region', { name: 'Upload files' })).toHaveTextContent('Movies');
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('region', { name: 'Upload files' })).not.toBeInTheDocument();
  expect(button).toHaveFocus();
  expect(upload.mock.calls[0][2].signal.aborted).toBe(false);
  const click = vi.spyOn(screen.getByLabelText('Choose files to upload'), 'click');
  fireEvent.click(screen.getByRole('button', { name: 'Show uploads' }));
  expect(screen.getByRole('region', { name: 'Upload files' })).toBeInTheDocument();
  expect(click).not.toHaveBeenCalled();
});
it('keeps a file destination fixed when navigating and refreshes it after completion', async () => {
  let finish!: (file: typeof done) => void;
  upload.mockImplementation((_file, _parent, options) => {
    options.onProgress(1);
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const view = render(<UploadControl {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
  select();
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '33');
  view.rerender(<UploadControl {...props} parent="other" folderName="Other folder" />);
  expect(upload.mock.calls[0][1]).toBe('movies');
  expect(screen.getByRole('list', { name: 'Upload queue' })).toHaveTextContent('Movies');
  await act(async () => finish(done));
  expect(props.onComplete).toHaveBeenCalledWith(done, 'movies');
  expect(screen.getByText('Uploaded')).toBeInTheDocument();
});
it('retries failures with the saved ticket and does not recreate completed files', async () => {
  upload
    .mockImplementationOnce(async (_file, _parent, options) => {
      options.onTicket('saved');
      throw new Error('Connection interrupted');
    })
    .mockResolvedValueOnce(done);
  render(<UploadControl {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
  select();
  expect(await screen.findByRole('alert')).toHaveTextContent('Connection interrupted');
  fireEvent.click(screen.getByRole('button', { name: 'Retry movie.mp4' }));
  await screen.findByText('Uploaded');
  expect(upload.mock.calls[1][2].ticket).toBe('saved');
  expect(props.onComplete).toHaveBeenCalledTimes(1);
});
it('does not offer Retry until an active cancellation settles', async () => {
  let rejectUpload!: (error: Error) => void;
  upload.mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        rejectUpload = reject;
      }),
  );
  render(<UploadControl {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
  select();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel movie.mp4' }));
  expect(upload.mock.calls[0][2].signal.aborted).toBe(true);
  expect(screen.queryByRole('button', { name: 'Retry movie.mp4' })).not.toBeInTheDocument();
  await act(async () => rejectUpload(new DOMException('Aborted', 'AbortError')));
  expect(screen.getByRole('button', { name: 'Retry movie.mp4' })).toBeInTheDocument();
});
it('uploads dropped files sequentially and allows cancelling queued files', async () => {
  let finish!: (file: typeof done) => void;
  upload.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<UploadControl {...props} />);
  fireEvent.drop(document.body, {
    dataTransfer: {
      types: ['Files'],
      files: [new File(['abc'], 'one.mp4'), new File(['abc'], 'two.mp4')],
    },
  });
  expect(upload).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel two.mp4' }));
  await act(async () => finish(done));
  await waitFor(() => expect(screen.getByText('No uploads running')).toBeInTheDocument());
  expect(upload).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Clear finished' }));
  expect(screen.queryByRole('list', { name: 'Upload queue' })).not.toBeInTheDocument();
});
it('prevents adding files until the current folder has been restored', () => {
  render(<UploadControl {...props} disabled />);
  fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
  expect(screen.getByLabelText('Choose files to upload')).toBeDisabled();
  select();
  expect(upload).not.toHaveBeenCalled();
});

it('offers sign-in again when Google rejects upload consent on an otherwise signed-in account', async () => {
  upload.mockRejectedValue(
    new UploadError('Grant Drive upload access', 403, 'UPLOAD_SCOPE_REQUIRED'),
  );
  render(<UploadControl {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
  select();
  expect(await screen.findByRole('link', { name: 'Sign in again' })).toHaveAttribute(
    'href',
    '/api/auth/login',
  );
});

it('shows a page-wide overlay only for files and keeps it visible across nested elements', () => {
  render(
    <>
      <main data-testid="layout">
        <span data-testid="child">Collection</span>
      </main>
      <UploadControl {...props} />
    </>,
  );
  const layout = screen.getByTestId('layout');
  const child = screen.getByTestId('child');
  fireEvent.dragEnter(layout, { dataTransfer: { types: ['text/plain'] } });
  expect(screen.queryByRole('status', { name: 'Drop files to upload' })).not.toBeInTheDocument();
  fireEvent.dragEnter(layout, { dataTransfer: { types: ['Files'] } });
  expect(screen.getByRole('status', { name: 'Drop files to upload' })).toHaveTextContent('Movies');
  fireEvent.dragEnter(child, { dataTransfer: { types: ['Files'] } });
  fireEvent.dragLeave(layout);
  expect(screen.getByRole('status', { name: 'Drop files to upload' })).toBeInTheDocument();
  fireEvent.dragLeave(child);
  expect(screen.queryByRole('status', { name: 'Drop files to upload' })).not.toBeInTheDocument();
});
it('drops files on the main layout into the latest folder and dismisses the overlay', () => {
  upload.mockImplementation(() => new Promise(() => {}));
  const view = render(<UploadControl {...props} />);
  fireEvent.dragEnter(document.body, { dataTransfer: { types: ['Files'] } });
  view.rerender(<UploadControl {...props} parent="other" folderName="Other folder" />);
  expect(screen.getByRole('status', { name: 'Drop files to upload' })).toHaveTextContent(
    'Other folder',
  );
  fireEvent.drop(document.body, {
    dataTransfer: { types: ['Files'], files: [new File(['abc'], 'movie.mp4')] },
  });
  expect(upload.mock.calls[0][1]).toBe('other');
  expect(screen.queryByRole('status', { name: 'Drop files to upload' })).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Upload files' })).toBeInTheDocument();
});
it('dismisses abandoned drags on Escape or leaving the window', () => {
  render(<UploadControl {...props} />);
  fireEvent.dragEnter(document.body, { dataTransfer: { types: ['Files'] } });
  expect(screen.getByRole('status', { name: 'Drop files to upload' })).toBeInTheDocument();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('status', { name: 'Drop files to upload' })).not.toBeInTheDocument();
  fireEvent.dragEnter(document.body, { dataTransfer: { types: ['Files'] } });
  expect(screen.getByRole('status', { name: 'Drop files to upload' })).toBeInTheDocument();
  fireEvent.blur(window);
  expect(screen.queryByRole('status', { name: 'Drop files to upload' })).not.toBeInTheDocument();
  expect(upload).not.toHaveBeenCalled();
});
it('blocks a file drop while the folder is unavailable without navigating to the local file', () => {
  render(<UploadControl {...props} disabled />);
  fireEvent.dragEnter(document.body, { dataTransfer: { types: ['Files'] } });
  expect(screen.getByRole('status', { name: 'Drop files to upload' })).toHaveTextContent(
    'temporarily unavailable',
  );
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.assign(event, {
    dataTransfer: { types: ['Files'], files: [new File(['abc'], 'movie.mp4')] },
  });
  fireEvent(document.body, event);
  expect(event.defaultPrevented).toBe(true);
  expect(upload).not.toHaveBeenCalled();
  expect(screen.queryByRole('status', { name: 'Drop files to upload' })).not.toBeInTheDocument();
});
