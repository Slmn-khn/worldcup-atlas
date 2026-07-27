import { describe, expect, it } from "vitest";

import {
  aggregateLabelConflicts,
  buildReviewItems,
  buildReviewItemsCsv,
  buildReviewPackFile,
  classifyConflictSeverity,
  conflictReviewId,
  dedupeConflicts,
  reviewItemFromConflict,
  reviewItemsFromEnrichment,
  reviewItemsFromGapFills,
  type ReviewPackInputs,
} from "../../../src/server/agents/worldcup2026/reviewPack";
import type { ConflictEntry } from "../../../src/server/agents/worldcup2026/types";

const scoreConflict: ConflictEntry = {
  entityType: "matches",
  entityKey: "GB-5",
  field: "score",
  values: [
    { sourceId: "manual_verified_2026_pack_v1", value: "Switzerland 3-1 Canada" },
    { sourceId: "mominul_2026_dataset", value: "Switzerland 2-1 Canada" },
  ],
  resolution: "KEPT_HIGHEST_PRIORITY",
  note: "Manual verified pack remains preferred.",
};

const emptyInputs: ReviewPackInputs = {
  conflictEntries: [],
  enrichmentConflicts: [],
  enrichmentProviders: [],
  gapFillRecords: [],
  inputFiles: [],
};

describe("reviewItemFromConflict", () => {
  it("creates a pending item with manual + provider values preserved", () => {
    const item = reviewItemFromConflict(scoreConflict);
    expect(item).toMatchObject({
      id: "review-match-GB-5-score",
      type: "MATCH_RESULT_CONFLICT",
      severity: "HIGH",
      entityType: "matches",
      entityKey: "GB-5",
      field: "score",
      manualPackValue: "Switzerland 3-1 Canada",
      providerValue: "Switzerland 2-1 Canada",
      providerSourceId: "mominul_2026_dataset",
      currentRecommendation: "KEEP_MANUAL_VERIFIED",
      decision: null,
      reviewerNote: null,
      status: "PENDING",
    });
    expect(item.evidence).toHaveLength(2);
  });

  it("marks unresolved manual pack conflicts as NEEDS_SOURCE", () => {
    const item = reviewItemFromConflict({
      entityType: "matches",
      entityKey: "manual-verified-2026-v1:C-002",
      field: "matches.M88",
      values: [{ sourceId: "manual_verified_2026_pack_v1", value: "data gap" }],
      resolution: "UNRESOLVED",
      note: "[manual pack C-002, data_gap] Opponent and score not present.",
    });
    expect(item.id).toBe("review-pack-C-002");
    expect(item.currentRecommendation).toBe("NEEDS_SOURCE");
  });

  it("uses the well-known id for the unresolved 48th participant", () => {
    expect(
      conflictReviewId({
        entityType: "teams",
        entityKey: "manual-verified-2026-v1:C-004",
        field: "teams",
        values: [{ sourceId: "manual_verified_2026_pack_v1", value: "47 of 48" }],
        resolution: "UNRESOLVED",
      }),
    ).toBe("review-team-unverified-48th");
  });
});

describe("classifyConflictSeverity", () => {
  const conflict = (partial: Partial<ConflictEntry>): ConflictEntry => ({
    entityType: "matches",
    entityKey: "X",
    field: "score",
    values: [{ sourceId: "s", value: "v" }],
    resolution: "KEPT_HIGHEST_PRIORITY",
    ...partial,
  });

  it("is CRITICAL for tournament outcome / final territory", () => {
    expect(classifyConflictSeverity(conflict({ entityType: "tournament", field: "winner" }))).toBe("CRITICAL");
    expect(classifyConflictSeverity(conflict({ entityKey: "M104", field: "score" }))).toBe("CRITICAL");
    expect(classifyConflictSeverity(conflict({ field: "runnerUp" }))).toBe("CRITICAL");
  });
  it("is HIGH for match result conflicts", () => {
    expect(classifyConflictSeverity(conflict({ field: "score" }))).toBe("HIGH");
    expect(classifyConflictSeverity(conflict({ field: "homeScore" }))).toBe("HIGH");
    expect(classifyConflictSeverity(conflict({ field: "homePenaltyScore" }))).toBe("HIGH");
  });
  it("is MEDIUM for team/venue/identifier conflicts", () => {
    expect(classifyConflictSeverity(conflict({ entityType: "venues", field: "capacity" }))).toBe("MEDIUM");
    expect(classifyConflictSeverity(conflict({ entityType: "groups", field: "teams" }))).toBe("MEDIUM");
    expect(classifyConflictSeverity(conflict({ field: "matchNumber" }))).toBe("MEDIUM");
  });
  it("is LOW for display label drift", () => {
    expect(classifyConflictSeverity(conflict({ field: "status" }))).toBe("LOW");
    expect(classifyConflictSeverity(conflict({ field: "cityName" }))).toBe("LOW");
    expect(classifyConflictSeverity(conflict({ field: "kickoffTimeLabel" }))).toBe("LOW");
  });
});

describe("deduplication", () => {
  it("merges duplicate conflicts and their evidence", () => {
    const duplicate: ConflictEntry = {
      ...scoreConflict,
      values: [
        { sourceId: "manual_verified_2026_pack_v1", value: "Switzerland 3-1 Canada" },
        { sourceId: "mominul_2026_dataset", value: "Switzerland 2-1 Canada (detailed)" },
      ],
    };
    const deduped = dedupeConflicts([scoreConflict, duplicate]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].values).toHaveLength(3);
  });

  it("merges same-id items from multiple paths in buildReviewItems", () => {
    const items = buildReviewItems({
      ...emptyInputs,
      conflictEntries: [scoreConflict],
      enrichmentConflicts: [scoreConflict],
    });
    expect(items.filter((item) => item.id === "review-match-GB-5-score")).toHaveLength(1);
  });

  it("aggregates LOW label conflicts into one class item", () => {
    const labels: ConflictEntry[] = [1, 2, 3].map((n) => ({
      entityType: "matches",
      entityKey: `match #${n}`,
      field: "status",
      values: [
        { sourceId: "openfootball_worldcup_2026", value: "FINISHED" },
        { sourceId: "worldcup2026_repo", value: "SCHEDULED" },
      ],
      resolution: "KEPT_HIGHEST_PRIORITY",
    }));
    const { individual, aggregated } = aggregateLabelConflicts(labels);
    expect(individual).toHaveLength(0);
    expect(aggregated).toHaveLength(1);
    expect(aggregated[0].id).toBe("review-labels-matches-status");
    expect(aggregated[0].severity).toBe("LOW");
    expect(aggregated[0].reason).toContain("3 matches records");
  });
});

describe("gap-fill and enrichment items", () => {
  it("creates one MEDIUM item per distinct gap-fill reference", () => {
    const items = reviewItemsFromGapFills([
      { referenceKey: "M88", sourceId: "mominul_2026_dataset", sourceFile: "matches.csv", sourceRowNumber: 88, summary: "Colombia 2-0 ? (2026-06-30)" },
      { referenceKey: "M88", sourceId: "mominul_2026_dataset", sourceFile: "matches_detailed.csv", sourceRowNumber: 88 },
      { referenceKey: "M4", sourceId: "mominul_2026_dataset", sourceFile: "matches.csv", sourceRowNumber: 4 },
    ]);
    expect(items).toHaveLength(2);
    const m88 = items.find((item) => item.id === "review-gap-M88");
    expect(m88).toMatchObject({ type: "MATCH_GAP_FILL", severity: "MEDIUM", status: "PENDING" });
    expect(m88?.evidence).toHaveLength(2);
  });

  it("creates LOW per-file enrichment items plus the EFI license item", () => {
    const items = reviewItemsFromEnrichment([
      {
        sourceId: "bustami_fifa_efi_2026",
        rowCounts: { "wc2026_efi.csv": 5359 },
        classificationCounts: {},
        importRecommendation: "RESEARCH_ONLY_UNTIL_LICENSE_REVIEW",
        importBlockedReason: "RESEARCH_ONLY_UNTIL_LICENSE_REVIEW",
      },
    ]);
    const efiRows = items.find((item) => item.id === "review-enrichment-bustami-wc2026-efi");
    expect(efiRows).toMatchObject({ severity: "LOW", type: "EFI_ANALYTICS_CANDIDATE" });
    const license = items.find((item) => item.id === "review-efi-license");
    expect(license).toMatchObject({
      severity: "MEDIUM",
      currentRecommendation: "RESEARCH_ONLY_UNTIL_LICENSE_REVIEW",
    });
  });
});

describe("pack file + CSV", () => {
  it("orders items by severity and pins a deterministic hash", () => {
    const inputs: ReviewPackInputs = {
      ...emptyInputs,
      conflictEntries: [scoreConflict],
      gapFillRecords: [
        { referenceKey: "M4", sourceId: "mominul_2026_dataset", sourceFile: "matches.csv", sourceRowNumber: 4 },
      ],
    };
    const items = buildReviewItems(inputs);
    expect(items[0].severity).toBe("HIGH");
    const packA = buildReviewPackFile(items, [], "2026-07-27T00:00:00.000Z");
    const packB = buildReviewPackFile(buildReviewItems(inputs), [], "2026-07-28T00:00:00.000Z");
    expect(packA.reviewPackHash).toBe(packB.reviewPackHash);
    expect(packA.counts.total).toBe(2);
    expect(packA.counts.bySeverity.HIGH).toBe(1);
    expect(packA.counts.bySeverity.MEDIUM).toBe(1);
  });

  it("produces spreadsheet-safe CSV with escaped and truncated cells", () => {
    const item = reviewItemFromConflict(scoreConflict);
    item.reviewerNote = 'has "quotes", commas,\nand newlines ' + "x".repeat(400);
    const csv = buildReviewItemsCsv([item]);
    const [header, row] = csv.split("\r\n");
    expect(header.split(",")).toContain("manualPackValue");
    expect(row).toContain('"');
    // Long values truncated — never a full raw dump.
    expect(row.length).toBeLessThan(1500);
    expect(csv.split("\r\n")).toHaveLength(3); // header + row + trailing
  });
});
