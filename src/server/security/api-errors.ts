// Production-safe API error responses (Checkpoint 8B, P0.1).
//
// API routes must never echo internal error messages to clients in
// production: Prisma/database connectivity errors can include the DB
// host/port. The full error is always logged server-side; the `detail`
// field is attached only in development.

import { NextResponse } from "next/server";

export function isDevelopment(): boolean {
  return process.env.NODE_ENV === "development";
}

/**
 * Builds a JSON error response with a stable public `message`. The
 * underlying error is logged via `console.error` (platform logs keep the
 * diagnostics) and surfaced as `detail` only in development.
 */
export function createApiErrorResponse({
  message,
  status,
  error,
  developmentDetail = true,
}: {
  message: string;
  status: number;
  error?: unknown;
  developmentDetail?: boolean;
}): NextResponse {
  if (error !== undefined) {
    console.error(`[api] ${status} ${message}`, error);
  }

  const body: { error: string; detail?: string } = { error: message };
  if (developmentDetail && isDevelopment() && error !== undefined) {
    body.detail = error instanceof Error ? error.message : String(error);
  }

  return NextResponse.json(body, { status });
}
