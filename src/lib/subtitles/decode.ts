export const SUBTITLE_LIMIT = 2 * 1024 * 1024;
export function decodeSubtitle(bytes: Uint8Array, encoding: 'utf-8' | 'windows-1258'): string {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    throw new Error('Cannot decode this subtitle. Try a different text encoding.');
  }
}
