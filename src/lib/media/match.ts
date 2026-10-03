import type { DriveFile, SubtitleCandidate } from '@/lib/types';
const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[._\s-]+/g, ' ')
    .trim();
export function matchSubtitles(videoName: string, files: DriveFile[]): SubtitleCandidate[] {
  const stem = normalize(videoName.replace(/\.[^.]+$/, ''));
  return files
    .filter((f) => /\.(srt|vtt)$/i.test(f.name))
    .map((file) => {
      let base = file.name.replace(/\.(srt|vtt)$/i, '');
      const lang = base.match(
        /[._ -](vi|en|fr|de|es|ja|ko|zh|th|id|pt|ru|it|ar)(?:[._ -](?:sdh|forced))?$/i,
      );
      if (lang) base = base.slice(0, lang.index);
      return {
        file,
        language: lang?.[1].toLowerCase() ?? 'und',
        matched: normalize(base) === stem,
      };
    })
    .sort((a, b) => Number(b.matched) - Number(a.matched));
}
