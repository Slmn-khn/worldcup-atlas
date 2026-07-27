import { describe, expect, it } from "vitest";

import {
  buildMatchIdentityIndex,
  type ReferenceMatch,
} from "../../../src/server/agents/worldcup2026/matchIdentity";
import { MANUAL_PACK_SOURCE_ID } from "../../../src/server/agents/worldcup2026/manualReferencePack";
import { BUSTAMI_IMPORT_BLOCKED_REASON } from "../../../src/server/agents/worldcup2026/providers/bustamiEfiDataset";
import {
  classifyBustamiRow,
  classifyProviderMatch,
  scoresAgreeWithPack,
  type PackMatchFact,
  type PackVerifiedFacts,
  type ProviderMatchRow,
} from "../../../src/server/agents/worldcup2026/providers/enrichment";
import {
  BUSTAMI_IMPORT_RECOMMENDATION,
  MOMINUL_IMPORT_RECOMMENDATION,
  type ProviderEnrichmentResult,
  type ProviderEnrichmentStats,
} from "../../../src/server/agents/worldcup2026/providers/enrichmentPipeline";
import {
  buildBustamiProviderReportMarkdown,
  buildEnrichmentConflictPayload,
  buildMominulProviderReportMarkdown,
} from "../../../src/server/agents/worldcup2026/providers/providerReports";

// ---------------------------------------------------------------------------
// Fixtures: a verified final (M104), a verified third-place (M103), and a
// group match the manual pack knows only as an unverified identity (a gap).
// ---------------------------------------------------------------------------

const REFERENCES: ReferenceMatch[] = [
  {
    key: "M104",
    matchIds: ["M104", "104"],
    date: "2026-07-19",
    homeTeam: "Spain",
    awayTeam: "Argentina",
    stage: "final",
  },
  {
    key: "M103",
    matchIds: ["M103", "103"],
    date: "2026-07-18",
    homeTeam: "England",
    awayTeam: "France",
    stage: "third_place",
  },
  {
    key: "G-12",
    matchIds: ["G-12", "12"],
    date: "2026-06-14",
    homeTeam: "Mexico",
    awayTeam: "Canada",
    stage: "group",
  },
];

const fact = (partial: Partial<PackMatchFact> & { matchId: string }): PackMatchFact => ({
  stage: "final",
  date: null,
  homeTeam: null,
  awayTeam: null,
  homeScore: null,
  awayScore: null,
  verified: false,
  ...partial,
});

const packFacts: PackVerifiedFacts = {
  present: true,
  champion: "ESP",
  runnerUp: "ARG",
  third: "ENG",
  fourth: "FRA",
  awards: {},
  matchFacts: new Map([
    [
      "M104",
      fact({
        matchId: "M104",
        stage: "final",
        date: "2026-07-19",
        homeTeam: "Spain",
        awayTeam: "Argentina",
        homeScore: 2,
        awayScore: 1,
        verified: true,
      }),
    ],
    [
      "M103",
      fact({
        matchId: "M103",
        stage: "third_place",
        date: "2026-07-18",
        homeTeam: "England",
        awayTeam: "France",
        homeScore: 1,
        awayScore: 0,
        verified: true,
      }),
    ],
    // Known manual gap: identity captured, result never verified.
    [
      "G-12",
      fact({ matchId: "G-12", stage: "group", date: "2026-06-14", homeTeam: "Mexico", awayTeam: "Canada" }),
    ],
  ]),
  knownConflicts: 1,
};

const index = buildMatchIdentityIndex(REFERENCES);

const row = (partial: Partial<ProviderMatchRow>): ProviderMatchRow => ({
  sourceId: "mominul_2026_dataset",
  sourceFile: "matches.csv",
  sourceRowNumber: 1,
  query: {},
  homeScore: null,
  awayScore: null,
  ...partial,
});

// ---------------------------------------------------------------------------
// Mominul classification
// ---------------------------------------------------------------------------

describe("classifyProviderMatch", () => {
  it("marks agreement with a verified manual field as supporting evidence", () => {
    const result = classifyProviderMatch(index, packFacts, row({
      query: { matchId: "104", homeTeam: "Spain", awayTeam: "Argentina" },
      homeScore: 2,
      awayScore: 1,
    }));
    expect(result.classification).toBe("SUPPORTING_EVIDENCE");
    expect(result.conflict).toBeNull();
  });

  it("creates a conflict when disagreeing — manual pack stays preferred", () => {
    const result = classifyProviderMatch(index, packFacts, row({
      query: { matchId: "104", homeTeam: "Spain", awayTeam: "Argentina" },
      homeScore: 3,
      awayScore: 0,
    }));
    expect(result.classification).toBe("CONFLICT");
    expect(result.conflict).not.toBeNull();
    expect(result.conflict?.entityKey).toBe("M104");
    expect(result.conflict?.resolution).toBe("KEPT_HIGHEST_PRIORITY");
    expect(result.conflict?.values[0].sourceId).toBe(MANUAL_PACK_SOURCE_ID);
    expect(result.conflict?.note).toContain("Manual verified pack remains preferred");
  });

  it("marks a cleanly-resolved manual gap as a gap-fill candidate", () => {
    const result = classifyProviderMatch(index, packFacts, row({
      query: {
        date: "2026-06-14",
        homeTeam: "Mexico",
        awayTeam: "Canada",
        stage: "group",
      },
      homeScore: 2,
      awayScore: 0,
    }));
    expect(result.classification).toBe("GAP_FILL_CANDIDATE");
  });

  it("downgrades probable resolutions to enrichment candidates", () => {
    const result = classifyProviderMatch(index, packFacts, row({
      query: { date: "2026-06-14", homeTeam: "Mexico", awayTeam: "Canada" },
    }));
    expect(result.resolution.confidence).toBe("PROBABLE");
    expect(result.classification).toBe("ENRICHMENT_CANDIDATE");
  });

  it("leaves unknown matches unresolved", () => {
    const result = classifyProviderMatch(index, packFacts, row({
      query: { homeTeam: "Brazil", awayTeam: "Germany", date: "2026-06-20" },
    }));
    expect(result.classification).toBe("UNRESOLVED");
  });
});

describe("scoresAgreeWithPack", () => {
  const verifiedFinal = packFacts.matchFacts.get("M104") as PackMatchFact;
  it("tolerates flipped home/away orientation", () => {
    expect(
      scoresAgreeWithPack(verifiedFinal, {
        query: { homeTeam: "Argentina", awayTeam: "Spain" },
        homeScore: 1,
        awayScore: 2,
      }),
    ).toBe(true);
  });
  it("returns null when scores are not comparable", () => {
    expect(
      scoresAgreeWithPack(verifiedFinal, {
        query: { homeTeam: "Spain", awayTeam: "Argentina" },
        homeScore: null,
        awayScore: null,
      }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Bustami classification (research-only)
// ---------------------------------------------------------------------------

describe("classifyBustamiRow", () => {
  it("classifies rows as advanced analytics candidates", () => {
    const result = classifyBustamiRow(index, packFacts, row({
      sourceId: "bustami_fifa_efi_2026",
      sourceFile: "wc2026_efi.csv",
      query: { matchId: "104" },
    }));
    expect(result.classification).toBe("ADVANCED_ANALYTICS_CANDIDATE");
  });

  it("still reports conflicts with verified manual facts", () => {
    const result = classifyBustamiRow(index, packFacts, row({
      sourceId: "bustami_fifa_efi_2026",
      sourceFile: "wc2026_matches.csv",
      query: { matchId: "104", homeTeam: "Spain", awayTeam: "Argentina" },
      homeScore: 0,
      awayScore: 4,
    }));
    expect(result.classification).toBe("CONFLICT");
    expect(result.conflict).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

const stats = (
  sourceId: string,
  importRecommendation: string,
  importBlockedReason: string | null,
): ProviderEnrichmentStats => ({
  sourceId,
  filesFetched: 3,
  filesFailed: 1,
  filesParsed: 3,
  rowCounts: { "wc2026_efi.csv": 10, "wc2026_matches.csv": 5, "wc2026_players.csv": 8 },
  parseWarnRows: 1,
  parseErrorRows: 1,
  columnsDetected: { "wc2026_efi.csv": ["match_id", "player_id", "xg"] },
  classificationCounts: {
    SUPPORTING_EVIDENCE: 2,
    GAP_FILL_CANDIDATE: 3,
    ENRICHMENT_CANDIDATE: 4,
    ADVANCED_ANALYTICS_CANDIDATE: 10,
    CONFLICT: 1,
    UNRESOLVED: 1,
  },
  matchResolution: { total: 10, resolved: 8, byConfidence: { EXACT_MATCH_ID: 8, UNRESOLVED: 2 } },
  playerResolution: { total: 10, resolved: 9, byConfidence: { EXACT_PROVIDER_ID: 9, UNRESOLVED: 1 } },
  conflictsWithManualPack: 1,
  gapFillCandidates: 3,
  importRecommendation,
  importBlockedReason,
  notes: [],
});

const result: ProviderEnrichmentResult = {
  generatedAt: "2026-07-27T00:00:00.000Z",
  manualPackPresent: true,
  mominul: stats("mominul_2026_dataset", MOMINUL_IMPORT_RECOMMENDATION, null),
  bustami: stats(
    "bustami_fifa_efi_2026",
    BUSTAMI_IMPORT_RECOMMENDATION,
    BUSTAMI_IMPORT_BLOCKED_REASON,
  ),
  conflicts: [
    {
      entityType: "matches",
      entityKey: "M104",
      field: "score",
      values: [{ sourceId: MANUAL_PACK_SOURCE_ID, value: "2-1" }],
      resolution: "KEPT_HIGHEST_PRIORITY",
    },
  ],
  writtenFiles: [],
};

describe("provider reports", () => {
  it("Bustami report carries the license/usage warning and research-only verdict", () => {
    const markdown = buildBustamiProviderReportMarkdown(result);
    expect(markdown).toContain("RESEARCH_ONLY_UNTIL_LICENSE_REVIEW");
    expect(markdown).toContain("analytical/research purposes only");
    expect(markdown).toContain("License / usage warning");
    expect(markdown).toContain("NOT imported");
  });

  it("Mominul report recommends candidate-for-approval, never claims import", () => {
    const markdown = buildMominulProviderReportMarkdown(result);
    expect(markdown).toContain("CANDIDATE_FOR_APPROVAL_AFTER_VALIDATION");
    expect(markdown).toContain("NOT imported");
    expect(markdown).toContain("Gap-fill candidates");
    expect(markdown).not.toMatch(/was imported/i);
  });

  it("conflict payload keeps the manual pack preferred", () => {
    const payload = buildEnrichmentConflictPayload(result) as {
      total: number;
      resolutionPolicy: string;
    };
    expect(payload.total).toBe(1);
    expect(payload.resolutionPolicy).toContain("manual verified reference pack");
  });
});
