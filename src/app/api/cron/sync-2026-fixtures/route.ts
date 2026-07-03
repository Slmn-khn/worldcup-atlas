// POST|GET /api/cron/sync-2026-fixtures — protected fixture sync trigger.
//
// Auth: CRON_SECRET via `Authorization: Bearer <secret>` (Vercel Cron sets this
// automatically) or `?secret=<secret>`. Missing/invalid → 401. Safe to run
// repeatedly (sync upserts). Provider errors are sanitized inside the summary,
// so no provider URL/secret is ever returned.

import { NextResponse } from "next/server";
import { createApiErrorResponse } from "@/server/security/api-errors";
import { isAuthorizedCronRequest } from "@/server/security/cron";
import { prisma } from "@/server/db/prisma";
import { syncFixtures2026 } from "@/server/fixtures/sync";

export const dynamic = "force-dynamic";
// Provider fetches can take several seconds; give the function room.
export const maxDuration = 60;

async function handle(request: Request): Promise<NextResponse> {
  if (!isAuthorizedCronRequest(request)) {
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
