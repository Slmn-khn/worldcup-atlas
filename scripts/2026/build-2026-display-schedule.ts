// Builds data/2026/approved/finalized/display-schedule.json — the display
// artifact behind /schedule/2026 in archive mode.
//
// Reads the manual verified reference pack (plus approved finalized matches
// and approved review decisions when present), builds display rows, and
// writes the artifact with generation metadata. Unresolved rows are marked
// RESULT_UNDER_REVIEW — never fabricated, never "SCHEDULED".
//
// Guardrails: file-in/file-out only. No database writes, no network, no
// provider calls. This artifact is NOT an import approval — the approval gate
// in data/2026/approved/README.md (approval.json) is untouched.
//
// Usage: pnpm data:2026:display-schedule

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  approvedGapFills,
  buildArchivedScheduleRows,
  buildArchivedScheduleResult,
  FINALIZED_2026_DIR,
  REVIEW_DECISIONS_2026_PATH,
  reviewDecisionsFileSchema,
  type DisplayScheduleFile,
} from "../../src/server/worldcup2026/archiveSchedule";
import {
  loadManualReferencePack,
  packMatchesFileSchema,
} from "../../src/server/agents/worldcup2026/manualReferencePack";

async function readJsonIfExists(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  console.log("WORLDCUP Nexus — 2026 display schedule builder\n");

  const warnings: string[] = [];

  const packResult = await loadManualReferencePack();
  if (packResult === null) {
    console.error("No manual verified reference pack found — nothing to build.");
    process.exitCode = 1;
    return;
  }
  if (!packResult.ok) {
    console.error("Reference pack failed validation:");
    for (const error of packResult.errors) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }
  const pack = packResult.pack;
  warnings.push(...packResult.warnings);

  // Source order: approved finalized matches (if present and valid) beat the
  // reference pack; otherwise the pack is the base plus approved gap-fills.
  let matches = pack.matches;
  let officialCount = pack.officialMatchCount;
  let sourceLabel = `reference pack ${pack.manifest.packId}`;
  const finalizedRaw = await readJsonIfExists(
    path.join(FINALIZED_2026_DIR, "matches.json"),
  );
  if (finalizedRaw !== null) {
    const parsed = packMatchesFileSchema.safeParse(finalizedRaw);
    if (parsed.success) {
      matches = parsed.data.matches;
      officialCount = parsed.data.official_match_count;
      sourceLabel = "approved/finalized/matches.json";
    } else {
      warnings.push(
        "approved/finalized/matches.json present but invalid — ignored.",
      );
    }
  }

  let gapFills = new Map<string, (typeof matches)[number]>();
  const decisionsRaw = await readJsonIfExists(REVIEW_DECISIONS_2026_PATH);
  if (decisionsRaw !== null) {
    const parsed = reviewDecisionsFileSchema.safeParse(decisionsRaw);
    if (parsed.success) {
      gapFills = approvedGapFills(parsed.data);
    } else {
      warnings.push("review-decisions.json present but invalid — ignored.");
    }
  }

  const rows = buildArchivedScheduleRows(matches, pack, gapFills);
  const result = buildArchivedScheduleResult(rows, officialCount);

  const artifact: DisplayScheduleFile = {
    schema: "display-schedule/v1",
    generatedAt: new Date().toISOString(),
    sourcePack: pack.manifest.packId,
    sourcePackHash: pack.packHash,
    officialMatchCount: result.totalOfficialMatches,
    capturedMatchCount: result.capturedMatches,
    unresolvedCount: result.unresolvedCount,
    verifiedCount: result.verifiedCount,
    warnings,
    rows,
  };

  await mkdir(FINALIZED_2026_DIR, { recursive: true });
  const outPath = path.join(FINALIZED_2026_DIR, "display-schedule.json");
  await writeFile(outPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  console.log(`Source: ${sourceLabel}`);
  console.log(`Official matches: ${result.totalOfficialMatches}`);
  console.log(`Captured rows:    ${result.capturedMatches}`);
  console.log(`Verified rows:    ${result.verifiedCount}`);
  console.log(`Under review:     ${result.unresolvedCount}`);
  if (gapFills.size > 0) {
    console.log(`Approved gap-fills applied: ${gapFills.size}`);
  }
  for (const warning of warnings) console.log(`  [WARN] ${warning}`);
  console.log(`\nWrote ${outPath}`);
}

main().catch((error) => {
  console.error(
    "\nDisplay schedule build failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
