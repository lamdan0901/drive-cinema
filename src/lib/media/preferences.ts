export interface Preferences {
  time: number;
  offset: number;
  subtitleId?: string;
}
const defaults = (): Preferences => ({ time: 0, offset: 0 });
export function readPreferences(fileId: string): Preferences {
  try {
    const raw = localStorage.getItem('drive-cinema:' + fileId);
    if (!raw) return defaults();
    const p = JSON.parse(raw);
    if (
      !Number.isFinite(p.time) ||
      p.time < 0 ||
      !Number.isFinite(p.offset) ||
      Math.abs(p.offset) > 86400
    )
      return defaults();
    return {
      time: p.time,
      offset: p.offset,
      ...(typeof p.subtitleId === 'string' && p.subtitleId.length < 200
        ? { subtitleId: p.subtitleId }
        : {}),
    };
  } catch {
    return defaults();
  }
}
export function writePreferences(fileId: string, p: Preferences): void {
  try {
    if (
      Number.isFinite(p.time) &&
      p.time >= 0 &&
      Number.isFinite(p.offset) &&
      Math.abs(p.offset) <= 86400
    )
      localStorage.setItem('drive-cinema:' + fileId, JSON.stringify(p));
  } catch {
    /* Playback continues when storage is blocked. */
  }
}
