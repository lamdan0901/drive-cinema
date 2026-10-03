import type { SubtitleDocument } from '@/lib/types';
function stamp(n: number): string {
  const ms = Math.round(n * 1000);
  const h = Math.floor(ms / 3600000),
    m = Math.floor(ms / 60000) % 60,
    s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}
export function serializeVtt(document: SubtitleDocument): string {
  const blocks = [
    ...(document.metadata ?? []),
    ...document.cues.map(
      (c) =>
        `${c.id ? c.id + '\n' : ''}${stamp(c.start)} --> ${stamp(c.end)}${c.settings ? ' ' + c.settings : ''}\n${c.text}`,
    ),
  ];
  return 'WEBVTT\n\n' + blocks.join('\n\n') + '\n';
}
