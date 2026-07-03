// All Discoveries — the Discovery Vault archive listing. URL-driven search +
// category + difficulty filters (VaultFilterBar), same pattern as the other
// archive index pages. Only PUBLISHED facts are ever listed.

import type { Metadata } from "next";
import Box from "@mui/material/Box";
import PageShell from "@/components/ui/PageShell";
import PageHero from "@/components/ui/PageHero";
import EmptyState from "@/components/ui/EmptyState";
import DataPanel from "@/components/ui/DataPanel";
import VaultFilterBar from "@/components/filters/VaultFilterBar";
import FactCard from "@/components/facts/FactCard";
import DiscoveryProgress from "@/components/facts/DiscoveryProgress";
import DiscoveryBadges from "@/components/facts/DiscoveryBadges";
import {
  getEnumParam,
  getStringParam,
  type RawSearchParams,
} from "@/lib/search-params";
import {
  getPublishedFactCategories,
  getPublishedFacts,
} from "@/server/facts/queries";
import { FACT_CATEGORY_LABELS, FACT_DIFFICULTY_LABELS } from "@/lib/factFormat";
import type { FactCategory, FactDifficulty } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "All Discoveries",
  description:
    "Search every World Cup fact, record, comparison, and hidden story in the Nexus archive.",
};

const CATEGORY_VALUES = Object.keys(FACT_CATEGORY_LABELS) as FactCategory[];
const DIFFICULTY_VALUES = Object.keys(FACT_DIFFICULTY_LABELS) as FactDifficulty[];

type Props = { searchParams: Promise<RawSearchParams> };

export default async function FactsPage({ searchParams }: Props) {
  const params = await searchParams;
  const filters = {
    q: getStringParam(params, "q"),
    category: getEnumParam(params, "category", CATEGORY_VALUES),
    difficulty: getEnumParam(params, "difficulty", DIFFICULTY_VALUES),
  };

  const [facts, probe, availableCategories] = await Promise.all([
    getPublishedFacts(filters),
    // Cheap existence probe — distinguishes "no facts published yet" from
    // "no facts match these filters" for the empty state below.
    getPublishedFacts({ limit: 1 }),
    getPublishedFactCategories(),
  ]);
  const hasAnyPublished = probe.length > 0;

  const categoryOptions = availableCategories.map((category) => ({
    label: FACT_CATEGORY_LABELS[category],
    value: category,
  }));
  const difficultyOptions = DIFFICULTY_VALUES.map((difficulty) => ({
    label: FACT_DIFFICULTY_LABELS[difficulty],
    value: difficulty,
  }));

  const active = [
    filters.q !== undefined
      ? { param: "q", label: "Search", value: filters.q }
      : null,
    filters.category !== undefined
      ? {
          param: "category",
          label: "Category",
          value: FACT_CATEGORY_LABELS[filters.category],
        }
      : null,
    filters.difficulty !== undefined
      ? {
          param: "difficulty",
          label: "Difficulty",
          value: FACT_DIFFICULTY_LABELS[filters.difficulty],
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null);

  return (
    <Box>
      <PageHero
        eyebrow="Discovery Vault"
        title="All Discoveries"
        subtitle="Search every World Cup fact, record, comparison, and hidden story in the Nexus archive."
        accent="cyan"
      />

      <PageShell framed sx={{ py: { xs: 4, md: 6 } }}>
        <DataPanel label="Your Progress" sx={{ mb: 3 }}>
          <Box
            sx={{
              display: "flex",
              flexDirection: { xs: "column", sm: "row" },
              gap: { xs: 2, sm: 4 },
              alignItems: { sm: "flex-start" },
            }}
          >
            <DiscoveryProgress />
            <DiscoveryBadges />
          </Box>
        </DataPanel>

        <VaultFilterBar
          fields={[
            { kind: "search", placeholder: "Search discoveries…" },
            {
              kind: "select",
              param: "category",
              label: "Category",
              options: categoryOptions,
              allLabel: "All categories",
            },
            {
              kind: "select",
              param: "difficulty",
              label: "Difficulty",
              options: difficultyOptions,
              allLabel: "All difficulties",
            },
          ]}
          active={active}
          resultCount={facts.length}
          resultNoun="discoveries"
        />

        <Box sx={{ mt: 4 }}>
          {facts.length > 0 ? (
            <Box
              sx={{
                display: "grid",
                gap: 3,
                gridTemplateColumns: {
                  xs: "1fr",
                  sm: "1fr 1fr",
                  md: "repeat(3, 1fr)",
                },
              }}
            >
              {facts.map((fact) => (
                <FactCard key={fact.id} fact={fact} />
              ))}
            </Box>
          ) : hasAnyPublished ? (
            <EmptyState
              title="No discoveries match these filters"
              description="Try a different search term, category, or difficulty — or clear the filters."
            />
          ) : (
            <EmptyState
              title="Discovery Vault facts are being prepared."
              description="Check back soon for World Cup facts, records, and stories."
            />
          )}
        </Box>
      </PageShell>
    </Box>
  );
}
