export interface PinnedFolder {
  id: string;
  name: string;
  path: { id: string; name: string }[];
}
const key = (accountId: string) => 'drive-cinema:pins:' + accountId;
export function readPins(accountId: string): PinnedFolder[] {
  try {
    const raw = localStorage.getItem(key(accountId));
    if (!raw) return [];
    const pins = JSON.parse(raw);
    if (!Array.isArray(pins)) return [];
    return pins.filter(
      (pin) =>
        pin &&
        typeof pin.id === 'string' &&
        /^[\w-]{1,200}$/.test(pin.id) &&
        typeof pin.name === 'string' &&
        Array.isArray(pin.path) &&
        pin.path.length > 0 &&
        pin.path.every(
          (part: { id?: unknown; name?: unknown } | null) =>
            part &&
            typeof part.id === 'string' &&
            /^[\w-]{1,200}$/.test(part.id) &&
            typeof part.name === 'string',
        ) &&
        pin.path.at(-1).id === pin.id,
    );
  } catch {
    // Missing, corrupt, or blocked browser storage starts with no shortcuts.
    return [];
  }
}
export function writePins(accountId: string, pins: PinnedFolder[]): void {
  localStorage.setItem(key(accountId), JSON.stringify(pins));
}
