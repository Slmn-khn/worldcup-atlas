import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildManualPackStats,
  loadManualReferencePack,
  manualPackToCandidates,
  packConflictEntityType,
  type ManualReferencePack,
} from "../../../src/server/agents/worldcup2026/manualReferencePack";
import { buildTournament } from "../../../src/server/agents/worldcup2026/normalizer";
import { canonicalTeamKey } from "../../../src/server/agents/worldcup2026/resolver";
import {
  validateNormalizedDataSet,
  type NormalizedDataSet,
} from "../../../src/server/agents/worldcup2026/validator";

const FIXTURE_DIR = path.join(
  __dirname,
  "fixtures",
  "manual-reference-pack",
);

async function loadFixturePack(): Promise<ManualReferencePack> {
  const result = await loadManualReferencePack(FIXTURE_DIR);
  if (result === null || !result.ok) throw new Error("fixture pack must load");
  return result.pack;
}

const teamKeyFor = (name: string | null | undefined, code?: string | null) =>
  canonicalTeamKey(name, { fifaCode: code ?? null });

describe("loadManualReferencePack", () => {
  it("returns null when no pack exists", async () => {
    expect(await loadManualReferencePack("/nonexistent/dir")).toBeNull();
  });

  it("loads the fixture pack with per-file hashes and a stable pack hash", async () => {
    const pack = await loadFixturePack();
    expect(pack.manifest.packId).toBe("fixture-pack-v1");
    expect(Object.keys(pack.fileHashes)).toHaveLength(10);
    for (const hash of Object.values(pack.fileHashes)) {
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    }
    // Hashing is deterministic: loading twice yields the same pack hash.
    const again = await loadFixturePack();
    expect(again.packHash).toBe(pack.packHash);
    expect(pack.packHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("emits warnings (not errors) for the pack's recorded gaps", async () => {
    const result = await loadManualReferencePack(FIXTURE_DIR);
    if (result === null || !result.ok) throw new Error("must load");
    expect(result.warnings.join("\n")).toContain("3 of 104");
    expect(result.warnings.join("\n")).toContain("unconfirmed placeholder");
  });

  it("classifies verified vs unverified records in stats", async () => {
    const stats = buildManualPackStats(await loadFixturePack());
    expect(stats).toMatchObject({
      present: true,
      packId: "fixture-pack-v1",
      filesLoaded: 10,
      officialMatchCount: 104,
      capturedMatchCount: 3,
      verifiedMatches: 2,
      unverifiedMatches: 1,
      knownConflicts: 2,
      verifiedTeams: 3,
      unverifiedTeams: 2, // one "reported" + one null placeholder
      awardsPresent: true,
    });
  });
});

describe("manualPackToCandidates", () => {
  it("maps verified matches with values and lets unverified rows abstain", async () => {
    const pack = await loadFixturePack();
    const candidates = manualPackToCandidates(pack, new Map(), teamKeyFor);

    const verified = candidates.matches.find(
      (match) => match.sourceMatchId === "GA-1",
    );
    expect(verified).toMatchObject({
      homeTeamName: "Mexico",
      awayTeamName: "South Africa",
      homeScore: 2,
      awayScore: 0,
      status: "FINISHED",
      groupName: "Group A",
    });

    // Unverified: identity only — null score, no status claim.
    const unverified = candidates.matches.find(
      (match) => match.sourceMatchId === "GA-2",
    );
    expect(unverified).toMatchObject({
      homeScore: null,
      awayScore: null,
      status: "UNKNOWN",
    });
  });

  it("maps the M104 final with its official number and venue", async () => {
    const pack = await loadFixturePack();
    const candidates = manualPackToCandidates(pack, new Map(), teamKeyFor);
    const final = candidates.matches.find(
      (match) => match.sourceMatchId === "M104",
    );
    expect(final).toMatchObject({
      matchNumber: 104,
      stageLabel: "Final",
      homeTeamName: "Spain",
      awayTeamName: "Argentina",
      homeScore: 1,
      awayScore: 0,
      status: "FINISHED",
      venueName: "MetLife Stadium",
    });
  });

  it("resolves unknown group letters by team-set matching", async () => {
    const pack = await loadFixturePack();
    const setKey = ["Spain", "Argentina"]
      .map((name) => canonicalTeamKey(name) ?? name)
      .sort()
      .join("|");
    const candidates = manualPackToCandidates(
      pack,
      new Map([[setKey, "Group Z"]]),
      teamKeyFor,
    );
    expect(candidates.groups.map((group) => group.name).sort()).toEqual([
      "Group A",
      "Group Z",
    ]);
    expect(candidates.unresolvedGroups).toBe(0);
  });

  it("keeps unresolvable groups out (counted) instead of guessing", async () => {
    const pack = await loadFixturePack();
    const candidates = manualPackToCandidates(pack, new Map(), teamKeyFor);
    expect(candidates.groups.map((group) => group.name)).toEqual(["Group A"]);
    expect(candidates.unresolvedGroups).toBe(1);
  });

  it("converts the pack conflict registry, preserving entries as UNRESOLVED", async () => {
    const pack = await loadFixturePack();
    const candidates = manualPackToCandidates(pack, new Map(), teamKeyFor);
    expect(candidates.conflicts).toHaveLength(2);
    const shots = candidates.conflicts.find((conflict) =>
      conflict.entityKey.endsWith("C-001"),
    );
    expect(shots).toMatchObject({
      entityType: "matches",
      field: "final.shots",
      resolution: "UNRESOLVED",
    });
    expect(shots?.values).toHaveLength(2);
    // A values-less conflict still becomes a valid entry from its description.
    const gap = candidates.conflicts.find((conflict) =>
      conflict.entityKey.endsWith("C-004"),
    );
    expect(gap).toMatchObject({ entityType: "teams", resolution: "UNRESOLVED" });
    expect(gap?.values.length).toBeGreaterThan(0);
  });

  it("does not emit placeholder team slots as candidates", async () => {
    const pack = await loadFixturePack();
    const candidates = manualPackToCandidates(pack, new Map(), teamKeyFor);
    expect(candidates.teams).toHaveLength(4); // 5 records, 1 null placeholder
  });
});

describe("packConflictEntityType", () => {
  it("maps field hints onto steward data kinds", () => {
    expect(packConflictEntityType("teams")).toBe("teams");
    expect(packConflictEntityType("venues.nynj")).toBe("venues");
    expect(packConflictEntityType("final.shots")).toBe("matches");
    expect(packConflictEntityType("matches.M88")).toBe("matches");
    expect(packConflictEntityType(null)).toBe("tournament");
  });
});

describe("buildTournament with a manual reference", () => {
  const base = {
    teams: [],
    groups: [],
    venues: [],
    matches: [],
    conflictsCount: 0,
  };

  it("prefers verified manual podium values and upgrades confidence on agreement", () => {
    const { tournament, conflicts } = buildTournament({
      ...base,
      manualRef: {
        winner: "Spain",
        runnerUp: "Argentina",
        thirdPlace: "England",
        fourthPlace: "France",
        verified: true,
      },
    });
    expect(tournament.winner).toBe("Spain");
    expect(tournament.confidence).toBe("MULTI_SOURCE_VERIFIED");
    expect(conflicts).toEqual([]);
  });

  it("reports a conflict when the verified reference disagrees with derivation", () => {
    const finalMatch = {
      stage: "FINAL" as const,
      status: "FINISHED" as const,
      homeTeamName: "Spain",
      awayTeamName: "Argentina",
      homeScore: 1,
      awayScore: 0,
      winnerTeamName: "Spain",
      sourceIds: ["openfootball_worldcup_2026"],
      confidence: "SINGLE_SOURCE" as const,
      verificationStatus: "NEEDS_REVIEW" as const,
      rawSourceRefs: [],
    };
    const { tournament, conflicts } = buildTournament({
      ...base,
      matches: [finalMatch],
      manualRef: {
        winner: "Argentina", // disagrees with the derived winner
        runnerUp: null,
        thirdPlace: null,
        fourthPlace: null,
        verified: true,
      },
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ entityType: "tournament", field: "winner" });
    expect(tournament.confidence).toBe("CONFLICTED");
    expect(tournament.verificationStatus).toBe("CONFLICTED");
  });

  it("ignores an unverified manual reference for final values", () => {
    const { tournament } = buildTournament({
      ...base,
      manualRef: {
        winner: "Spain",
        runnerUp: null,
        thirdPlace: null,
        fourthPlace: null,
        verified: false,
      },
    });
    expect(tournament.winner).toBeNull(); // nothing derived, nothing overridden
    expect(tournament.confidence).toBe("DERIVED");
  });
});

describe("validator manual pack coverage", () => {
  const emptyData: NormalizedDataSet = {
    tournament: {
      tournamentYear: 2026,
      name: "World Cup 2026",
      hostCountries: ["Canada", "Mexico", "United States"],
      teamsCount: 0,
      groupsCount: 0,
      matchesCount: 0,
      venuesCount: 0,
      sourceIds: ["openfootball_worldcup_2026"],
      confidence: "DERIVED",
      verificationStatus: "NEEDS_REVIEW",
    },
    teams: [],
    groups: [],
    venues: [],
    matches: [],
    standings: [],
    conflicts: [],
  };

  it("captured < official produces WARN, not FAIL", async () => {
    const stats = buildManualPackStats(await loadFixturePack());
    const report = validateNormalizedDataSet(emptyData, [], stats);
    expect(report.status).toBe("WARN");
    expect(report.errors).toEqual([]);
    expect(
      report.warnings.some((w) => w.code === "MANUAL_PACK_PARTIAL_COVERAGE"),
    ).toBe(true);
    expect(report.manualPack.capturedMatchCount).toBe(3);
    expect(report.manualPack.officialMatchCount).toBe(104);
  });

  it("flags unverified pack records as review warnings", async () => {
    const stats = buildManualPackStats(await loadFixturePack());
    const report = validateNormalizedDataSet(emptyData, [], stats);
    expect(
      report.warnings.some((w) => w.code === "MANUAL_PACK_UNVERIFIED_MATCHES"),
    ).toBe(true);
    expect(
      report.warnings.some((w) => w.code === "MANUAL_PACK_UNVERIFIED_TEAMS"),
    ).toBe(true);
  });

  it("rejects a pack that claims importAllowed", async () => {
    const { cp, mkdtemp, readFile, rm, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(path.join(tmpdir(), "manual-pack-"));
    try {
      await cp(FIXTURE_DIR, dir, { recursive: true });
      const manifest = JSON.parse(
        await readFile(path.join(dir, "manifest.json"), "utf8"),
      ) as { importAllowed: boolean };
      manifest.importAllowed = true;
      await writeFile(
        path.join(dir, "manifest.json"),
        JSON.stringify(manifest, null, 2),
        "utf8",
      );
      const result = await loadManualReferencePack(dir);
      expect(result).not.toBeNull();
      expect(result?.ok).toBe(false);
      if (result !== null && !result.ok) {
        expect(result.errors.join(" ")).toContain("importAllowed");
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails structurally malformed files with precise errors", async () => {
    const { cp, mkdtemp, rm, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(path.join(tmpdir(), "manual-pack-"));
    try {
      await cp(FIXTURE_DIR, dir, { recursive: true });
      await writeFile(path.join(dir, "matches.json"), "{ not json", "utf8");
      const result = await loadManualReferencePack(dir);
      expect(result?.ok).toBe(false);
      if (result !== null && !result.ok) {
        expect(result.errors.join(" ")).toContain("matches.json");
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
