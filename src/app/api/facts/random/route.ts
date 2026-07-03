// GET /api/facts/random — a random PUBLISHED fact as JSON (no redirect).
// For clients that want the fact data directly rather than following a
// browser redirect; see /facts/random for the redirect-based route.

import { NextResponse, type NextRequest } from "next/server";
import { getRandomFact } from "@/server/facts/queries";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const excludeSlug = request.nextUrl.searchParams.get("exclude") ?? undefined;
  try {
    const fact = await getRandomFact({ excludeSlug });
    return NextResponse.json({ fact });
  } catch (error) {
    console.error("[api/facts/random] failed to load a random fact", error);
    return NextResponse.json({ fact: null }, { status: 500 });
  }
}
