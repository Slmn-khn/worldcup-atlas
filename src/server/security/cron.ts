// Shared auth check for internal cron-triggered routes (Vercel Cron or a
// manual call). One secret (`CRON_SECRET`) gates every /api/cron/* route.
//
// Auth: `Authorization: Bearer <secret>` (Vercel Cron sets this automatically
// when CRON_SECRET is configured) or `?secret=<secret>`. With no secret
// configured, every cron route is disabled — fail closed, never open.

import { timingSafeEqual } from "node:crypto";

export function isAuthorizedCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret === undefined || secret === "") return false;

  const provided = extractCronSecret(request);
  if (provided === null) return false;
  return safeEqual(provided, secret);
}

function extractCronSecret(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth !== null) {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (match !== null) return match[1].trim();
  }
  const fromQuery = new URL(request.url).searchParams.get("secret");
  return fromQuery !== null && fromQuery !== "" ? fromQuery : null;
}

/** Length-safe, constant-time string comparison. */
function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
