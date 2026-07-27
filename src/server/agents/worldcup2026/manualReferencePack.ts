// Manual verified reference pack loader for the 2026 data steward agent.
//
// A reference pack is a HUMAN-AUTHENTICATED set of JSON files under
// data/2026/reference/<packId>/ with a manifest. It is the highest-priority
// reference source (registry id `manual_verified_2026_pack_v1`, priority 1)
// but it is NEVER imported directly: `importAllowed` is false in the
// manifest, records carry per-record `verification` levels, and only
// `verified` records are used as high-priority values — `reported` records
// are supporting evidence, `unverified` records never become final values.
//
// The loader is tolerant of partial data (that is the point of the pack —
// it records what a human could verify, including explicit gaps) but strict
// about structure: a malformed file is a hard error surfaced to the caller.
//
// No network, no database, no secrets. Everything is read from local files
// and hashed (sha256) so reports can pin the exact pack revision.

import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { sha256Hex } from "./collector";
import { DATA_2026_DIR } from "./sourceRegistry";
import type {
  CandidateGroup,
  CandidateMatch,
  CandidateStanding,
  CandidateTeam,
  CandidateVenue,
  ConflictEntry,
  RawSourceRef,
} from "./types";

export const MANUAL_PACK_SOURCE_ID = "manual_verified_2026_pack_v1";
export const MANUAL_PACK_DIR = `${DATA_2026_DIR}/reference/manual-verified-v1`;

// ---------------------------------------------------------------------------
// Zod schemas — tolerant about optional detail, strict about structure
// ---------------------------------------------------------------------------

export const manualVerificationSchema = z.enum([
  "verified",
  "reported",
  // Partially verified (e.g. a group table with confirmed teams but an
  // incomplete table) — treated like "reported": supporting evidence only.
  "partial",
  "unverified",
]);
export type ManualVerification = z.infer<typeof manualVerificationSchema>;

export const manifestSchema = z.object({
  packId: z.string().min(1),
  label: z.string().min(1),
  createdBy: z.string().min(1),
  createdAt: z.string().min(1),
  verificationLevel: z.string().min(1),
  importAllowed: z.boolean(),
  notes: z.array(z.string()).optional(),
  files: z.record(z.string(), z.string().min(1)),
});

export const packTournamentSchema = z
  .object({
    schema: z.string().optional(),
    id: z.string().optional(),
    name: z.string().min(1),
    hosts: z.array(z.string()).optional(),
    start_date: z.string().nullish(),
    end_date: z.string().nullish(),
    teams: z.number().int().optional(),
    matches: z.number().int().optional(),
    venues: z.number().int().optional(),
    champion: z.string().nullish(),
    runner_up: z.string().nullish(),
    third: z.string().nullish(),
    fourth: z.string().nullish(),
    verification: manualVerificationSchema.optional(),
    sources: z.array(z.string()).optional(),
  })
  .loose();

export const packTeamSchema = z
  .object({
    code: z.string().nullable(),
    name: z.string().nullable(),
    confederation: z.string().nullish(),
    verification: manualVerificationSchema,
    note: z.string().nullish(),
  })
  .loose();
export const packTeamsFileSchema = z.object({
  schema: z.string().optional(),
  teams: z.array(packTeamSchema),
});

const packTableRowSchema = z
  .object({
    pos: z.number().int().nullish(),
    team: z.string().min(1),
    pld: z.number().int(),
    w: z.number().int(),
    d: z.number().int(),
    l: z.number().int(),
    gf: z.number().int(),
    ga: z.number().int(),
    pts: z.number().int(),
  })
  .loose();

export const packGroupSchema = z
  .object({
    group: z.string().nullable(),
    // A null member is an unconfirmed slot (e.g. the unresolved 48th
    // participant) — tolerated and treated as an explicit gap.
    teams: z.array(z.string().nullable()),
    verification: manualVerificationSchema.optional(),
    group_letter_note: z.string().nullish(),
    final_table: z.array(packTableRowSchema).nullish(),
  })
  .loose();
export const packGroupsFileSchema = z.object({
  schema: z.string().optional(),
  groups: z.array(packGroupSchema),
});

export const packMatchSchema = z
  .object({
    match_id: z.string().min(1),
    stage: z.string().min(1),
    date: z.string().nullish(),
    home: z.string().nullish(),
    away: z.string().nullish(),
    score: z
      .object({
        home: z.number().int().nullable(),
        away: z.number().int().nullable(),
        extra_time: z.boolean().nullish(),
        penalties: z
          .object({
            home: z.number().int().nullable(),
            away: z.number().int().nullable(),
            winner: z.string().nullish(),
          })
          .nullish(),
      })
      .nullish(),
    winner: z.string().nullish(),
    venue_id: z.string().nullish(),
    notes: z.string().nullish(),
    verification: manualVerificationSchema,
    sources: z.array(z.string()).optional(),
  })
  .loose();
export const packMatchesFileSchema = z.object({
  schema: z.string().optional(),
  official_match_count: z.number().int(),
  captured_match_count: z.number().int(),
  matches: z.array(packMatchSchema),
});

export const packStandingsFileSchema = z.object({
  schema: z.string().optional(),
  final_standings: z.array(
    z
      .object({
        pos: z.number().int(),
        team: z.string().min(1),
        verification: manualVerificationSchema.optional(),
      })
      .loose(),
  ),
  group_tables: z.array(
    z
      .object({
        group: z.string().nullable(),
        teams: z.array(z.string()).optional(),
        table: z.array(packTableRowSchema).nullish(),
        verification: manualVerificationSchema.optional(),
      })
      .loose(),
  ),
});

export const packBracketFileSchema = z
  .object({
    schema: z.string().optional(),
    rounds: z.array(
      z.object({ round: z.string(), matches: z.array(z.string()) }).loose(),
    ),
    progression: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();

export const packVenueSchema = z
  .object({
    id: z.string().min(1),
    fifa_name: z.string().nullish(),
    stadium_name: z.string().nullish(),
    city: z.string().nullish(),
    country: z.string().nullish(),
    capacity_approx: z.number().int().nullish(),
    verification: manualVerificationSchema.optional(),
  })
  .loose();
export const packVenuesFileSchema = z.object({
  schema: z.string().optional(),
  venues: z.array(packVenueSchema),
});

export const packAwardSchema = z
  .object({
    winner: z.string().nullish(),
    team: z.string().nullish(),
    verification: manualVerificationSchema.optional(),
    sources: z.array(z.string()).optional(),
  })
  .loose();
export const packAwardsFileSchema = z.object({
  schema: z.string().optional(),
  awards: z.record(z.string(), packAwardSchema),
});

export const packSourcesFileSchema = z
  .object({
    schema: z.string().optional(),
    retrieved: z.string().optional(),
    sources: z.array(
      z
        .object({
          id: z.string().min(1),
          publisher: z.string().nullish(),
          url: z.string().nullish(),
          scope: z.array(z.string()).optional(),
        })
        .loose(),
    ),
  })
  .loose();

export const packConflictSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().nullish(),
    field: z.string().nullish(),
    description: z.string().nullish(),
    values: z
      .array(
        z.object({ source: z.string(), value: z.unknown() }).loose(),
      )
      .optional(),
    resolution: z.string().nullish(),
  })
  .loose();
export const packConflictsFileSchema = z.object({
  schema: z.string().optional(),
  conflicts: z.array(packConflictSchema),
});

// ---------------------------------------------------------------------------
// Loaded pack shape
// ---------------------------------------------------------------------------

export type ManualReferencePack = {
  dir: string;
  manifest: z.infer<typeof manifestSchema>;
  /** sha256 of each file body, keyed by manifest file key. */
  fileHashes: Record<string, string>;
  /** sha256 over the sorted per-file hashes — pins the whole pack revision. */
  packHash: string;
  tournament: z.infer<typeof packTournamentSchema> | null;
  teams: z.infer<typeof packTeamSchema>[];
  groups: z.infer<typeof packGroupSchema>[];
  matches: z.infer<typeof packMatchSchema>[];
  officialMatchCount: number;
  capturedMatchCount: number;
  standings: z.infer<typeof packStandingsFileSchema> | null;
  bracket: z.infer<typeof packBracketFileSchema> | null;
  venues: z.infer<typeof packVenueSchema>[];
  awards: Record<string, z.infer<typeof packAwardSchema>>;
  sources: z.infer<typeof packSourcesFileSchema> | null;
  conflicts: z.infer<typeof packConflictSchema>[];
};

export type ManualPackStats = {
  present: boolean;
  packId: string | null;
  packHash: string | null;
  filesLoaded: number;
  officialMatchCount: number;
  capturedMatchCount: number;
  verifiedMatches: number;
  unverifiedMatches: number;
  knownConflicts: number;
  verifiedTeams: number;
  unverifiedTeams: number;
  awardsPresent: boolean;
};

export function buildManualPackStats(
  pack: ManualReferencePack | null,
): ManualPackStats {
  if (pack === null) {
    return {
      present: false,
      packId: null,
      packHash: null,
      filesLoaded: 0,
      officialMatchCount: 0,
      capturedMatchCount: 0,
      verifiedMatches: 0,
      unverifiedMatches: 0,
      knownConflicts: 0,
      verifiedTeams: 0,
      unverifiedTeams: 0,
      awardsPresent: false,
    };
  }
  return {
    present: true,
    packId: pack.manifest.packId,
    packHash: pack.packHash,
    filesLoaded: Object.keys(pack.fileHashes).length,
    officialMatchCount: pack.officialMatchCount,
    capturedMatchCount: pack.capturedMatchCount,
    verifiedMatches: pack.matches.filter((m) => m.verification === "verified")
      .length,
    unverifiedMatches: pack.matches.filter(
      (m) => m.verification !== "verified",
    ).length,
    knownConflicts: pack.conflicts.length,
    verifiedTeams: pack.teams.filter((t) => t.verification === "verified")
      .length,
    unverifiedTeams: pack.teams.filter((t) => t.verification !== "verified")
      .length,
    awardsPresent: Object.keys(pack.awards).length > 0,
  };
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export type ManualPackLoadResult =
  | { ok: true; pack: ManualReferencePack; warnings: string[] }
  | { ok: false; errors: string[] };

async function readJson(dir: string, file: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(dir, file), "utf8"));
}

/**
 * Loads and structurally validates the manual reference pack. Returns
 * `{ok:false}` with precise errors when a file is malformed; missing OPTIONAL
 * detail (null scores, null group letters, unverified records) is fine and
 * only produces warnings. Returns null-equivalent when no manifest exists
 * (the pack is optional — the pipeline runs without it).
 */
export async function loadManualReferencePack(
  dir: string = MANUAL_PACK_DIR,
): Promise<ManualPackLoadResult | null> {
  let manifestRaw: unknown;
  try {
    manifestRaw = await readJson(dir, "manifest.json");
  } catch {
    return null; // no pack — perfectly valid state
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  const manifestParsed = manifestSchema.safeParse(manifestRaw);
  if (!manifestParsed.success) {
    return {
      ok: false,
      errors: [`manifest.json is malformed: ${manifestParsed.error.message}`],
    };
  }
  const manifest = manifestParsed.data;
  if (manifest.importAllowed) {
    // The reference pack must never masquerade as an import approval.
    errors.push(
      "manifest.importAllowed must be false — reference packs are never direct imports.",
    );
  }

  const fileHashes: Record<string, string> = {};
  const bodies: Record<string, string> = {};
  for (const [key, fileName] of Object.entries(manifest.files).sort()) {
    try {
      const body = await readFile(path.join(dir, fileName), "utf8");
      bodies[key] = body;
      fileHashes[key] = sha256Hex(body);
    } catch {
      errors.push(`Referenced file missing/unreadable: ${fileName} (${key}).`);
    }
  }

  const parseFile = <T>(
    key: string,
    schema: { safeParse: (input: unknown) => { success: boolean; data?: T; error?: { message: string } } },
  ): T | null => {
    const body = bodies[key];
    if (body === undefined) return null;
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch (error) {
      errors.push(
        `${manifest.files[key]} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success || parsed.data === undefined) {
      errors.push(
        `${manifest.files[key]} failed structural validation: ${parsed.error?.message ?? "unknown"}`,
      );
      return null;
    }
    return parsed.data;
  };

  const tournament = parseFile("tournament", packTournamentSchema);
  const teamsFile = parseFile("teams", packTeamsFileSchema);
  const groupsFile = parseFile("groups", packGroupsFileSchema);
  const matchesFile = parseFile("matches", packMatchesFileSchema);
  const standings = parseFile("standings", packStandingsFileSchema);
  const bracket = parseFile("bracket", packBracketFileSchema);
  const venuesFile = parseFile("venues", packVenuesFileSchema);
  const awardsFile = parseFile("awards", packAwardsFileSchema);
  const sources = parseFile("sources", packSourcesFileSchema);
  const conflictsFile = parseFile("conflicts", packConflictsFileSchema);

  if (errors.length > 0) return { ok: false, errors };

  // Review-required (not errors): explicit gaps the pack records honestly.
  const matches = matchesFile?.matches ?? [];
  if (
    matchesFile !== null &&
    matchesFile.captured_match_count < matchesFile.official_match_count
  ) {
    warnings.push(
      `Pack captures ${matchesFile.captured_match_count} of ` +
        `${matchesFile.official_match_count} official matches — partial coverage, review required.`,
    );
  }
  const unverifiedMatches = matches.filter((m) => m.verification !== "verified");
  if (unverifiedMatches.length > 0) {
    warnings.push(
      `${unverifiedMatches.length} matches are not fully verified ` +
        `(${unverifiedMatches.map((m) => m.match_id).join(", ")}) — supporting evidence only.`,
    );
  }
  const placeholderTeams = (teamsFile?.teams ?? []).filter(
    (team) => team.name === null || team.code === null,
  );
  if (placeholderTeams.length > 0) {
    warnings.push(
      `${placeholderTeams.length} team slot(s) are unconfirmed placeholders — never import these without review.`,
    );
  }
  const unknownLetterGroups = (groupsFile?.groups ?? []).filter(
    (group) => group.group === null,
  );
  if (unknownLetterGroups.length > 0) {
    warnings.push(
      `${unknownLetterGroups.length} group(s) have unconfirmed group letters — resolved against other sources by team-set matching.`,
    );
  }

  const pack: ManualReferencePack = {
    dir,
    manifest,
    fileHashes,
    packHash: sha256Hex(
      Object.entries(fileHashes)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, hash]) => `${key}:${hash}`)
        .join("\n"),
    ),
    tournament,
    teams: teamsFile?.teams ?? [],
    groups: groupsFile?.groups ?? [],
    matches,
    officialMatchCount: matchesFile?.official_match_count ?? 0,
    capturedMatchCount: matchesFile?.captured_match_count ?? 0,
    standings,
    bracket,
    venues: venuesFile?.venues ?? [],
    awards: awardsFile?.awards ?? {},
    sources,
    conflicts: conflictsFile?.conflicts ?? [],
  };

  return { ok: true, pack, warnings };
}

// ---------------------------------------------------------------------------
// Conversion into steward candidates (pure — unit-tested)
// ---------------------------------------------------------------------------

export type ManualPackCandidates = {
  teams: CandidateTeam[];
  groups: CandidateGroup[];
  venues: CandidateVenue[];
  matches: CandidateMatch[];
  /** Provider-style standings rows for derived-vs-reference comparison. */
  standings: CandidateStanding[];
  /** Pack conflicts converted into the steward conflict registry shape. */
  conflicts: ConflictEntry[];
  /** Groups whose letter could not be resolved against other sources. */
  unresolvedGroups: number;
};

function ref(endpointId: string, refValue: string): RawSourceRef {
  return { sourceId: MANUAL_PACK_SOURCE_ID, endpointId, ref: refValue };
}

const PACK_STAGE_TO_LABEL: Record<string, string> = {
  group: "group",
  round_of_32: "Round of 32",
  round_of_16: "Round of 16",
  quarterfinal: "Quarter-final",
  semifinal: "Semi-final",
  third_place: "Match for third place",
  final: "Final",
};

/** Maps a pack conflict onto a steward data kind by its field hint. */
export function packConflictEntityType(
  field: string | null | undefined,
): ConflictEntry["entityType"] {
  const hint = (field ?? "").toLowerCase();
  if (hint.startsWith("teams") || hint.includes("participant")) return "teams";
  if (hint.startsWith("venues")) return "venues";
  if (hint.startsWith("standings")) return "standings";
  if (hint.includes("match") || hint.startsWith("final.")) return "matches";
  if (hint.startsWith("group")) return "groups";
  return "tournament";
}

/**
 * Converts the pack into steward candidates, applying the verification
 * policy:
 *   - `verified` records vote with full values (and, at registry priority 1,
 *     win merged values).
 *   - `reported` records vote too, but the pack's own verification level is
 *     carried in the record note streams; they never upgrade confidence on
 *     their own (a single-source value stays SINGLE_SOURCE).
 *   - `unverified` records contribute identity/refs only — their null values
 *     abstain from every field vote, so they can never become final values.
 *
 * `letterByTeamSet` resolves the pack's unknown group letters: a canonical
 * sorted team-key set → group name map built from the other sources. Only an
 * exact unique match resolves; anything else stays unresolved (and reported).
 */
export function manualPackToCandidates(
  pack: ManualReferencePack,
  letterByTeamSet: Map<string, string>,
  teamKeyFor: (name: string | null | undefined, code?: string | null) => string | null,
): ManualPackCandidates {
  const out: ManualPackCandidates = {
    teams: [],
    groups: [],
    venues: [],
    matches: [],
    standings: [],
    conflicts: [],
    unresolvedGroups: 0,
  };

  // Code → display name (the pack references teams by FIFA-style code).
  const nameByCode = new Map<string, string>();
  for (const team of pack.teams) {
    if (team.code !== null && team.name !== null) {
      nameByCode.set(team.code, team.name);
    }
  }
  const displayName = (code: string | null | undefined): string | null => {
    if (code == null) return null;
    return nameByCode.get(code) ?? code;
  };

  // Teams — placeholder slots (null code/name) are intentionally NOT emitted
  // as candidates; they are unconfirmed and already covered by conflicts.json.
  pack.teams.forEach((team, index) => {
    if (team.name === null) return;
    out.teams.push({
      name: team.name,
      fifaCode: team.code,
      groupName: null, // group letters come from groups.json below
      sourceRef: ref("pack-teams", `teams[${index}]`),
    });
  });

  // Groups — resolve unknown letters by team-set against the other sources.
  const teamSetKey = (codesOrNames: Array<string | null>): string =>
    codesOrNames
      .map((value) =>
        value === null
          ? "?"
          : (teamKeyFor(displayName(value), value) ?? value),
      )
      .sort()
      .join("|");
  const groupLetterByIndex = new Map<number, string>();
  pack.groups.forEach((group, index) => {
    let groupName: string | null = null;
    if (group.group !== null) {
      groupName = `Group ${group.group.replace(/^group\s*/i, "").toUpperCase()}`;
    } else {
      groupName = letterByTeamSet.get(teamSetKey(group.teams)) ?? null;
    }
    if (groupName === null) {
      out.unresolvedGroups += 1;
      return;
    }
    groupLetterByIndex.set(index, groupName);
    out.groups.push({
      name: groupName,
      teamNames: group.teams
        .map((code) => displayName(code))
        .filter((name): name is string => name !== null),
      sourceRef: ref("pack-groups", `groups[${index}]`),
    });
  });

  // Group letter per team code, for match group attribution.
  const groupNameByTeamCode = new Map<string, string>();
  pack.groups.forEach((group, index) => {
    const groupName = groupLetterByIndex.get(index);
    if (groupName === undefined) return;
    for (const code of group.teams) {
      if (code !== null) groupNameByTeamCode.set(code, groupName);
    }
  });

  // Venues — prefer the real stadium name; keep FIFA name in city notes? No:
  // stadium_name is the canonical venue name in the archive, fifa_name is the
  // tournament-branding alias (recorded in pack conflicts when disputed).
  pack.venues.forEach((venue, index) => {
    const name = venue.stadium_name ?? venue.fifa_name;
    if (name == null) return;
    out.venues.push({
      name,
      cityName: venue.city ?? null,
      countryName: venue.country ?? null,
      capacity: venue.capacity_approx ?? null,
      sourceVenueId: venue.id,
      sourceRef: ref("pack-venues", `venues[${index}]`),
    });
  });
  const venueNameById = new Map(
    pack.venues
      .filter((venue) => venue.stadium_name != null || venue.fifa_name != null)
      .map((venue) => [venue.id, (venue.stadium_name ?? venue.fifa_name) as string]),
  );

  // Matches — verified records vote values; unverified rows carry only
  // identity (their null scores abstain from result votes by construction).
  pack.matches.forEach((match, index) => {
    const verified = match.verification === "verified";
    const homeName = displayName(match.home);
    const awayName = displayName(match.away);
    const groupName =
      match.stage === "group"
        ? (groupNameByTeamCode.get(match.home ?? "") ??
          groupNameByTeamCode.get(match.away ?? "") ??
          null)
        : null;
    const score = match.score ?? null;
    out.matches.push({
      sourceMatchId: match.match_id,
      // M-numbered ids (M73..M104) carry the official knockout match number.
      matchNumber: /^M(\d+)$/.test(match.match_id)
        ? Number(/^M(\d+)$/.exec(match.match_id)?.[1])
        : null,
      stageLabel: PACK_STAGE_TO_LABEL[match.stage] ?? match.stage,
      // No matchday detail in the pack — let the baseline's label win.
      roundLabel:
        match.stage === "group"
          ? null
          : (PACK_STAGE_TO_LABEL[match.stage] ?? match.stage),
      groupName,
      kickoffDateLabel: match.date ?? null,
      homeTeamName: homeName,
      awayTeamName: awayName,
      homeTeamCode: match.home ?? null,
      awayTeamCode: match.away ?? null,
      // Only verified results may vote values — never partial evidence.
      homeScore: verified ? (score?.home ?? null) : null,
      awayScore: verified ? (score?.away ?? null) : null,
      homePenaltyScore: verified ? (score?.penalties?.home ?? null) : null,
      awayPenaltyScore: verified ? (score?.penalties?.away ?? null) : null,
      status:
        verified && score?.home != null && score?.away != null
          ? "FINISHED"
          : "UNKNOWN",
      venueName:
        match.venue_id != null ? (venueNameById.get(match.venue_id) ?? null) : null,
      sourceRef: ref("pack-matches", `matches[${index}] (${match.match_id})`),
    });
  });

  // Standings — group tables become provider-style rows for the derived
  // comparison. groups.json final_table covers all groups; standings.json
  // group_tables may repeat a subset, so rows are deduped by (group, team).
  const seenStandingRows = new Set<string>();
  const pushTable = (
    groupName: string | null,
    table: z.infer<typeof packTableRowSchema>[] | null | undefined,
    refValue: string,
  ) => {
    if (groupName === null || table == null) return;
    table.forEach((row) => {
      const teamName = displayName(row.team) ?? row.team;
      const dedupeKey = `${groupName}::${teamKeyFor(teamName, row.team) ?? teamName}`;
      if (seenStandingRows.has(dedupeKey)) return;
      seenStandingRows.add(dedupeKey);
      out.standings.push({
        groupName,
        teamName,
        played: row.pld,
        wins: row.w,
        draws: row.d,
        losses: row.l,
        goalsFor: row.gf,
        goalsAgainst: row.ga,
        goalDifference: row.gf - row.ga,
        points: row.pts,
        rank: row.pos ?? null,
        sourceRef: ref("pack-standings", refValue),
      });
    });
  };
  (pack.standings?.group_tables ?? []).forEach((entry, index) => {
    const groupName =
      entry.group !== null
        ? `Group ${entry.group.replace(/^group\s*/i, "").toUpperCase()}`
        : entry.teams !== undefined
          ? (letterByTeamSet.get(teamSetKey(entry.teams)) ?? null)
          : null;
    pushTable(groupName, entry.table, `standings.group_tables[${index}]`);
  });
  pack.groups.forEach((group, index) => {
    pushTable(
      groupLetterByIndex.get(index) ?? null,
      group.final_table,
      `groups[${index}].final_table`,
    );
  });

  // Known manual conflicts — preserved verbatim as UNRESOLVED registry
  // entries. A future manual resolution file may resolve them; nothing in
  // this pipeline ever auto-resolves them away.
  pack.conflicts.forEach((conflict) => {
    out.conflicts.push({
      entityType: packConflictEntityType(conflict.field),
      entityKey: `${pack.manifest.packId}:${conflict.id}`,
      field: conflict.field ?? conflict.type ?? "unspecified",
      values: (conflict.values ?? []).map((value) => ({
        sourceId: `${MANUAL_PACK_SOURCE_ID}/${value.source}`,
        value:
          typeof value.value === "string"
            ? value.value
            : JSON.stringify(value.value),
      })),
      resolution: "UNRESOLVED",
      note: `[manual pack ${conflict.id}${conflict.type != null ? `, ${conflict.type}` : ""}] ${conflict.description ?? ""}`.trim(),
    });
    // A conflict with no per-source values still needs a values entry to be a
    // valid ConflictEntry; use the description itself.
    const entry = out.conflicts[out.conflicts.length - 1];
    if (entry.values.length === 0) {
      entry.values = [
        {
          sourceId: MANUAL_PACK_SOURCE_ID,
          value: conflict.description ?? conflict.id,
        },
      ];
    }
  });

  return out;
}
