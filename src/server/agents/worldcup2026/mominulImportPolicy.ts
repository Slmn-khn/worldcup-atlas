// Source-lock policy for the 2026 archive import: ONLY the Mominul FIFA World
// Cup 2026 Dataset may be imported. The policy file is a human-owned approval
// artifact under data/2026/approved/; this module validates it structurally
// AND semantically — the importer refuses to run unless every invariant below
// holds, so a hand-edited policy can never quietly widen the import surface.
//
// Relative runtime imports only (no "@/" alias) so tsx scripts can load it.

import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { DATA_2026_DIR } from "./sourceRegistry";

export const MOMINUL_IMPORT_POLICY_PATH = path.join(
  DATA_2026_DIR,
  "approved",
  "mominul-import-policy.json",
);

/** The one source this import pipeline is allowed to touch. */
export const MOMINUL_IMPORT_SOURCE_ID = "mominul_2026_dataset";

/** Logical source-file names the user approved for import. */
export const MOMINUL_APPROVED_FILE_KEYS = [
  "teams",
  "venues",
  "tournament_stages",
  "referees",
  "matches",
  "matches_detailed",
  "squads_and_players",
  "match_events",
  "match_team_stats",
  "match_lineups",
  "player_stats",
] as const;

/** Sources/files that must be explicitly excluded for the policy to be valid. */
export const MOMINUL_REQUIRED_EXCLUSIONS = [
  "match_prediction_features",
  "bustami_efi",
  "openfootball",
  "worldcup26_live",
  "manual_pack_values",
] as const;

export const mominulImportPolicySchema = z
  .object({
    schema: z.literal("mominul-import-policy/v1"),
    sourceId: z.string().min(1),
    status: z.string().min(1),
    approvedFor: z.array(z.string().min(1)),
    excludedFromImport: z.array(z.string().min(1)),
    rules: z.array(z.string()),
  })
  .loose();

export type MominulImportPolicy = z.infer<typeof mominulImportPolicySchema>;

export type PolicyCheckResult =
  | { ok: true; policy: MominulImportPolicy }
  | { ok: false; errors: string[] };

/**
 * Semantic validation on top of the zod structure. Every failure is a hard
 * stop for the importer — never a warning.
 */
export function checkMominulImportPolicy(raw: unknown): PolicyCheckResult {
  const parsed = mominulImportPolicySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: [`Policy file is malformed: ${parsed.error.message}`],
    };
  }
  const policy = parsed.data;
  const errors: string[] = [];

  if (policy.sourceId !== MOMINUL_IMPORT_SOURCE_ID) {
    errors.push(
      `Policy sourceId must be "${MOMINUL_IMPORT_SOURCE_ID}" (got "${policy.sourceId}").`,
    );
  }
  if (policy.status !== "APPROVED_BY_USER") {
    errors.push(
      `Policy status must be "APPROVED_BY_USER" (got "${policy.status}").`,
    );
  }
  for (const key of MOMINUL_APPROVED_FILE_KEYS) {
    if (!policy.approvedFor.includes(key)) {
      errors.push(`Policy approvedFor is missing "${key}".`);
    }
  }
  for (const exclusion of MOMINUL_REQUIRED_EXCLUSIONS) {
    if (!policy.excludedFromImport.includes(exclusion)) {
      errors.push(`Policy excludedFromImport is missing "${exclusion}".`);
    }
  }
  // The exclusion list must never leak into the approval list.
  for (const approved of policy.approvedFor) {
    if (
      (MOMINUL_REQUIRED_EXCLUSIONS as readonly string[]).includes(approved)
    ) {
      errors.push(`"${approved}" is excluded and cannot be in approvedFor.`);
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, policy };
}

/** Loads and validates the policy file. Missing file → hard error. */
export async function loadMominulImportPolicy(
  filePath: string = MOMINUL_IMPORT_POLICY_PATH,
): Promise<PolicyCheckResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    return {
      ok: false,
      errors: [
        `Cannot read import policy at ${filePath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
    };
  }
  return checkMominulImportPolicy(raw);
}
