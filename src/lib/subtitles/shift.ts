import type { Cue } from '@/lib/types';
export function shiftCues(cues: Cue[], offset: number): Cue[] {
  if (!Number.isFinite(offset) || Math.abs(offset) > 86400)
    throw new Error('Use a subtitle offset between -86400 and 86400 seconds.');
  return cues
    .filter((c) => c.end + offset > 0)
    .map((c) => ({ ...c, start: Math.max(0, c.start + offset), end: c.end + offset }));
}
