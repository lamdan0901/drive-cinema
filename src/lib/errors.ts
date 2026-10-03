import 'server-only';
import { NextResponse } from 'next/server';
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function errorResponse(error: unknown): NextResponse {
  const known = error instanceof ApiError;
  return NextResponse.json(
    {
      error: known ? error.message : 'Something went wrong. Please try again.',
      code: known ? error.code : 'INTERNAL_ERROR',
    },
    { status: known ? error.status : 500, headers: { 'Cache-Control': 'private, no-store' } },
  );
}
export const expired = () =>
  new ApiError(401, 'SESSION_EXPIRED', 'Your Google session expired. Sign in again.');
