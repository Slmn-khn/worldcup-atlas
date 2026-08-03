// Players index page — database-backed, paged, with URL-driven Vault
// archive controls (Checkpoint 7D). Squad counts are selections, never
// "appearances".

import type { Metadata } from "next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import PageContainer from "@/components/layout/PageContainer";
import VaultPageHeader from "@/components/vault/VaultPageHeader";
import VaultFilterBar from "@/components/filters/VaultFilterBar";
import VaultPager from "@/components/filters/VaultPager";
import EmptyState from "@/components/ui/EmptyState";
import PlayerCard from "@/components/players/PlayerCard";
import { formatNumber } from "@/lib/format";
import {
  getBooleanParam,
  getEnumParam,
  getPaginationParams,
  getStringParam,
  type RawSearchParams,
} from "@/lib/search-params";
import { getPlayerIndex } from "@/server/queries/players";
import type { PlayerSort } from "@/server/queries/types";
import { atlas } from "@/theme/tokens";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "World Cup Players",
  description: "Explore World Cup players in the WORLDCUP Nexus archive.",
};

const SORTS: PlayerSort[] = [
  "name",
  "most-goals",
  "most-awards",
  "most-cards",
  "most-squad-tournaments",
];
const SORT_OPTIONS = [
  { label: "Name (A–Z)", value: "name" },
  { label: "Most goals", value: "most-goals" },
  { label: "Most awards", value: "most-awards" },
  { label: "Most cards", value: "most-cards" },
  { label: "Most squad tournaments", value: "most-squad-tournaments" },
];
const HAS_OPTIONS = [{ label: "Yes", value: "true" }];

type Props = { searchParams: Promise<RawSearchParams> };

export default async function PlayersPage({ searchParams }: Props) {
  const params = await searchParams;
  const { page, pageSize } = getPaginationParams(params, {
    defaultPageSize: 60,
    maxPageSize: 100,
  });
  const filters = {
    q: getStringParam(params, "q"),
    countrySlug: getStringParam(params, "countrySlug"),
    position: getStringParam(params, "position"),
    hasGoals: getBooleanParam(params, "hasGoals"),
    hasAwards: getBooleanParam(params, "hasAwards"),
    hasCards: getBooleanParam(params, "hasCards"),
    sort: getEnumParam(params, "sort", SORTS),
    page,
    pageSize,
  };
  const index = await getPlayerIndex(filters);

  const countryName =
    index.options.countries.find(
      (option) => option.value === filters.countrySlug,
    )?.label ?? filters.countrySlug;

  const active = [
    filters.q !== undefined
      ? { param: "q", label: "Search", value: filters.q }
      : null,
    filters.countrySlug !== undefined
      ? { param: "countrySlug", label: "Nation", value: countryName ?? "" }
      : null,
    filters.position !== undefined
      ? { param: "position", label: "Position", value: filters.position }
      : null,
    filters.hasGoals === true
      ? { param: "hasGoals", label: "Goals", value: "Has goals" }
      : null,
    filters.hasAwards === true
      ? { param: "hasAwards", label: "Awards", value: "Has awards" }
      : null,
    filters.hasCards === true
      ? { param: "hasCards", label: "Cards", value: "Has cards" }
      : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null);

  return (
    <Box>
      <VaultPageHeader
        title="World Cup Players"
        lede="Explore players recorded across World Cup squads, goals, cards, penalties, and awards."
        meta={`${formatNumber(index.total)} players in the historical archive (1930–2022) · 2026 squads live in the 2026 archive hub`}
      />

      <PageContainer sx={{ py: { xs: 5, md: 7 } }}>
        <VaultFilterBar
          fields={[
            { kind: "search", placeholder: "Search players…" },
            {
              kind: "select",
              param: "countrySlug",
              label: "Nation",
              options: index.options.countries,
              allLabel: "All nations",
            },
            {
              kind: "select",
              param: "position",
              label: "Position",
              options: index.options.positions,
              allLabel: "All positions",
            },
            {
              kind: "select",
              param: "hasGoals",
              label: "Has goals",
              options: HAS_OPTIONS,
              allLabel: "Any",
            },
            {
              kind: "select",
              param: "hasAwards",
              label: "Has awards",
              options: HAS_OPTIONS,
              allLabel: "Any",
            },
            {
              kind: "select",
              param: "sort",
              label: "Sort",
              options: SORT_OPTIONS,
              allLabel: "Name (A–Z)",
            },
          ]}
          active={active}
          resultCount={index.filteredTotal}
          totalCount={index.total}
          resultNoun="players"
        />

        <Box sx={{ mt: 4 }}>
          {index.players.length > 0 ? (
            <>
              <Box
                sx={{
                  display: "grid",
                  gap: 3,
                  gridTemplateColumns: {
                    xs: "1fr",
                    sm: "1fr 1fr",
                    md: "repeat(3, 1fr)",
                    lg: "repeat(4, 1fr)",
                  },
                }}
              >
                {index.players.map((player) => (
                  <PlayerCard
                    key={player.id}
                    name={player.name}
                    country={player.countryName ?? "Nation unknown"}
                    flagEmoji={player.countryFlagEmoji}
                    position={player.position}
                    selectedTournamentsCount={player.selectedTournamentsCount}
                    goalsCount={player.goalsCount}
                    awardsCount={player.awardsCount}
                    href={`/players/${player.slug}`}
                  />
                ))}
              </Box>
              <VaultPager
                basePath="/players"
                page={index.page}
                pageSize={index.pageSize}
                filteredTotal={index.filteredTotal}
                params={params}
              />
              {filters.sort === "most-goals" ? (
                <Typography
                  variant="caption"
                  sx={{ color: atlas.textMuted, display: "block", mt: 2 }}
                >
                  Sorted by recorded goals (own goals excluded). Players with
                  no recorded goals are not listed under this sort.
                </Typography>
              ) : null}
            </>
          ) : index.total === 0 ? (
            <EmptyState
              title="No players yet"
              description="Player data has not been imported. Run the data import pipeline and refresh."
            />
          ) : (
            <EmptyState
              title="No players match these filters"
              description="Try a different name, nation, or position — or clear the filters."
            />
          )}
        </Box>
      </PageContainer>
    </Box>
  );
}
