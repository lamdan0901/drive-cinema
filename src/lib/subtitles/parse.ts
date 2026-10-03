import type { Cue, SubtitleDocument } from '@/lib/types';
function timestamp(s: string): number {
  const m = /^(?:(\d{2,}):)?(\d{2}):(\d{2})[.,](\d{3})$/.exec(s);
  if (!m || Number(m[2]) > 59 || Number(m[3]) > 59) throw new Error('Invalid subtitle timestamp.');
  const n = Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
  if (!Number.isFinite(n) || n > 36000000) throw new Error('Subtitle timestamp is too large.');
  return n;
}
export function parseSubtitles(text: string): SubtitleDocument {
  const source = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .trim();
  const vtt = /^WEBVTT(?:[ \t][^\n]*)?(?:\n|$)/.test(source);
  const body = vtt ? source.replace(/^WEBVTT[^\n]*(?:\n|$)/, '').trim() : source;
  const cues: Cue[] = [],
    metadata: string[] = [];
  if (!body) return { cues, metadata };
  for (const block of body.split(/\n[ \t]*\n/)) {
    if (vtt && /^(NOTE(?:\s|$)|STYLE(?:\n|$)|REGION(?:\n|$))/.test(block)) {
      metadata.push(block);
      continue;
    }
    const lines = block.split('\n');
    const index = lines[0].includes('-->') ? 0 : 1;
    const timing = lines[index]?.match(/^([^\s]+)[ \t]+-->[ \t]+([^\s]+)(?:[ \t]+(.*))?$/);
    // Some SRT exports insert blank lines inside a cue's text.
    if (!timing && !vtt && cues.length && !/^\d+[ \t]*$/.test(lines[0]) && !block.includes('-->')) {
      cues[cues.length - 1].text += '\n' + block;
      continue;
    }
    if (!timing || (index === 1 && !lines[0].trim()))
      throw new Error('Invalid subtitle cue. Use an SRT or WebVTT file.');
    const start = timestamp(timing[1]),
      end = timestamp(timing[2]);
    if (end <= start) throw new Error('Subtitle cues must end after they start.');
    const payload = lines.slice(index + 1).join('\n');
    if (!payload) throw new Error('Subtitle cue has no text.');
    cues.push({
      start,
      end,
      text: payload,
      ...(vtt && index === 1 ? { id: lines[0] } : {}),
      ...(timing[3] ? { settings: timing[3] } : {}),
    });
  }
  return { cues, metadata };
}
