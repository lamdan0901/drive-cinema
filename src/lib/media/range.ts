import { ApiError } from '@/lib/errors';
export function validateRange(value: string | null): string | null {
  if (value === null) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(value);
  const bad = () => {
    throw new ApiError(400, 'INVALID_RANGE', 'Only one valid byte range is supported.');
  };
  if (!m || (!m[1] && !m[2])) return bad();
  const a = m[1] ? Number(m[1]) : undefined,
    b = m[2] ? Number(m[2]) : undefined;
  if (
    (a !== undefined && !Number.isSafeInteger(a)) ||
    (b !== undefined && !Number.isSafeInteger(b)) ||
    (a !== undefined && b !== undefined && b < a) ||
    (a === undefined && b === 0)
  )
    return bad();
  return value;
}
