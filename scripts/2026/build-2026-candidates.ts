// Builds per-source candidate files from the raw snapshots in data/2026/raw/.
// Extraction only — no merging, no database writes. Records keep their
// source refs; unparseable rows land in each file's errors array.
//
// Usage:
//   pnpm data:2026:candidates

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildCandidatesFromRaw } from "../../src/server/agents/worldcup2026/extractor";
import { buildBustamiCandidates } from "../../src/server/agents/worldcup2026/providers/bustamiEfiDataset";
import { buildMominulCandidates } from "../../src/server/agents/worldcup2026/providers/mominulDataset";
import {
  BUSTAMI_CANDIDATES_DIR,
  CANDIDATES_2026_DIR,
  MOMINUL_CANDIDATES_DIR,
  RAW_2026_DIR,
} from "../../src/server/agents/worldcup2026/sourceRegistry";
import type {
  CandidateFile,
  CandidateParseError,
  ProviderCandidateFile,
  StewardDataKind,
} from "../../src/server/agents/worldcup2026/types";

/** teams.csv → teams.candidates.json (provider candidate file naming). */
function providerCandidateFileName(sourceFile: string): string {
  return `${sourceFile.replace(/\.[^.]+$/, "")}.candidates.json`;
}

/** Writes one candidates file per parsed provider source file. No DB writes. */
async function writeProviderCandidates(
  dir: string,
  files: ProviderCandidateFile[],
): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const file of files) {
    await writeFile(
      path.join(dir, providerCandidateFileName(file.sourceFile)),
      `${JSON.stringify(file, null, 2)}\n`,
      "utf8",
    );
  }
}

async function writeCandidateFile<T>(
  fileName: string,
  kind: StewardDataKind,
  records: T[],
  errors: CandidateParseError[],
): Promise<void> {
  const payload: CandidateFile<T> = {
    kind,
    generatedAt: new Date().toISOString(),
    records,
    errors,
  };
  await writeFile(
    path.join(CANDIDATES_2026_DIR, fileName),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
}

async function main() {
  console.log("WORLDCUP Nexus — 2026 data steward: build candidates\n");
  console.log(`Reading raw snapshots from: ${RAW_2026_DIR}`);
  console.log(`Writing candidates to:      ${CANDIDATES_2026_DIR}\n`);

  const extracted = await buildCandidatesFromRaw();
  await mkdir(CANDIDATES_2026_DIR, { recursive: true });

  const errorsFor = (endpointPrefix: RegExp): CandidateParseError[] =>
    extracted.errors.filter((error) => endpointPrefix.test(error.endpointId));

  await writeCandidateFile(
    "teams.candidates.json",
    "teams",
    extracted.teams,
    errorsFor(/teams/),
  );
  await writeCandidateFile(
    "groups.candidates.json",
    "groups",
    extracted.groups,
    errorsFor(/groups/),
  );
  await writeCandidateFile(
    "venues.candidates.json",
    "venues",
    extracted.venues,
    errorsFor(/stadi/),
  );
  await writeCandidateFile(
    "matches.candidates.json",
    "matches",
    extracted.matches,
    errorsFor(/games|cup-txt|worldcup-json/),
  );
  await writeCandidateFile(
    "standings.candidates.json",
    "standings",
    extracted.standings,
    [],
  );

  // Candidate-provider files (Mominul / Bustami EFI): one candidates file per
  // parsed source file, under data/2026/candidates/mominul|bustami/. Candidate
  // output only — never merged into the archive, never imported.
  const mominulFiles = await buildMominulCandidates();
  await writeProviderCandidates(MOMINUL_CANDIDATES_DIR, mominulFiles);
  const bustamiFiles = await buildBustamiCandidates();
  await writeProviderCandidates(BUSTAMI_CANDIDATES_DIR, bustamiFiles);

  const providerRowCount = (files: ProviderCandidateFile[]): number =>
    files.reduce((sum, file) => sum + file.records.length, 0);
  console.log(
    `Mominul provider:  ${mominulFiles.length} files, ${providerRowCount(mominulFiles)} candidate rows`,
  );
  console.log(
    `Bustami provider:  ${bustamiFiles.length} files, ${providerRowCount(bustamiFiles)} candidate rows`,
  );

  console.log(`Teams found:     ${extracted.teams.length}`);
  console.log(`Groups found:    ${extracted.groups.length}`);
  console.log(`Venues found:    ${extracted.venues.length}`);
  console.log(`Matches found:   ${extracted.matches.length}`);
  console.log(`Standings found: ${extracted.standings.length}`);
  console.log(`Parse errors:    ${extracted.errors.length}`);

  if (extracted.errors.length > 0) {
    console.log("\nFirst parse errors:");
    for (const error of extracted.errors.slice(0, 10)) {
      console.log(
        `  - ${error.sourceId}/${error.endpointId} ${error.ref}: ${error.message}`,
      );
    }
  }
}

main().catch((error) => {
  console.error("Candidate build crashed unexpectedly:", error);
  process.exitCode = 1;
});
