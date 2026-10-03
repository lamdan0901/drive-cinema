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

function subtitleDelayKey(videoId: string, subtitleId: string): string {
  return `drive-cinema:subtitle-delay:${encodeURIComponent(videoId)}:${encodeURIComponent(subtitleId)}`;
}

export function readSubtitleDelay(videoId: string, subtitleId: string): number {
  if (subtitleId === 'off' || subtitleId === 'local') return 0;
  try {
    const raw = localStorage.getItem(subtitleDelayKey(videoId, subtitleId));
    if (raw !== null) {
      const delay: unknown = JSON.parse(raw);
      return typeof delay === 'number' && Number.isFinite(delay) && Math.abs(delay) <= 86400
        ? delay
        : 0;
    }
    // Preserve an older video's delay only for the subtitle it was saved with.
    const legacy = readPreferences(videoId);
    return legacy.subtitleId === subtitleId ? legacy.offset : 0;
  } catch {
    // Unavailable or corrupt browser storage starts this pair at original timing.
    return 0;
  }
}

export function writeSubtitleDelay(videoId: string, subtitleId: string, delay: number): void {
  if (subtitleId === 'off' || subtitleId === 'local') return;
  if (!Number.isFinite(delay) || Math.abs(delay) > 86400) return;
  try {
    localStorage.setItem(subtitleDelayKey(videoId, subtitleId), JSON.stringify(delay));
  } catch {
    /* Timing controls continue to work when storage is blocked. */
  }
}
