// Global search API — Postgres-backed (full-text + pg_trgm), no external
// search service. Returns a flat ranked result list; short/empty queries
// return an empty result set so pages never depend on search availability.
// Rate limited, production-safe errors, query length capped server-side.
//
// GET /api/search?q=spain&type=player,match&year=2026&limit=20

import { NextResponse } from "next/server";
import { createApiErrorResponse } from "@/server/security/api-errors";
import { enforceRateLimit } from "@/server/security/rate-limit";
import {
  MIN_QUERY_LENGTH,
  sanitizeSearchQuery,
  searchDocuments,
} from "@/server/search/postgresSearch";
import type { SearchApiResponse } from "@/server/search/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const limited = enforceRateLimit("search", request);
  if (limited !== null) return limited;

  const url = new URL(request.url);
  const query = sanitizeSearchQuery(url.searchParams.get("q") ?? "");
  if (query.length < MIN_QUERY_LENGTH) {
    const empty: SearchApiResponse = { query, count: 0, results: [] };
    return NextResponse.json(empty);
  }

  const rawLimit = Number(url.searchParams.get("limit"));
  const limit =
    Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : undefined;
  const rawYear = Number(url.searchParams.get("year"));
  const year = Number.isInteger(rawYear) && rawYear > 0 ? rawYear : undefined;
  const entityTypes = (url.searchParams.get("type") ?? "")
    .split(",")
    .map((type) => type.trim())
    .filter((type) => type !== "");

  try {
    const results = await searchDocuments({
      query,
      limit,
      year,
      entityTypes: entityTypes.length > 0 ? entityTypes : undefined,
    });
    const response: SearchApiResponse = {
      query,
      count: results.length,
      results,
    };
    return NextResponse.json(response);
  } catch (error) {
    return createApiErrorResponse({
      message: "Search is temporarily unavailable. Please try again shortly.",
      status: 503,
      error,
    });
  }
}
