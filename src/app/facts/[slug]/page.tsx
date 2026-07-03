// Fact detail page — a single Discovery Vault story. Unpublished/missing
// facts 404; content is rendered from unlimited content blocks plus a
// sources list and related-facts rail. See docs/DISCOVERY_VAULT.md.

import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Link from "@/components/Link";
import PageShell from "@/components/ui/PageShell";
import PageHero, { type PageHeroStat } from "@/components/ui/PageHero";
import PageSection from "@/components/ui/PageSection";
import NeonButton from "@/components/ui/NeonButton";
import NeonChip from "@/components/ui/NeonChip";
import FactCategoryChip from "@/components/facts/FactCategoryChip";
import FactContentRenderer from "@/components/facts/FactContentRenderer";
import FactCard from "@/components/facts/FactCard";
import MarkFactDiscovered from "@/components/facts/MarkFactDiscovered";
import DiscoveryProgress from "@/components/facts/DiscoveryProgress";
import DiscoveryBadges from "@/components/facts/DiscoveryBadges";
import { getFactBySlug, getRelatedFacts } from "@/server/facts/queries";
import { FACT_DIFFICULTY_LABELS, formatFactEra } from "@/lib/factFormat";
import { nexusColors } from "@/theme/visualTokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

// Deduplicates the query between generateMetadata and the page render.
const getFact = cache(async (slug: string) => getFactBySlug(slug));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const fact = await getFact(decodeURIComponent(slug));
  if (fact === null) {
    return { title: "Discovery not found", robots: { index: false } };
  }
  return {
    title: fact.title,
    description: fact.summary,
  };
}

export default async function FactDetailPage({ params }: Props) {
  const { slug } = await params;
  if (slug.trim() === "") notFound();

  const fact = await getFact(decodeURIComponent(slug));
  if (fact === null) notFound();

  const relatedFacts = await getRelatedFacts(fact.id, 3);
  const era = formatFactEra(fact.eraStartYear, fact.eraEndYear);
  const relationChips = fact.relations.filter(
    (relation) => relation.entityLabel !== null,
  );

  const stats: (PageHeroStat | null)[] = [
    era !== null ? { label: "Era", value: era, accent: "cyan" } : null,
    { label: "Read time", value: `${fact.readTimeMinutes} min`, accent: "gold" },
    {
      label: "Difficulty",
      value: FACT_DIFFICULTY_LABELS[fact.difficulty],
      accent: "gold",
    },
  ];
  const heroStats = stats.filter(
    (stat): stat is PageHeroStat => stat !== null,
  );

  return (
    <Box>
      <MarkFactDiscovered
        slug={fact.slug}
        category={fact.category}
        tags={fact.tags}
      />

      <PageHero
        eyebrow="Discovery Vault"
        title={fact.title}
        subtitle={fact.summary}
        accent="cyan"
        stats={heroStats}
        action={
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
            <NeonButton
              neon="cyan"
              component={Link}
              href={`/facts/random?exclude=${fact.slug}`}
            >
              Surprise Me
            </NeonButton>
            <NeonButton neon="outline" component={Link} href="/facts">
              Back to All Facts
            </NeonButton>
          </Box>
        }
      />

      <PageShell framed>
        <PageSection>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mb: 3 }}>
            <FactCategoryChip category={fact.category} />
            {relationChips.map((relation, index) => (
              <NeonChip
                key={`${relation.entityType}-${relation.entitySlug ?? index}`}
                label={relation.entityLabel}
                accent="cyan"
              />
            ))}
          </Box>
          <FactContentRenderer blocks={fact.contentBlocks} />
        </PageSection>

        {fact.sources.length > 0 ? (
          <PageSection dividerTop>
            <Typography
              variant="h5"
              component="h2"
              sx={{ color: nexusColors.textPrimary, mb: 2.5 }}
            >
              Sources
            </Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {fact.sources.map((source) => (
                <Box key={source.id}>
                  {source.url !== null ? (
                    <Typography
                      component={Link}
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      sx={{
                        color: nexusColors.cyanStrong,
                        fontWeight: 600,
                        "&:hover": { color: nexusColors.cyanStrong },
                      }}
                    >
                      {source.label} ↗
                    </Typography>
                  ) : (
                    <Typography
                      component="p"
                      sx={{ color: nexusColors.textPrimary, fontWeight: 600 }}
                    >
                      {source.label}
                    </Typography>
                  )}
                  {source.notes !== null ? (
                    <Typography
                      variant="body2"
                      sx={{ color: nexusColors.textSecondary, mt: 0.25 }}
                    >
                      {source.notes}
                    </Typography>
                  ) : null}
                </Box>
              ))}
            </Box>
          </PageSection>
        ) : null}

        {relatedFacts.length > 0 ? (
          <PageSection dividerTop>
            <Typography
              variant="h5"
              component="h2"
              sx={{ color: nexusColors.textPrimary, mb: 2.5 }}
            >
              Related Discoveries
            </Typography>
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
              {relatedFacts.map((related) => (
                <FactCard key={related.id} fact={related} />
              ))}
            </Box>
          </PageSection>
        ) : null}

        <PageSection dividerTop>
          <Typography
            variant="h5"
            component="h2"
            sx={{ color: nexusColors.textPrimary, mb: 2.5 }}
          >
            Your Progress
          </Typography>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <DiscoveryProgress />
            <DiscoveryBadges />
          </Box>
        </PageSection>
      </PageShell>
    </Box>
  );
}
