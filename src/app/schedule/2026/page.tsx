// 2026 Match Schedule & Results — completed-tournament archive page.
//
// Data source order (scheduleSource.ts): imported WorldCup2026Match rows
// (Mominul-only DB import) first, then the file-backed archive chain. This
// page never reads the legacy live Fixture table, never calls providers, and
// never triggers a sync. Every row is a final result — no "Scheduled" rows;
// anything unresolved renders as "Under review". Filters are URL-driven and
// applied server-side.

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
import type { Archived2026ScheduleRow } from "@/server/worldcup2026/archiveSchedule";
import { getSchedule2026ForDisplay } from "@/server/worldcup2026/scheduleSource";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "2026 Match Schedule & Results",
  description:
    "Completed tournament fixtures, scores, venues, and match details from the 2026 World Cup archive dataset.",
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
  const [params, display] = await Promise.all([
    searchParams,
    getSchedule2026ForDisplay(),
  ]);
  const { result, sourceLabel, teamsCount, venuesCount } = display;

  const filters = {
    q: getStringParam(params, "q"),
    stage: getEnumParam(params, "stage", STAGE_VALUES),
    group: getStringParam(params, "group", 3),
    team: getStringParam(params, "team", 8),
    venue: getStringParam(params, "venue", 80),
    status: getEnumParam(
      params,
      "status",
      Object.keys(STATUS_FILTERS) as StatusFilterKey[],
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
      filters.team !== undefined &&
      row.homeTeamCode !== filters.team &&
      row.awayTeamCode !== filters.team
    ) {
      return false;
    }
    if (filters.venue !== undefined && row.venueName !== filters.venue) {
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
  const teamOptions: FilterOptionDto[] = [
    ...new Map(
      result.rows
        .flatMap((row) => [
          [row.homeTeamCode, row.homeTeamName] as const,
          [row.awayTeamCode, row.awayTeamName] as const,
        ])
        .filter(
          (entry): entry is [string, string] =>
            entry[0] != null && entry[1] != null,
        ),
    ).entries(),
  ]
    .map(([code, name]) => ({ value: code, label: name }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const venueOptions: FilterOptionDto[] = [
    ...new Set(
      result.rows
        .map((row) => row.venueName)
        .filter((name): name is string => name != null),
    ),
  ]
    .sort()
    .map((name) => ({ value: name, label: name }));
  const statusOptions: FilterOptionDto[] = (
    Object.entries(STATUS_FILTERS) as [
      StatusFilterKey,
      (typeof STATUS_FILTERS)[StatusFilterKey],
    ][]
  )
    .map(([value, meta]) => ({
      value,
      label: meta.label,
      count: result.rows.filter((row) =>
        (meta.statuses as readonly string[]).includes(row.status),
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
    filters.team !== undefined
      ? {
          param: "team",
          label: "Team",
          value:
            teamOptions.find((option) => option.value === filters.team)?.label ??
            filters.team,
        }
      : null,
    filters.venue !== undefined
      ? { param: "venue", label: "Venue", value: filters.venue }
      : null,
    filters.status !== undefined
      ? {
          param: "status",
          label: "Result",
          value: STATUS_FILTERS[filters.status].label,
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null);

  // Champion / final summary — derived from the archived final row.
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
        lede="Completed tournament fixtures, scores, venues, and match details from the 2026 archive dataset."
        meta={`Archived completed tournament · ${sourceLabel}`}
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
            label="Matches"
            value={String(result.totalOfficialMatches)}
          />
          {teamsCount !== null ? (
            <StatTile label="Teams" value={String(teamsCount)} />
          ) : (
            <StatTile
              label="Captured results"
              value={String(result.capturedMatches)}
            />
          )}
          {venuesCount !== null ? (
            <StatTile label="Venues" value={String(venuesCount)} />
          ) : (
            <StatTile label="Verified" value={String(result.verifiedCount)} />
          )}
          {result.unresolvedCount > 0 ? (
            <StatTile
              label="Under review"
              value={String(result.unresolvedCount)}
            />
          ) : null}
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
              param: "team",
              label: "Team",
              options: teamOptions,
              allLabel: "All teams",
            },
            {
              kind: "select",
              param: "venue",
              label: "Venue",
              options: venueOptions,
              allLabel: "All venues",
            },
            {
              kind: "select",
              param: "status",
              label: "Result",
              options: statusOptions,
              allLabel: "All results",
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
                  ? "The 2026 archive is unavailable. Import it with pnpm data:2026:mominul:import:write or regenerate the pack with pnpm data:2026:mominul:approved-pack."
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
