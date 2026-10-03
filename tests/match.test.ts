import { expect, it } from 'vitest';
import { matchSubtitles } from '@/lib/media/match';
const f = (id: string, name: string) => ({ id, name, mimeType: 'text/plain' });
it('matches normalized stems and language suffixes', () => {
  const r = matchSubtitles('Movie.Name.2026.mp4', [
    f('1', 'Movie.Name.2026.vi.srt'),
    f('2', 'Movie_Name_2026.en.vtt'),
    f('3', 'Other.vi.srt'),
  ]);
  expect(r.map((v) => v.matched)).toEqual([true, true, false]);
  expect(r[0].language).toBe('vi');
});
it('retains ambiguous language matches for manual choice', () => {
  expect(
    matchSubtitles('Movie.mp4', [f('1', 'Movie.vi.srt'), f('2', 'Movie.vi.vtt')]),
  ).toHaveLength(2);
});
