// GET|POST /api/cron/generate-fact-rotations — protected Discovery Vault
// rotation-schedule generator.
//
// Auth: CRON_SECRET (see src/server/security/cron.ts). Generates (upserts)
// the next 72 hourly FactRotation slots starting at the current UTC hour.
// Safe to run repeatedly — each slot is keyed by its unique slotStartAt, so
// re-running just re-plans the same rolling window. See
// docs/DISCOVERY_VAULT.md for the selection rules.

import { NextResponse } from "next/server";
import { createApiErrorResponse } from "@/server/security/api-errors";
import { isAuthorizedCronRequest } from "@/server/security/cron";
import {
  DEFAULT_SLOT_COUNT,
  generateFactRotationSlots,
} from "@/server/facts/rotationSchedule";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(request: Request): Promise<NextResponse> {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const summary = await generateFactRotationSlots(
      new Date(),
      DEFAULT_SLOT_COUNT,
    );
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    return createApiErrorResponse({
      message: "Fact rotation generation failed.",
      status: 500,
      error,
      developmentDetail: false,
    });
  }
}

export const GET = handle;
export const POST = handle;
