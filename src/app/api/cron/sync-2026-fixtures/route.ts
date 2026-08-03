// POST|GET /api/cron/sync-2026-fixtures — protected fixture sync trigger.
//
// Post-tournament archive mode (FEATURE_2026_FIXTURE_SYNC not "true", the
// default): the route acknowledges with 200 `{ ok, disabled }` and does no
// work — no provider fetch, no FixtureSyncLog write — so a still-scheduled
// cron never fails. Set the flag to "true" to restore live sync.
//
// Auth: CRON_SECRET via `Authorization: Bearer <secret>` (Vercel Cron sets this
// automatically) or `?secret=<secret>`. Missing/invalid → 401. Safe to run
// repeatedly (sync upserts). Provider errors are sanitized inside the summary,
// so no provider URL/secret is ever returned.

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createApiErrorResponse } from "@/server/security/api-errors";
import { isFixtureSyncEnabled } from "@/config/features";
import { prisma } from "@/server/db/prisma";
import { syncFixtures2026 } from "@/server/fixtures/sync";

export const dynamic = "force-dynamic";
// Provider fetches can take several seconds; give the function room.
export const maxDuration = 60;

async function handle(request: Request): Promise<NextResponse> {
  if (!isFixtureSyncEnabled()) {
    return NextResponse.json({
      ok: true,
      disabled: true,
      message:
        "2026 fixture sync is disabled because the tournament is in archive mode.",
    });
  }

  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const summary = await syncFixtures2026(prisma);
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    // Whole-sync failure (e.g. DB down). syncFixtures2026 already isolates
    // per-provider failures, so reaching here is rare.
    return createApiErrorResponse({
      message: "Fixture sync failed.",
      status: 500,
      error,
      developmentDetail: false,
    });
  }
}

export const GET = handle;
export const POST = handle;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // Fail closed: with no secret configured, the route is disabled.
  if (secret === undefined || secret === "") return false;

  const provided = extractSecret(request);
  if (provided === null) return false;
  return safeEqual(provided, secret);
}

function extractSecret(request: Request): string | null {
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
