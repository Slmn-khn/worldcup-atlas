// 2026 Match Schedule & Results — completed-tournament archive page.
//
// Data comes from the FILE-backed archive source (verified reference pack +
// approved finalized artifacts) via getArchived2026Schedule(). This page does
// NOT read the live Fixture table, does not call providers, and never
// triggers a sync. Unresolved records render as "Under review" — never
// "Scheduled" (the tournament is over). Filters are URL-driven and applied
// server-side.

import type { Metadata } from "next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import PageContainer from "@/components/layout/PageContainer";
import VaultPageHeader from "@/components/vault/VaultPageHeader";
import EmptyState from "@/components/ui/EmptyState";
import VaultFilterBar, {
  type ActiveFilterItem,
  type FilterOptionDto,
} from "@/components/filters/VaultFilterBar";
import ArchivedScheduleTable, {
  ArchivedScheduleCards,
  groupArchivedRowsByDate,
} from "@/components/schedule/ArchivedScheduleTable";
import { atlas, eyebrowSx, tabularNums } from "@/theme/tokens";
import { getEnumParam, getStringParam, type RawSearchParams } from "@/lib/search-params";
import {
  getArchived2026Schedule,
  type Archived2026ScheduleRow,
} from "@/server/worldcup2026/archiveSchedule";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "2026 Match Schedule & Results",
  description:
    "Final fixtures, scores, venues, stages, and verification status from the completed 2026 FIFA World Cup — archived in WORLDCUP Nexus.",
};

// --- URL filter vocab ------------------------------------------------------

const STAGE_VALUES = [
  "group",
  "round_of_32",
  "round_of_16",
  "quarterfinal",
  "semifinal",
  "third_place",
  "final",
] as const;

const STATUS_FILTERS = {
  full_time: { label: "Full-time", statuses: ["FULL_TIME"] },
  aet: { label: "AET", statuses: ["AFTER_EXTRA_TIME"] },
  penalties: { label: "Penalties", statuses: ["PENALTIES"] },
  under_review: {
    label: "Result under review",
    statuses: ["RESULT_UNDER_REVIEW", "INCOMPLETE"],
  },
} as const;
type StatusFilterKey = keyof typeof STATUS_FILTERS;

const VERIFICATION_FILTERS = {
  verified: { label: "Verified", levels: ["VERIFIED"] },
  reported: { label: "Reported", levels: ["REPORTED"] },
  partial: { label: "Partial", levels: ["PARTIAL"] },
  needs_review: {
    label: "Needs review",
    levels: ["NEEDS_REVIEW", "UNVERIFIED"],
  },
} as const;
type VerificationFilterKey = keyof typeof VERIFICATION_FILTERS;

function rowMatchesSearch(row: Archived2026ScheduleRow, q: string): boolean {
  const needle = q.toLowerCase();
  return [
    row.homeTeamName,
    row.homeTeamCode,
    row.awayTeamName,
    row.awayTeamCode,
    row.venueName,
    row.cityName,
    row.stage,
    row.groupName,
    row.matchId,
  ].some((value) => value != null && value.toLowerCase().includes(needle));
}

// --- header stat band ------------------------------------------------------

function StatTile({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <Box
      sx={{
        border: `1px solid ${accent ? atlas.goldBorder : atlas.border}`,
        bgcolor: atlas.surfaceSoft,
        px: 2,
        py: 1.5,
        minWidth: 0,
      }}
    >
      <Typography
        component="p"
        sx={{ ...eyebrowSx, fontSize: "0.6rem", color: atlas.textMuted, mb: 0.75 }}
      >
        {label}
      </Typography>
      <Typography
        component="p"
        sx={{
          ...tabularNums,
          fontFamily: atlas.fontDisplay,
          fontWeight: 900,
          fontSize: "1.05rem",
          color: accent ? atlas.gold : atlas.bodyStrong,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}

// --- page ------------------------------------------------------------------

type Props = { searchParams: Promise<RawSearchParams> };

export default async function Schedule2026Page({ searchParams }: Props) {
  const [params, result] = await Promise.all([
    searchParams,
    getArchived2026Schedule(),
  ]);

  const filters = {
    q: getStringParam(params, "q"),
    stage: getEnumParam(params, "stage", STAGE_VALUES),
    group: getStringParam(params, "group", 3),
    status: getEnumParam(
      params,
      "status",
      Object.keys(STATUS_FILTERS) as StatusFilterKey[],
    ),
    verification: getEnumParam(
      params,
      "verification",
      Object.keys(VERIFICATION_FILTERS) as VerificationFilterKey[],
    ),
  };

  const rows = result.rows.filter((row) => {
    if (filters.q !== undefined && !rowMatchesSearch(row, filters.q)) {
      return false;
    }
    if (filters.stage !== undefined && row.stageKey !== filters.stage) {
      return false;
    }
    if (
      filters.group !== undefined &&
      row.groupName !== `Group ${filters.group.toUpperCase()}`
    ) {
      return false;
    }
    if (
      filters.status !== undefined &&
      !(STATUS_FILTERS[filters.status].statuses as readonly string[]).includes(
        row.status,
      )
    ) {
      return false;
    }
    if (
      filters.verification !== undefined &&
      !(
        VERIFICATION_FILTERS[filters.verification].levels as readonly string[]
      ).includes(row.verification)
    ) {
      return false;
    }
    return true;
  });

  // Filter options are derived from the archive rows — nothing hardcoded.
  const stageOptions: FilterOptionDto[] = STAGE_VALUES.filter((key) =>
    result.rows.some((row) => row.stageKey === key),
  ).map((key) => ({
    value: key,
    label: result.rows.find((row) => row.stageKey === key)?.stage ?? key,
    count: result.rows.filter((row) => row.stageKey === key).length,
  }));
  const groupLetters = [
    ...new Set(
      result.rows
        .map((row) => row.groupName)
        .filter((name): name is string => name != null)
        .map((name) => name.replace(/^Group\s+/i, "")),
    ),
  ].sort();
  const groupOptions: FilterOptionDto[] = groupLetters.map((letter) => ({
    value: letter,
    label: `Group ${letter}`,
  }));
  const statusOptions: FilterOptionDto[] = (
    Object.entries(STATUS_FILTERS) as [
      StatusFilterKey,
      (typeof STATUS_FILTERS)[StatusFilterKey],
    ][]
  ).map(([value, meta]) => ({
    value,
    label: meta.label,
    count: result.rows.filter((row) =>
      (meta.statuses as readonly string[]).includes(row.status),
    ).length,
  }));
  const verificationOptions: FilterOptionDto[] = (
    Object.entries(VERIFICATION_FILTERS) as [
      VerificationFilterKey,
      (typeof VERIFICATION_FILTERS)[VerificationFilterKey],
    ][]
  )
    .map(([value, meta]) => ({
      value,
      label: meta.label,
      count: result.rows.filter((row) =>
        (meta.levels as readonly string[]).includes(row.verification),
      ).length,
    }))
    .filter((option) => option.count > 0);

  const active: ActiveFilterItem[] = [
    filters.q !== undefined
      ? { param: "q", label: "Search", value: filters.q }
      : null,
    filters.stage !== undefined
      ? {
          param: "stage",
          label: "Stage",
          value:
            stageOptions.find((option) => option.value === filters.stage)
              ?.label ?? filters.stage,
        }
      : null,
    filters.group !== undefined
      ? { param: "group", label: "Group", value: `Group ${filters.group.toUpperCase()}` }
      : null,
    filters.status !== undefined
      ? {
          param: "status",
          label: "Result",
          value: STATUS_FILTERS[filters.status].label,
        }
      : null,
    filters.verification !== undefined
      ? {
          param: "verification",
          label: "Verification",
          value: VERIFICATION_FILTERS[filters.verification].label,
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null);

  // Champion / final summary — derived from the archived final row, never
  // hardcoded.
  const finalRow = result.rows.find((row) => row.stageKey === "final");
  const championName =
    finalRow?.winnerTeamCode != null
      ? finalRow.winnerTeamCode === finalRow.homeTeamCode
        ? (finalRow.homeTeamName ?? finalRow.winnerTeamCode)
        : (finalRow.awayTeamName ?? finalRow.winnerTeamCode)
      : null;
  const finalSummary =
    finalRow != null && finalRow.homeScore != null && finalRow.awayScore != null
      ? `${finalRow.homeTeamName ?? finalRow.homeTeamCode} ${finalRow.homeScore}–${finalRow.awayScore} ${finalRow.awayTeamName ?? finalRow.awayTeamCode}${
          finalRow.status === "AFTER_EXTRA_TIME"
            ? " AET"
            : finalRow.status === "PENALTIES"
              ? " (pens)"
              : ""
        }`
      : null;

  const groups = groupArchivedRowsByDate(rows);

  return (
    <Box>
      <VaultPageHeader
        eyebrow="2026 World Cup"
        title="2026 Match Schedule & Results"
        lede="Final fixtures, scores, venues, stages, and verification status from the completed 2026 World Cup archive."
        meta={
          result.lastUpdatedLabel !== undefined
            ? `Archived 2026 data · verified sources and reviewed conflicts · ${result.lastUpdatedLabel}`
            : "Archived 2026 data · verified sources and reviewed conflicts"
        }
      >
        <Box
          sx={{
            display: "grid",
            gap: 1.5,
            gridTemplateColumns: {
              xs: "repeat(2, minmax(0, 1fr))",
              sm: "repeat(3, minmax(0, 1fr))",
              lg: "repeat(6, minmax(0, 1fr))",
            },
          }}
        >
          <StatTile
            label="Official matches"
            value={String(result.totalOfficialMatches)}
          />
          <StatTile
            label="Captured results"
            value={String(result.capturedMatches)}
          />
          <StatTile label="Verified" value={String(result.verifiedCount)} />
          <StatTile
            label="Under review"
            value={String(result.unresolvedCount)}
          />
          {championName !== null ? (
            <StatTile label="Champion" value={championName} accent />
          ) : null}
          {finalSummary !== null ? (
            <StatTile label="Final" value={finalSummary} accent />
          ) : null}
        </Box>
      </VaultPageHeader>

      <PageContainer sx={{ py: { xs: 5, md: 7 } }}>
        <VaultFilterBar
          label="Archive Controls"
          fields={[
            { kind: "search", placeholder: "Search team, venue, stage…" },
            {
              kind: "select",
              param: "stage",
              label: "Stage",
              options: stageOptions,
              allLabel: "All stages",
            },
            {
              kind: "select",
              param: "group",
              label: "Group",
              options: groupOptions,
              allLabel: "All groups",
            },
            {
              kind: "select",
              param: "status",
              label: "Result",
              options: statusOptions,
              allLabel: "All results",
            },
            {
              kind: "select",
              param: "verification",
              label: "Verification",
              options: verificationOptions,
              allLabel: "All verification levels",
            },
          ]}
          active={active}
          resultCount={rows.length}
          totalCount={result.capturedMatches}
          resultNoun="matches"
        />

        {result.capturedMatches < result.totalOfficialMatches ? (
          <Typography
            variant="body2"
            sx={{ ...tabularNums, color: atlas.textMuted, mt: 2 }}
          >
            {result.capturedMatches} of {result.totalOfficialMatches} official
            matches are captured in the archive so far; unresolved results are
            shown as “Under review”, never guessed.
          </Typography>
        ) : null}

        <Box sx={{ mt: 4 }}>
          {rows.length === 0 ? (
            <EmptyState
              title="No matches fit these filters"
              description={
                result.rows.length === 0
                  ? "The 2026 archive pack is unavailable. Regenerate it with pnpm data:2026:display-schedule."
                  : "No archived 2026 match fits the current filters. Try clearing a filter or searching a different team."
              }
            />
          ) : (
            <>
              {/* Desktop: grouped table. */}
              <Box sx={{ display: { xs: "none", md: "block" } }}>
                <ArchivedScheduleTable groups={groups} />
              </Box>
              {/* Mobile: stacked cards by date. */}
              <Box sx={{ display: { xs: "block", md: "none" } }}>
                <ArchivedScheduleCards groups={groups} />
              </Box>
            </>
          )}
        </Box>
      </PageContainer>
    </Box>
  );
}
