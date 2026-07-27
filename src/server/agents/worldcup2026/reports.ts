// Markdown report generation for the 2026 data steward agent (Phase 1).
//
// Produces data/2026/reports/2026-data-steward-report.md — the human-facing
// summary of a collect → candidates → normalize → validate run: source
// coverage, normalized counts, conflicts, validation verdict, and whether the
// data pack is safe to import (in Phase 1 the answer is always effectively
// "not yet": importing additionally requires the future approval workflow).

import type { ManualReferencePack } from "./manualReferencePack";
import type { SnapshotMeta } from "./types";
import type { NormalizedDataSet, ValidationReport } from "./validator";

// ---------------------------------------------------------------------------
// Human review status (Phase 2A)
// ---------------------------------------------------------------------------

export const HUMAN_REVIEW_STATUS_LABELS = [
  "REVIEW_NOT_STARTED",
  "REVIEW_IN_PROGRESS",
  "REVIEW_BLOCKED",
  "READY_FOR_APPROVAL_CANDIDATE",
  "APPROVAL_CANDIDATE_GENERATED",
] as const;
export type HumanReviewStatusLabel =
  (typeof HUMAN_REVIEW_STATUS_LABELS)[number];

export type HumanReviewStatus = {
  label: HumanReviewStatusLabel;
  packGeneratedAt: string | null;
  totalItems: number;
  bySeverity: Record<string, number>;
  pendingItems: number;
  reviewedItems: number;
  /** Items carrying a BLOCK_IMPORT decision. */
  blockedItems: number;
  importBlockingCount: number;
  approvalCandidateExists: boolean;
  nextActions: string[];
};

/**
 * Derives the review status label + next human actions from the current
 * review state. Pure — unit-tested.
 */
export function deriveHumanReviewStatus(input: {
  packGeneratedAt: string | null;
  totalItems: number;
  bySeverity: Record<string, number>;
  pendingItems: number;
  reviewedItems: number;
  blockImportDecisions: number;
  importBlockingCount: number;
  eligibleForApprovalCandidate: boolean;
  approvalCandidateExists: boolean;
}): HumanReviewStatus {
  let label: HumanReviewStatusLabel;
  const nextActions: string[] = [];

  if (input.packGeneratedAt === null) {
    label = "REVIEW_NOT_STARTED";
    nextActions.push("Generate the review pack: `pnpm data:2026:review-pack`.");
  } else if (input.blockImportDecisions > 0) {
    label = "REVIEW_BLOCKED";
    nextActions.push(
      `Resolve the ${input.blockImportDecisions} BLOCK_IMPORT decision(s) — import stays blocked until the reviewer withdraws them.`,
    );
  } else if (input.eligibleForApprovalCandidate) {
    label = input.approvalCandidateExists
      ? "APPROVAL_CANDIDATE_GENERATED"
      : "READY_FOR_APPROVAL_CANDIDATE";
    if (!input.approvalCandidateExists) {
      nextActions.push(
        "Generate the approval candidate: `pnpm data:2026:approval-candidate`.",
      );
    }
    nextActions.push(
      "A human must fill approvedBy/approvedAt in approval.candidate.json, set approvedForImport=true, and rename it to approval.json.",
    );
    if (input.pendingItems > 0) {
      nextActions.push(
        `${input.pendingItems} MEDIUM/LOW items remain pending — non-blocking, but worth deciding before final approval.`,
      );
    }
  } else {
    label = "REVIEW_IN_PROGRESS";
    nextActions.push(
      `Decide the remaining blocking items (${input.importBlockingCount}) in data/2026/review/review-decisions.json, then run \`pnpm data:2026:review-validate\`.`,
    );
  }

  return {
    label,
    packGeneratedAt: input.packGeneratedAt,
    totalItems: input.totalItems,
    bySeverity: input.bySeverity,
    pendingItems: input.pendingItems,
    reviewedItems: input.reviewedItems,
    blockedItems: input.blockImportDecisions,
    importBlockingCount: input.importBlockingCount,
    approvalCandidateExists: input.approvalCandidateExists,
    nextActions,
  };
}

/** Per-provider slice of enrichment-coverage-report.json for the report. */
export type EnrichmentProviderSummary = {
  sourceId: string;
  filesFetched: number;
  filesFailed: number;
  rowCounts: Record<string, number>;
  classificationCounts: Record<string, number>;
  conflictsWithManualPack: number;
  gapFillCandidates: number;
  importRecommendation: string;
  importBlockedReason: string | null;
};

export type SourceCoverageEntry = {
  sourceId: string;
  endpointsConfigured: number;
  endpointsCollected: number;
  endpointsFailed: number;
  failedEndpoints: Array<{ endpointId: string; errorMessage: string | null }>;
};

export function buildSourceCoverage(
  configured: Array<{ id: string; endpoints?: Array<{ id: string }> }>,
  snapshots: SnapshotMeta[],
): SourceCoverageEntry[] {
  return configured.map((source) => {
    const metas = snapshots.filter((meta) => meta.sourceId === source.id);
    const failed = metas.filter((meta) => meta.status === "FAILED");
    return {
      sourceId: source.id,
      endpointsConfigured: source.endpoints?.length ?? 0,
      endpointsCollected: metas.filter((meta) => meta.status === "OK").length,
      endpointsFailed: failed.length,
      failedEndpoints: failed.map((meta) => ({
        endpointId: meta.endpointId,
        errorMessage: meta.errorMessage,
      })),
    };
  });
}

/** Import-readiness verdict — intentionally blunt. */
export function importReadiness(report: ValidationReport): {
  ready: boolean;
  headline: string;
} {
  const hasConflicts = report.conflicts.length > 0;
  const hasErrors = report.errors.length > 0;
  const majorGaps = report.warnings.some((warning) =>
    ["TEAMS_COUNT", "GROUPS_COUNT", "MATCHES_COUNT", "TOURNAMENT_COUNT"].includes(
      warning.code,
    ),
  );
  if (hasErrors || hasConflicts || majorGaps || report.status === "FAIL") {
    return { ready: false, headline: "NOT READY FOR IMPORT" };
  }
  // Even a clean pack is only "ready pending approval" — Phase 1 never
  // imports, and a future import phase must demand an approval file.
  return {
    ready: true,
    headline: "VALIDATION CLEAN — import still requires the Phase 2 approval workflow",
  };
}

export function buildStewardReportMarkdown(input: {
  validation: ValidationReport;
  data: NormalizedDataSet;
  coverage: SourceCoverageEntry[];
  candidateCounts: Record<string, Record<string, number>>;
  /** Loaded manual reference pack, when present (for the pack section). */
  manualReferencePack?: ManualReferencePack | null;
  /** Candidate-provider enrichment summaries, when an enrichment run exists. */
  enrichmentProviders?: EnrichmentProviderSummary[] | null;
  /** Phase 2A human review status, when derivable. */
  humanReviewStatus?: HumanReviewStatus | null;
}): string {
  const { validation, data, coverage, candidateCounts } = input;
  const pack = input.manualReferencePack ?? null;
  const readiness = importReadiness(validation);
  const lines: string[] = [];

  lines.push("# 2026 Data Steward Report");
  lines.push("");
  lines.push(`Generated: ${validation.generatedAt}`);
  lines.push("");
  lines.push(`## Verdict: ${readiness.headline}`);
  lines.push("");
  lines.push(
    `Validation status: **${validation.status}** — ` +
      `${validation.errors.length} errors, ${validation.warnings.length} warnings, ` +
      `${validation.conflicts.length} conflicts.`,
  );
  lines.push("");
  lines.push("## Data integrity guarantees");
  lines.push("");
  lines.push(
    "- **No database writes occurred.** The Phase 1 pipeline reads and writes " +
      "only files under `data/2026/` — it never touches PostgreSQL or any " +
      "`Fixture`/`Match`/`Tournament`/`Team`/`Country`/`Stadium` record.",
  );
  lines.push("- There is no import script in Phase 1.");
  lines.push(
    "- **Approval gate:** any future import must be gated on a human-written " +
      "`data/2026/approved/approval.json` whose `validationReportHash` matches " +
      "the sha256 of the current `data/2026/validation/validation-report.json` " +
      "(see `data/2026/approved/README.md`).",
  );

  lines.push("");
  lines.push("## Source coverage");
  lines.push("");
  lines.push("| Source | Endpoints | Collected | Failed |");
  lines.push("| --- | ---: | ---: | ---: |");
  for (const entry of coverage) {
    lines.push(
      `| ${entry.sourceId} | ${entry.endpointsConfigured} | ${entry.endpointsCollected} | ${entry.endpointsFailed} |`,
    );
  }
  const failed = coverage.flatMap((entry) =>
    entry.failedEndpoints.map(
      (failure) => `- \`${entry.sourceId}/${failure.endpointId}\`: ${failure.errorMessage ?? "unknown error"}`,
    ),
  );
  if (failed.length > 0) {
    lines.push("");
    lines.push("Failed endpoints (collection continues without them):");
    lines.push("");
    lines.push(...failed);
  }

  lines.push("");
  lines.push("## Candidates found per source");
  lines.push("");
  const kinds = ["teams", "groups", "venues", "matches", "standings"];
  lines.push(`| Source | ${kinds.join(" | ")} |`);
  lines.push(`| --- | ${kinds.map(() => "---:").join(" | ")} |`);
  for (const [sourceId, counts] of Object.entries(candidateCounts).sort()) {
    lines.push(
      `| ${sourceId} | ${kinds.map((kind) => counts[kind] ?? 0).join(" | ")} |`,
    );
  }

  lines.push("");
  lines.push("## Normalized counts");
  lines.push("");
  for (const [key, value] of Object.entries(validation.counts)) {
    lines.push(`- ${key}: ${value}`);
  }

  const tournament = data.tournament;
  if (tournament !== null) {
    lines.push("");
    lines.push("## Tournament record");
    lines.push("");
    lines.push(
      `- ${tournament.name} (${tournament.tournamentYear}), hosts: ` +
        `${tournament.hostCountries.join(", ") || "unknown"}`,
    );
    lines.push(
      `- ${tournament.startDate ?? "?"} → ${tournament.endDate ?? "?"}; ` +
        `winner: ${tournament.winner ?? "unknown"}, runner-up: ${tournament.runnerUp ?? "unknown"}, ` +
        `third: ${tournament.thirdPlace ?? "unknown"}, fourth: ${tournament.fourthPlace ?? "unknown"}`,
    );
    lines.push(
      `- confidence: ${tournament.confidence}, verification: ${tournament.verificationStatus}`,
    );
  }

  // Derived observations — computed from the data set, not hand-written, so
  // they stay true when the pipeline is re-run against fresh snapshots.
  lines.push("");
  lines.push("## Observations (derived from this run)");
  lines.push("");
  const finished = data.matches.filter((match) => match.status === "FINISHED");
  const finishedBySource = new Map<string, number>();
  for (const match of finished) {
    for (const sourceId of match.sourceIds) {
      finishedBySource.set(sourceId, (finishedBySource.get(sourceId) ?? 0) + 1);
    }
  }
  for (const [sourceId, count] of [...finishedBySource.entries()].sort()) {
    lines.push(
      `- \`${sourceId}\` contributes to ${count} of ${finished.length} finished match records.`,
    );
  }
  const finalMatch = data.matches.find(
    (match) => match.stage === "FINAL" && match.status === "FINISHED",
  );
  if (finalMatch !== undefined) {
    lines.push(
      `- The final is recorded as finished: ${finalMatch.homeTeamName ?? "?"} ` +
        `${finalMatch.homeScore ?? "?"}–${finalMatch.awayScore ?? "?"} ` +
        `${finalMatch.awayTeamName ?? "?"} (winner: ${finalMatch.winnerTeamName ?? "unknown"}).`,
    );
  }
  const staleStatusConflicts = data.conflicts.filter(
    (conflict) =>
      conflict.entityType === "matches" &&
      conflict.field === "status" &&
      conflict.values.some((value) => value.value === "SCHEDULED") &&
      conflict.values.some((value) => value.value === "FINISHED"),
  );
  if (staleStatusConflicts.length > 0) {
    const staleSources = [
      ...new Set(
        staleStatusConflicts.flatMap((conflict) =>
          conflict.values
            .filter((value) => value.value === "SCHEDULED")
            .map((value) => value.sourceId),
        ),
      ),
    ].sort();
    lines.push(
      `- ${staleStatusConflicts.length} matches are FINISHED per one source but still ` +
        `SCHEDULED per ${staleSources.map((s) => `\`${s}\``).join(", ")} — that ` +
        "snapshot appears to be stale pre-tournament data (placeholder scores, " +
        "late-qualifier placeholders).",
    );
  }
  const standingsTableConflicts = data.conflicts.filter(
    (conflict) => conflict.entityType === "standings" && conflict.field === "table",
  );
  if (standingsTableConflicts.length > 0) {
    lines.push(
      `- Provider group tables disagree with match-derived standings in ` +
        `${standingsTableConflicts.length} groups (see conflict notes for per-team diffs).`,
    );
  }
  const placeholderTeams = data.teams.filter(
    (team) => team.confidence === "UNVERIFIED",
  );
  if (placeholderTeams.length > 0) {
    lines.push(
      `- ${placeholderTeams.length} qualification placeholder "teams" were preserved as ` +
        `UNVERIFIED (e.g. ${placeholderTeams
          .slice(0, 2)
          .map((team) => `"${team.name}"`)
          .join(", ")}) and excluded from real-team counts.`,
    );
  }

  // Manual verified reference pack — human-authenticated, highest priority,
  // never a direct import.
  lines.push("");
  lines.push("## Manual Verified Reference Pack");
  lines.push("");
  const packStats = validation.manualPack;
  if (!packStats.present || pack === null) {
    lines.push(
      "No manual reference pack loaded (`data/2026/reference/` is empty or absent).",
    );
  } else {
    lines.push(`- Pack ID: \`${packStats.packId}\``);
    lines.push(`- Pack hash: \`sha256:${packStats.packHash}\``);
    lines.push(
      `- Files loaded: ${packStats.filesLoaded} — ` +
        Object.entries(pack.fileHashes)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, hash]) => `${key} (\`${hash.slice(0, 12)}…\`)`)
          .join(", "),
    );
    lines.push("");
    lines.push("Coverage:");
    lines.push("");
    lines.push("| Area | Records | Notes |");
    lines.push("| --- | ---: | --- |");
    const verification = pack.tournament?.verification ?? "absent";
    lines.push(
      `| tournament | ${pack.tournament !== null ? 1 : 0} | ${verification} (champion/runner-up/third/fourth) |`,
    );
    lines.push(
      `| teams | ${pack.teams.length} | ${packStats.verifiedTeams} verified, ${packStats.unverifiedTeams} reported/partial/unverified |`,
    );
    lines.push(
      `| groups | ${pack.groups.length} | group letters resolved against other sources by team-set matching |`,
    );
    lines.push(
      `| matches | ${packStats.capturedMatchCount} | ${packStats.verifiedMatches} verified, ${packStats.unverifiedMatches} unverified; official total ${packStats.officialMatchCount} |`,
    );
    lines.push(
      `| standings | ${(pack.standings?.group_tables ?? []).length} tables + final top four | verified final standings |`,
    );
    lines.push(
      `| bracket | ${(pack.bracket?.rounds ?? []).length} rounds | knockout progression M73–M104 |`,
    );
    lines.push(`| venues | ${pack.venues.length} | includes FIFA-name vs stadium-name aliases |`);
    lines.push(
      `| awards | ${Object.keys(pack.awards).length} | reference only — no award import model in this phase |`,
    );
    lines.push(
      `| conflicts | ${packStats.knownConflicts} | known manual conflicts, preserved as UNRESOLVED |`,
    );
    lines.push("");
    lines.push(
      `Match coverage: **${packStats.capturedMatchCount} of ${packStats.officialMatchCount}** ` +
        `official matches captured (${packStats.verifiedMatches} verified, ` +
        `${packStats.unverifiedMatches} unverified).`,
    );
    lines.push("");
    lines.push(
      "**Import recommendation:** the manual reference pack is suitable as " +
        "high-priority supporting evidence for verified records, but not " +
        `sufficient for full automatic import because it captures ` +
        `${packStats.capturedMatchCount} of ${packStats.officialMatchCount} matches ` +
        "and explicitly records known data gaps. Partial/unverified records are " +
        "supporting context only and never become final values.",
    );
  }

  // Candidate enrichment providers — candidate/normalized/report output only.
  const enrichmentProviders = input.enrichmentProviders ?? [];
  if (enrichmentProviders.length > 0) {
    lines.push("");
    lines.push("## Candidate enrichment providers");
    lines.push("");
    lines.push(
      "Candidate providers contribute enrichment/analytics **candidates " +
        "only**: nothing below was imported, nothing is rendered publicly, " +
        "and the manual verified reference pack remains authoritative — " +
        "provider disagreements are reported as conflicts, never applied. " +
        "Details: `mominul-provider-report.md`, " +
        "`bustami-efi-provider-report.md`, `enrichment-coverage-report.json`, " +
        "`enrichment-conflict-report.json`.",
    );
    lines.push("");
    lines.push(
      "| Provider | Files ok/failed | Rows | Conflicts vs manual pack | Gap-fill candidates | Import recommendation |",
    );
    lines.push("| --- | --- | ---: | ---: | ---: | --- |");
    for (const provider of enrichmentProviders) {
      const totalRows = Object.values(provider.rowCounts).reduce(
        (sum, count) => sum + count,
        0,
      );
      lines.push(
        `| ${provider.sourceId} | ${provider.filesFetched}/${provider.filesFailed} | ` +
          `${totalRows} | ${provider.conflictsWithManualPack} | ` +
          `${provider.gapFillCandidates} | ${provider.importRecommendation} |`,
      );
    }
    const blocked = enrichmentProviders.filter(
      (provider) => provider.importBlockedReason !== null,
    );
    for (const provider of blocked) {
      lines.push("");
      lines.push(
        `⚠️ \`${provider.sourceId}\` carries a standing usage restriction — ` +
          `importBlockedReason: **${provider.importBlockedReason}** ` +
          "(research/analytics only until a license/usage review clears it; " +
          "never merged into the core public archive in this phase).",
      );
    }
  }

  // Phase 2A human review status — review-only: no DB writes, no import,
  // manual approval always required.
  const review =
    input.humanReviewStatus ??
    deriveHumanReviewStatus({
      packGeneratedAt: null,
      totalItems: 0,
      bySeverity: {},
      pendingItems: 0,
      reviewedItems: 0,
      blockImportDecisions: 0,
      importBlockingCount: 0,
      eligibleForApprovalCandidate: false,
      approvalCandidateExists: false,
    });
  lines.push("");
  lines.push("## Human Review Status");
  lines.push("");
  lines.push(`Status: **${review.label}**`);
  lines.push("");
  if (review.packGeneratedAt === null) {
    lines.push(
      "No review pack has been generated yet — run `pnpm data:2026:review-pack`.",
    );
  } else {
    lines.push(`- Review pack generated: ${review.packGeneratedAt}`);
    lines.push(`- Total review items: ${review.totalItems}`);
    lines.push(
      `- By severity: CRITICAL ${review.bySeverity.CRITICAL ?? 0}, ` +
        `HIGH ${review.bySeverity.HIGH ?? 0}, ` +
        `MEDIUM ${review.bySeverity.MEDIUM ?? 0}, ` +
        `LOW ${review.bySeverity.LOW ?? 0}`,
    );
    lines.push(`- Reviewed: ${review.reviewedItems}`);
    lines.push(`- Pending: ${review.pendingItems}`);
    lines.push(`- Blocked (BLOCK_IMPORT decisions): ${review.blockedItems}`);
    lines.push(
      `- Approval candidate: ${
        review.approvalCandidateExists
          ? "generated (`data/2026/approved/approval.candidate.json` — approvedForImport stays false until a human completes it)"
          : "not generated"
      }`,
    );
  }
  lines.push("");
  lines.push("Next required human actions:");
  lines.push("");
  for (const action of review.nextActions) {
    lines.push(`- ${action}`);
  }
  lines.push("");
  lines.push(
    "_Phase 2A guarantees: no database writes occurred, nothing was " +
      "imported, and manual approval is required — an import needs a " +
      "human-completed `data/2026/approved/approval.json`, which is never " +
      "auto-created._",
  );

  lines.push("");
  lines.push("## Conflicts");
  lines.push("");
  if (validation.conflicts.length === 0) {
    lines.push("No conflicts recorded.");
  } else {
    const byField = new Map<string, number>();
    for (const conflict of validation.conflicts) {
      const key = `${conflict.entityType}.${conflict.field}`;
      byField.set(key, (byField.get(key) ?? 0) + 1);
    }
    lines.push("| Conflict | Count |");
    lines.push("| --- | ---: |");
    for (const [key, count] of [...byField.entries()].sort()) {
      lines.push(`| ${key} | ${count} |`);
    }
    lines.push("");
    lines.push(
      "Full details in `data/2026/validation/conflict-report.json` and " +
        "`data/2026/normalized/conflicts.json`. Conflicts are reported, never " +
        "silently resolved; the normalizer keeps the highest-priority source's " +
        "value and flags the record.",
    );
  }

  lines.push("");
  lines.push("## Missing / flagged data");
  lines.push("");
  if (validation.errors.length === 0 && validation.warnings.length === 0) {
    lines.push("Nothing flagged.");
  } else {
    for (const issue of validation.errors) {
      lines.push(`- ERROR \`${issue.code}\`: ${issue.message}`);
    }
    for (const issue of validation.warnings.slice(0, 30)) {
      lines.push(`- WARN \`${issue.code}\`: ${issue.message}`);
    }
    if (validation.warnings.length > 30) {
      lines.push(
        `- …and ${validation.warnings.length - 30} more warnings (see validation-report.json).`,
      );
    }
  }

  lines.push("");
  lines.push("## Next recommended action");
  lines.push("");
  if (validation.recommendations.length === 0) {
    lines.push("- None.");
  } else {
    for (const recommendation of validation.recommendations) {
      lines.push(`- ${recommendation}`);
    }
  }

  lines.push("");
  lines.push("## Safe to import?");
  lines.push("");
  lines.push(
    readiness.ready
      ? "Validation is clean, but Phase 1 has no import path. Import requires " +
          "the Phase 2 approval workflow (approval file + reviewed data pack)."
      : "**NOT READY FOR IMPORT.** Conflicts and/or validation issues above " +
          "must be reviewed and resolved (or explicitly approved) first.",
  );
  lines.push("");

  return lines.join("\n");
}
