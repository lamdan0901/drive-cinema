// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import {
  readPreferences,
  writePreferences,
  readSubtitleDelay,
  writeSubtitleDelay,
} from '@/lib/media/preferences';
import { playerShortcut } from '@/lib/media/shortcuts';
import { readPins, writePins } from '@/lib/media/pins';
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
it('restores valid folder shortcuts and ignores malformed stored entries', () => {
  const pin = {
    id: 'movies',
    name: 'Movies',
    path: [
      { id: 'root', name: 'My Drive' },
      { id: 'movies', name: 'Movies' },
    ],
  };
  writePins('viewer', [pin]);
  expect(readPins('viewer')).toEqual([pin]);
  expect(readPins('someone-else')).toEqual([]);
  localStorage.setItem(
    'drive-cinema:pins:viewer',
    JSON.stringify([null, { ...pin, path: [null] }, { ...pin, id: 'different' }, pin]),
  );
  expect(readPins('viewer')).toEqual([pin]);
  localStorage.setItem('drive-cinema:pins:viewer', 'broken JSON');
  expect(readPins('viewer')).toEqual([]);
});
it('retains validated preferences', () => {
  writePreferences('movie', { time: 12, offset: -1.5, subtitleId: 'vi' });
  expect(readPreferences('movie')).toEqual({ time: 12, offset: -1.5, subtitleId: 'vi' });
});
it('keeps subtitle delay independent for each video-subtitle pair, including zero', () => {
  writeSubtitleDelay('movie', 'vi', -0.25);
  writeSubtitleDelay('movie', 'en', 1.5);
  writeSubtitleDelay('other', 'vi', 2);
  expect(readSubtitleDelay('movie', 'vi')).toBe(-0.25);
  expect(readSubtitleDelay('movie', 'en')).toBe(1.5);
  expect(readSubtitleDelay('other', 'vi')).toBe(2);
  expect(readSubtitleDelay('other', 'en')).toBe(0);
  writeSubtitleDelay('movie', 'vi', 0);
  expect(readSubtitleDelay('movie', 'vi')).toBe(0);
});
it('migrates the legacy video delay only to its saved subtitle', () => {
  writePreferences('movie', { time: 12, offset: -1.5, subtitleId: 'vi' });
  expect(readSubtitleDelay('movie', 'vi')).toBe(-1.5);
  expect(readSubtitleDelay('movie', 'en')).toBe(0);
  writeSubtitleDelay('movie', 'vi', 0);
  expect(readSubtitleDelay('movie', 'vi')).toBe(0);
});
it('ignores malformed delay entries and rejects unsafe writes', () => {
  for (const value of ['null', '"1"', '{}', '86401', 'broken JSON']) {
    localStorage.setItem('drive-cinema:subtitle-delay:movie:vi', value);
    expect(readSubtitleDelay('movie', 'vi')).toBe(0);
  }
  writeSubtitleDelay('movie', 'vi', 0.5);
  for (const value of [NaN, Infinity, -86401]) writeSubtitleDelay('movie', 'vi', value);
  expect(readSubtitleDelay('movie', 'vi')).toBe(0.5);
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
  expect(readSubtitleDelay('m', 's')).toBe(0);
  expect(() => writeSubtitleDelay('m', 's', 0.05)).not.toThrow();
});
it('ignores keyboard input in editable fields', () => {
  for (const tag of ['input', 'textarea', 'select']) {
    expect(playerShortcut(' ', document.createElement(tag))).toBeNull();
  }
  const div = document.createElement('div');
  div.setAttribute('contenteditable', 'true');
  expect(playerShortcut('ArrowRight', div)).toBeNull();
  expect(playerShortcut('ArrowRight', document.createElement('video'))).toBe('forward');
  expect(playerShortcut(' ', document.createElement('button'))).toBe('toggle');
  expect(playerShortcut('L', document.createElement('a'))).toBe('forward10');
});
