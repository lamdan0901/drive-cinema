// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { readPreferences, writePreferences } from '@/lib/media/preferences';
import { playerShortcut } from '@/lib/media/shortcuts';
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
it('retains validated preferences', () => {
  writePreferences('movie', { time: 12, offset: -1.5, subtitleId: 'vi' });
  expect(readPreferences('movie')).toEqual({ time: 12, offset: -1.5, subtitleId: 'vi' });
});
it('ignores corrupt and unsafe stored values', () => {
  localStorage.setItem('drive-cinema:movie', '{"time":-5,"offset":"oops"}');
  expect(readPreferences('movie')).toEqual({ time: 0, offset: 0 });
  localStorage.setItem('drive-cinema:movie', 'garbage');
  expect(readPreferences('movie').time).toBe(0);
});
it('works when storage is unavailable', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('denied');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('denied');
  });
  expect(readPreferences('m').time).toBe(0);
  expect(() => writePreferences('m', { time: 5, offset: 0 })).not.toThrow();
});
it('ignores keyboard input in editable fields', () => {
  for (const tag of ['input', 'textarea', 'select', 'button']) {
    expect(playerShortcut(' ', document.createElement(tag))).toBeNull();
  }
  const div = document.createElement('div');
  div.setAttribute('contenteditable', 'true');
  expect(playerShortcut('ArrowRight', div)).toBeNull();
  expect(playerShortcut('ArrowRight', document.createElement('video'))).toBe('forward');
});
