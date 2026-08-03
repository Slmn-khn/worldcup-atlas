// Manual 2026 fixture sync. Loads env, runs the provider sync, prints a clean
// summary. Exits non-zero only when every attempted provider failed (so an
// OpenFootball-only setup with worldcup26 unreachable still succeeds).
//
// Post-tournament archive mode: unless FEATURE_2026_FIXTURE_SYNC="true" or
// `--force` is passed, the script prints a notice and exits 0 without touching
// any provider or the database. Re-run for a future tournament with:
//   FEATURE_2026_FIXTURE_SYNC=true pnpm fixtures:sync
//   pnpm fixtures:sync -- --force
//
// Uses createScriptPrismaClient (relative imports) so it runs under tsx without
// "@/" alias resolution; syncFixtures2026 takes the client as a parameter.

import "dotenv/config";

import { createScriptPrismaClient } from "../import/utils/db";
import { isFixtureSyncEnabled } from "../../src/config/features";
import { syncFixtures2026 } from "../../src/server/fixtures/sync";

async function main() {
  console.log("WORLDCUP Nexus — 2026 fixture sync\n");

  const force = process.argv.includes("--force");
  if (!isFixtureSyncEnabled() && !force) {
    console.log(
      "2026 fixture sync is disabled. Set FEATURE_2026_FIXTURE_SYNC=true to run manually.",
    );
    console.log("(Or override once with: pnpm fixtures:sync -- --force)");
    return;
  }
  if (force && !isFixtureSyncEnabled()) {
    console.log("--force passed — running despite the disabled sync flag.\n");
  }

  const prisma = createScriptPrismaClient();

  try {
    const summary = await syncFixtures2026(prisma);

    console.log(`Mode: ${summary.mode}`);
    console.log(
      `Providers: ${summary.providersSucceeded}/${summary.providersAttempted} succeeded`,
    );
    console.log(`Records fetched:  ${summary.recordsFetched}`);
    console.log(`Records upserted: ${summary.recordsUpserted}\n`);

    // When the baseline succeeded, a worldcup26 failure is a soft fallback.
    const hasBaseline = summary.outcomes.some(
      (outcome) => outcome.status === "ok",
    );

    for (const outcome of summary.outcomes) {
      let line: string;
      switch (outcome.status) {
        case "ok":
          line = `[OK]   ${outcome.provider} — ${outcome.recordsUpserted} upserted`;
          break;
        case "warning":
          line = hasBaseline
            ? `[WARN] ${outcome.provider} unavailable — falling back to OpenFootball baseline.`
            : `[WARN] ${outcome.provider} unavailable — ${outcome.error ?? "unknown error"}`;
          break;
        case "skipped":
          line = `[SKIP] ${outcome.provider} — ${outcome.skippedReason ?? "not run"}`;
          break;
        case "failed":
        default:
          line = `[FAIL] ${outcome.provider} — ${outcome.error ?? "unknown error"}`;
          break;
      }
      console.log(`  ${line}`);
    }

    // Fail only if every provider that actually ran failed.
    if (summary.providersAttempted > 0 && summary.providersSucceeded === 0) {
      console.error("\nAll providers failed.");
      process.exitCode = 1;
    } else {
      console.log("\nSync complete.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(
    "\nSync failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
