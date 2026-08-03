// 2026 Match Schedule & Scores — full, database-backed, URL-filterable.
// Fixtures are grouped by date; a desktop table and mobile cards render the
// same canonical data. No fixture data is hardcoded; nothing is fetched from a
// third-party provider here (the fixture pipeline syncs into PostgreSQL first).

import type { Metadata } from "next";
import Box from "@mui/material/Box";
import PageContainer from "@/components/layout/PageContainer";
import VaultPageHeader from "@/components/vault/VaultPageHeader";
import EmptyState from "@/components/ui/EmptyState";
import ScheduleFilters from "@/components/fixtures/ScheduleFilters";
import ScheduleTable, {
  type FixtureDayGroup,
} from "@/components/fixtures/ScheduleTable";
import FixtureDateGroup from "@/components/fixtures/FixtureDateGroup";
import FixtureFreshnessNote from "@/components/fixtures/FixtureFreshnessNote";
import { fixtureDateLabel } from "@/components/fixtures/fixtureDisplay";
import { formatStage } from "@/lib/format";
import {
  getEnumParam,
  getStringParam,
  type RawSearchParams,
} from "@/lib/search-params";
import {
  getFixtureFreshness2026,
  getScheduleFilterMeta2026,
  getSchedule2026,
} from "@/server/fixtures/queries";
import { isPostTournamentArchiveMode } from "@/config/features";
import type { FixtureStatusValue } from "@/server/fixtures/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "2026 World Cup Schedule & Scores",
  description:
    "The full 2026 FIFA World Cup match schedule — fixtures, results, venues, groups, and match status in the WORLDCUP Nexus archive.",
};

const STATUS_VALUES: FixtureStatusValue[] = [
  "SCHEDULED",
  "LIVE",
  "HALF_TIME",
  "FINISHED",
  "POSTPONED",
  "CANCELLED",
  "UNKNOWN",
];

type Props = { searchParams: Promise<RawSearchParams> };

export default async function Schedule2026Page({ searchParams }: Props) {
  const archiveMode = isPostTournamentArchiveMode();
  const params = await searchParams;
  const filters = {
    q: getStringParam(params, "q"),
    status: getEnumParam(params, "status", STATUS_VALUES),
    group: getStringParam(params, "group"),
    stage: getStringParam(params, "stage"),
  };

  const [fixtures, meta, freshness] = await Promise.all([
    getSchedule2026({
      q: filters.q,
      status: filters.status,
      groupName: filters.group,
      stage: filters.stage,
    }),
    getScheduleFilterMeta2026(),
    getFixtureFreshness2026(),
  ]);

  // Group by date label (fixtures are already kick-off ascending).
  const groups: FixtureDayGroup[] = [];
  for (const fixture of fixtures) {
    const label = fixtureDateLabel(fixture) ?? "Date to be confirmed";
    const last = groups[groups.length - 1];
    if (last !== undefined && last.dateLabel === label) {
      last.fixtures.push(fixture);
    } else {
      groups.push({ dateLabel: label, fixtures: [fixture] });
    }
  }

  const active = [
    filters.q !== undefined
      ? { param: "q", label: "Search", value: filters.q }
      : null,
    filters.status !== undefined
      ? {
          param: "status",
          label: "Status",
          value:
            meta.statuses.find((option) => option.value === filters.status)
              ?.label ?? filters.status,
        }
      : null,
    filters.group !== undefined
      ? { param: "group", label: "Group", value: filters.group }
      : null,
    filters.stage !== undefined
      ? {
          param: "stage",
          label: "Stage",
          value: formatStage(filters.stage) ?? filters.stage,
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null);

  return (
    <Box>
      <VaultPageHeader
        eyebrow="2026 World Cup"
        title="2026 Match Schedule & Scores"
        lede={
          archiveMode
            ? "Every 2026 fixture, result, venue, and group — the completed tournament, archived and rendered from the Nexus database."
            : "Latest fixtures, results, venues, groups, and match status — synced into the archive, then rendered here."
        }
      >
        <FixtureFreshnessNote freshness={freshness} archiveMode={archiveMode} />
      </VaultPageHeader>

      <PageContainer sx={{ py: { xs: 5, md: 7 } }}>
        <ScheduleFilters
          options={{
            statuses: meta.statuses,
            groups: meta.groups,
            stages: meta.stages.map((option) => ({
              ...option,
              label: formatStage(option.label) ?? option.label,
            })),
          }}
          active={active}
          resultCount={fixtures.length}
          totalCount={meta.total}
        />

        <Box sx={{ mt: 4 }}>
          {fixtures.length === 0 ? (
            <EmptyState
              title="No matches fit these filters"
              description={
                meta.total === 0
                  ? "The 2026 schedule has not been synced yet. Once a sync runs, fixtures appear here."
                  : "No 2026 fixture matches the current filters. Try clearing a filter or searching a different team."
              }
            />
          ) : (
            <>
              {/* Desktop: grouped table. */}
              <Box sx={{ display: { xs: "none", md: "block" } }}>
                <ScheduleTable groups={groups} />
              </Box>
              {/* Mobile: stacked cards by date. */}
              <Box sx={{ display: { xs: "block", md: "none" } }}>
                {groups.map((group) => (
                  <FixtureDateGroup
                    key={group.dateLabel}
                    dateLabel={group.dateLabel}
                    fixtures={group.fixtures}
                    columns={{ xs: "1fr" }}
                  />
                ))}
              </Box>
            </>
          )}
        </Box>
      </PageContainer>
    </Box>
  );
}
