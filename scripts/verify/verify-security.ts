// Security hardening verification (Checkpoint 8B). Exercises the security
// helpers directly — no database required.
//
// Usage: pnpm security:verify

import "dotenv/config";

import {
  RATE_LIMITS,
  checkRateLimit,
  getClientIp,
  rateLimitHeaders,
} from "@/server/security/rate-limit";
import { createApiErrorResponse } from "@/server/security/api-errors";
import { toCsvValue } from "@/server/exports/csv";
import { MAX_QUERY_LENGTH } from "@/server/search/postgresSearch";

type Check = { name: string; passed: boolean; detail: string };
const checks: Check[] = [];

function check(name: string, passed: boolean, detail: string): void {
  checks.push({ name, passed, detail });
}

async function main() {
  console.log("WORLDCUP Nexus — security verification\n");

  // --- Rate limiter -------------------------------------------------------
  const now = Date.now();
  const ip = "203.0.113.7"; // TEST-NET-3 address, never a real client
  const limit = RATE_LIMITS.search.limit;
  let denied = 0;
  let lastRemaining = -1;
  for (let i = 0; i < limit + 5; i += 1) {
    const result = checkRateLimit("search", ip, now);
    if (!result.allowed) denied += 1;
    lastRemaining = result.remaining;
  }
  check(
    "rate limit denies after limit is exceeded",
    denied === 5 && lastRemaining === 0,
    `${limit} allowed, ${denied} denied of ${limit + 5} calls`,
  );

  const deniedResult = checkRateLimit("search", ip, now);
  check(
    "denied result reports positive Retry-After",
    !deniedResult.allowed && deniedResult.retryAfterSeconds > 0,
    `retryAfterSeconds=${deniedResult.retryAfterSeconds}, resetAt=${deniedResult.resetAt}`,
  );
  const headers = rateLimitHeaders(deniedResult);
  check(
    "rate limit headers are well-formed",
    headers["X-RateLimit-Limit"] === String(limit) &&
      headers["X-RateLimit-Remaining"] === "0" &&
      Number(headers["X-RateLimit-Reset"]) > 0,
    JSON.stringify(headers),
  );

  // Window reset: same key, one window later, is allowed again.
  const afterWindow = checkRateLimit(
    "search",
    ip,
    now + RATE_LIMITS.search.windowMs,
  );
  check(
    "rate limit window resets",
    afterWindow.allowed && afterWindow.remaining === limit - 1,
    `allowed again after ${RATE_LIMITS.search.windowMs}ms window`,
  );

  check(
    "export limit is stricter than search/explorer",
    RATE_LIMITS.export.limit < RATE_LIMITS.search.limit &&
      RATE_LIMITS.export.limit < RATE_LIMITS.explorer.limit,
    `export ${RATE_LIMITS.export.limit}/min vs search ${RATE_LIMITS.search.limit}/min, explorer ${RATE_LIMITS.explorer.limit}/min`,
  );

  // Unknown IP: no proxy headers at all must still work (shared bucket).
  const unknownIp = getClientIp(new Headers());
  const unknownResult = checkRateLimit("health", unknownIp, now);
  check(
    "unknown IP is handled safely",
    unknownIp === "unknown" && unknownResult.allowed,
    `ip="${unknownIp}", allowed=${unknownResult.allowed}`,
  );
  check(
    "client IP comes from proxy headers (first XFF hop)",
    getClientIp(
      new Headers({ "x-forwarded-for": "198.51.100.4, 10.0.0.1" }),
    ) === "198.51.100.4" &&
      getClientIp(new Headers({ "x-real-ip": "198.51.100.9" })) ===
        "198.51.100.9" &&
      getClientIp(new Headers({ "cf-connecting-ip": "198.51.100.12" })) ===
        "198.51.100.12",
    "x-forwarded-for, x-real-ip, cf-connecting-ip all resolved",
  );

  // --- API error responses ------------------------------------------------
  // NODE_ENV is controlled per-assertion; tsx runs this file outside Next,
  // so mutating it here affects only this process.
  const env = process.env as { NODE_ENV?: string };
  const originalNodeEnv = env.NODE_ENV;
  const sensitiveError = new Error(
    "connect ECONNREFUSED internal-db.local:5432",
  );
  console.log(
    "(the two [api] error logs below are synthetic — the helper always logs server-side)\n",
  );

  env.NODE_ENV = "production";
  const prodResponse = createApiErrorResponse({
    message: "Search is temporarily unavailable.",
    status: 503,
    error: sensitiveError,
  });
  const prodBody = (await prodResponse.json()) as Record<string, unknown>;
  check(
    "production error response omits detail",
    prodResponse.status === 503 &&
      prodBody.error === "Search is temporarily unavailable." &&
      !("detail" in prodBody) &&
      !JSON.stringify(prodBody).includes("internal-db"),
    JSON.stringify(prodBody),
  );

  env.NODE_ENV = "development";
  const devResponse = createApiErrorResponse({
    message: "Search is temporarily unavailable.",
    status: 503,
    error: sensitiveError,
  });
  const devBody = (await devResponse.json()) as Record<string, unknown>;
  check(
    "development error response includes detail",
    devResponse.status === 503 &&
      typeof devBody.detail === "string" &&
      devBody.detail.includes("ECONNREFUSED"),
    JSON.stringify(devBody),
  );
  env.NODE_ENV = originalNodeEnv;

  // --- CSV formula-injection guard ----------------------------------------
  check(
    "CSV helper neutralizes formula cells",
    toCsvValue("=cmd()") === "'=cmd()" &&
      toCsvValue("+SUM(A1:A2)") === "'+SUM(A1:A2)" &&
      toCsvValue("-10+20") === "'-10+20" &&
      toCsvValue("@evil") === "'@evil",
    "=, +, -, @ prefixes neutralized",
  );
  check(
    "CSV helper leaves normal values alone",
    toCsvValue("3–2") === "3–2" && toCsvValue("Maradona") === "Maradona",
    "en-dash scores and names unchanged",
  );

  // --- Search query cap -----------------------------------------------------
  check(
    "search query length cap is configured",
    MAX_QUERY_LENGTH === 200,
    `MAX_QUERY_LENGTH=${MAX_QUERY_LENGTH}`,
  );

  // --- Security headers config ---------------------------------------------
  const nextConfig = (await import("../../next.config")).default;
  const headerRules =
    typeof nextConfig.headers === "function" ? await nextConfig.headers() : [];
  const allRouteRule = headerRules.find((rule) => rule.source === "/:path*");
  const headerKeys = (allRouteRule?.headers ?? []).map((header) => header.key);
  const requiredHeaders = [
    "X-Content-Type-Options",
    "Referrer-Policy",
    "X-Frame-Options",
    "Permissions-Policy",
    "Cross-Origin-Opener-Policy",
    "Cross-Origin-Resource-Policy",
    "Content-Security-Policy-Report-Only",
  ];
  const missingHeaders = requiredHeaders.filter(
    (key) => !headerKeys.includes(key),
  );
  check(
    "security headers configured for all routes",
    allRouteRule !== undefined && missingHeaders.length === 0,
    missingHeaders.length === 0
      ? `${requiredHeaders.length} headers on ${allRouteRule?.source}`
      : `missing: ${missingHeaders.join(", ")}`,
  );
  const csp = (allRouteRule?.headers ?? []).find(
    (header) => header.key === "Content-Security-Policy-Report-Only",
  )?.value;
  check(
    "Report-Only CSP has expected directives",
    typeof csp === "string" &&
      csp.includes("default-src 'self'") &&
      csp.includes("frame-ancestors 'none'") &&
      csp.includes("object-src 'none'"),
    csp ?? "no CSP found",
  );

  console.log("Checks");
  let failures = 0;
  for (const { name, passed, detail } of checks) {
    if (!passed) failures += 1;
    console.log(`  [${passed ? "PASS" : "FAIL"}] ${name} — ${detail}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} security check(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log("\nAll security checks passed.");
  }
}

main().catch((error) => {
  console.error(
    "\nSecurity verification failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
