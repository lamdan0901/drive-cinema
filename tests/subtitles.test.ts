import { expect, it } from 'vitest';
import { parseSubtitles } from '@/lib/subtitles/parse';
import { serializeVtt } from '@/lib/subtitles/serialize';
import { shiftCues } from '@/lib/subtitles/shift';
import { decodeSubtitle } from '@/lib/subtitles/decode';
const srt =
  '\uFEFF1\r\n00:00:01,500 --> 00:00:03,000\r\nXin chào\r\n<b>Việt Nam</b>\r\n\r\n2\r\n00:00:04,000 --> 00:00:05,000\r\nBye';
it('converts BOM CRLF and multiline SRT', () => {
  const d = parseSubtitles(srt);
  expect(d.cues).toHaveLength(2);
  expect(d.cues[0].start).toBe(1.5);
  expect(serializeVtt(d)).toContain('00:00:01.500 --> 00:00:03.000\nXin chào\n<b>Việt Nam</b>');
});
it.each(['\n', '\r\n'])(
  'keeps SRT text separated by a blank line in the same cue (%j)',
  (newline) => {
    const d = parseSubtitles(
      [
        '1',
        '00:00:01,000 --> 00:00:03,000',
        'First line',
        '',
        'Continuation',
        '',
        '2',
        '00:00:04,000 --> 00:00:05,000',
        'Next cue',
      ].join(newline),
    );
    expect(d.cues).toEqual([
      { start: 1, end: 3, text: 'First line\nContinuation' },
      { start: 4, end: 5, text: 'Next cue' },
    ]);
    expect(serializeVtt(d)).toBe(
      'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nFirst line\nContinuation\n\n00:00:04.000 --> 00:00:05.000\nNext cue\n',
    );
  },
);
it('preserves VTT identifiers settings and metadata', () => {
  const d = parseSubtitles(
    'WEBVTT\n\nSTYLE\n::cue { color: white; }\n\nintro\n00:01.000 --> 00:02.000 align:start\nHi',
  );
  expect(d.cues[0].id).toBe('intro');
  expect(serializeVtt(d)).toContain('align:start');
  expect(serializeVtt(d)).toContain('STYLE');
});
it.each([
  '1\n00:61:00,000 --> 00:62:00,000\nHi',
  '1\n00:00:02,000 --> 00:00:01,000\nHi',
  '1\n00:00:01,000 --> 00:00:01,000\nHi',
  'garbage',
  'WEBVTT\n\nbad cue',
  'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHi\n\norphan text',
  '1\n00:00:01,000 --> 00:00:03,000\nHi\n\n2',
  '1\n00:00:01,000 --> 00:00:03,000\nHi\n\n2\ninvalid --> timing\nBye',
])('rejects malformed cues', (s) => expect(() => parseSubtitles(s)).toThrow());
it('clips negative offset without changing the original', () => {
  const cues = [
    { start: 1, end: 3, text: 'A' },
    { start: 0, end: 1, text: 'B' },
  ];
  expect(shiftCues(cues, -2)).toEqual([{ start: 0, end: 1, text: 'A' }]);
  expect(cues[0].start).toBe(1);
});
it('rejects nonfinite offsets', () => expect(() => shiftCues([], NaN)).toThrow());
it('decodes UTF8 BOM and Windows1258', () => {
  expect(decodeSubtitle(new TextEncoder().encode('\uFEFFXin chào'), 'utf-8')).toBe('Xin chào');
  expect(decodeSubtitle(new Uint8Array([0x61, 0xec]), 'windows-1258').normalize('NFC')).toBe('á');
});
