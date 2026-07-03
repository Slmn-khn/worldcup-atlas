// GET /api/facts/hourly — the current Discovery Vault "Fact of the Hour" as
// JSON. Only ever returns PUBLISHED facts; no internal-only fields (status,
// verificationStatus, rotationWeight, …) are included.

import { NextResponse } from "next/server";
import { getHourlyFact } from "@/server/facts/rotation";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await getHourlyFact();
    if (result === null) {
      return NextResponse.json({ fact: null, nextRotationAt: null });
    }
    return NextResponse.json({
      fact: result.fact,
      nextRotationAt: result.nextRotationAt.toISOString(),
    });
  } catch (error) {
    console.error("[api/facts/hourly] failed to load hourly fact", error);
    return NextResponse.json(
      { fact: null, nextRotationAt: null },
      { status: 500 },
    );
  }
}
