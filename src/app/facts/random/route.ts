// GET /facts/random — redirects to a random PUBLISHED fact. Powers the
// "Surprise Me" buttons. Falls back to /facts on any error or if no facts
// exist yet; never exposes unpublished facts.

import { NextResponse, type NextRequest } from "next/server";
import { getRandomFact } from "@/server/facts/queries";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const excludeSlug = request.nextUrl.searchParams.get("exclude") ?? undefined;

  try {
    const fact = await getRandomFact({ excludeSlug });
    const destination = fact !== null ? `/facts/${fact.slug}` : "/facts";
    return NextResponse.redirect(new URL(destination, request.url));
  } catch (error) {
    console.error("[facts] failed to load a random fact", error);
    return NextResponse.redirect(new URL("/facts", request.url));
  }
}
