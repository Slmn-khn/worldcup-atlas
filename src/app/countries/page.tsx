// Countries index page — database-backed with URL-driven Vault archive
// controls (Checkpoint 7D).

import type { Metadata } from "next";
import Box from "@mui/material/Box";
import PageContainer from "@/components/layout/PageContainer";
import VaultPageHeader from "@/components/vault/VaultPageHeader";
import VaultFilterBar from "@/components/filters/VaultFilterBar";
import EmptyState from "@/components/ui/EmptyState";
import CountryCard from "@/components/countries/CountryCard";
import { formatNumber } from "@/lib/format";
import {
  getBooleanParam,
  getEnumParam,
  getNumberParam,
  getStringParam,
  type RawSearchParams,
} from "@/lib/search-params";
import { getCountryIndex } from "@/server/queries/countries";
import type { CountrySort } from "@/server/queries/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "World Cup Nations",
  description: "Explore every World Cup nation in the WORLDCUP Nexus archive.",
};

const SORTS: CountrySort[] = [
  "name",
  "most-tournaments",
  "most-matches",
  "most-goals",
  "most-titles",
];
const SORT_OPTIONS = [
  { label: "Name (A–Z)", value: "name" },
  { label: "Most tournaments", value: "most-tournaments" },
  { label: "Most matches", value: "most-matches" },
  { label: "Most goals", value: "most-goals" },
  { label: "Most titles", value: "most-titles" },
];
const TITLE_OPTIONS = [
  { label: "World champions only", value: "true" },
  { label: "Never champions", value: "false" },
];
const MIN_TOURNAMENT_OPTIONS = [5, 10, 15, 20].map((n) => ({
  label: `${n}+ tournaments`,
  value: String(n),
}));

type Props = { searchParams: Promise<RawSearchParams> };

export default async function CountriesPage({ searchParams }: Props) {
  const params = await searchParams;
  const filters = {
    q: getStringParam(params, "q"),
    hasTitles: getBooleanParam(params, "hasTitles"),
    minTournaments: getNumberParam(params, "minTournaments", {
      min: 1,
      max: 100,
    }),
    sort: getEnumParam(params, "sort", SORTS),
  };
  const index = await getCountryIndex(filters);

  const active = [
    filters.q !== undefined
      ? { param: "q", label: "Search", value: filters.q }
      : null,
    filters.hasTitles !== undefined
      ? {
          param: "hasTitles",
          label: "Titles",
          value: filters.hasTitles ? "Champions" : "Never champions",
        }
      : null,
    filters.minTournaments !== undefined
      ? {
          param: "minTournaments",
          label: "Entries",
          value: `${filters.minTournaments}+`,
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null);

  return (
    <Box>
      <VaultPageHeader
        title="World Cup Nations"
        lede="Explore every nation and team history recorded in the WORLDCUP Nexus database."
        meta={`${formatNumber(index.total)} nations in the historical archive (1930–2022) · 2026 squads and results live in the 2026 archive hub`}
      />

      <PageContainer sx={{ py: { xs: 5, md: 7 } }}>
        <VaultFilterBar
          fields={[
            { kind: "search", placeholder: "Search nations…" },
            {
              kind: "select",
              param: "hasTitles",
              label: "Titles",
              options: TITLE_OPTIONS,
              allLabel: "All nations",
            },
            {
              kind: "select",
              param: "minTournaments",
              label: "Min entries",
              options: MIN_TOURNAMENT_OPTIONS,
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
          resultNoun="nations"
        />

        <Box sx={{ mt: 4 }}>
          {index.countries.length > 0 ? (
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
              {index.countries.map((country) => (
                <CountryCard
                  key={country.id}
                  name={country.name}
                  flagEmoji={country.flagEmoji}
                  code={country.code}
                  tournamentsCount={country.tournamentsEntered}
                  matchesCount={country.matchesCount}
                  goalsCount={country.goalsFor}
                  titlesCount={country.titlesCount}
                  href={`/countries/${country.slug}`}
                />
              ))}
            </Box>
          ) : index.total === 0 ? (
            <EmptyState
              title="No countries yet"
              description="Country data has not been imported. Run the data import pipeline and refresh."
            />
          ) : (
            <EmptyState
              title="No nations match these filters"
              description="Try a different search or clear the filters."
            />
          )}
        </Box>
      </PageContainer>
    </Box>
  );
}
