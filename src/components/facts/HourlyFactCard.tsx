// The homepage's "Fact of the Hour" card. Server-safe; the only client
// islands are FactCountdown (ticks once a minute) and DiscoveryProgress
// (reads localStorage) — everything else is static per request.

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Link from "@/components/Link";
import GlowCard from "@/components/ui/GlowCard";
import NeonButton from "@/components/ui/NeonButton";
import NeonChip from "@/components/ui/NeonChip";
import FactCategoryChip, { FactDifficultyChip } from "./FactCategoryChip";
import FactCountdown from "./FactCountdown";
import DiscoveryProgress from "./DiscoveryProgress";
import DiscoveryBadges from "./DiscoveryBadges";
import { formatFactEra } from "@/lib/factFormat";
import { atlasColors } from "@/theme/visualTokens";
import type { FactSummary } from "@/server/facts/types";

const MAX_RELATION_CHIPS = 4;

export default function HourlyFactCard({
  fact,
  nextRotationAt,
}: {
  fact: FactSummary;
  nextRotationAt: string;
}) {
  const era = formatFactEra(fact.eraStartYear, fact.eraEndYear);
  const relationChips = fact.relations
    .filter((relation) => relation.entityLabel !== null)
    .slice(0, MAX_RELATION_CHIPS);

  return (
    <GlowCard
      variant="cyan"
      sx={{ px: { xs: 2.5, md: 4 }, py: { xs: 3, md: 4 } }}
    >
      <Box
        sx={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 1,
          mb: 2,
        }}
      >
        <NeonChip label="Fact of the Hour" accent="gold" dot />
        <FactCategoryChip category={fact.category} />
        <FactDifficultyChip difficulty={fact.difficulty} />
        {era ? (
          <Typography
            variant="caption"
            sx={{ color: atlasColors.textMuted, ml: { sm: "auto" } }}
          >
            {era}
          </Typography>
        ) : null}
      </Box>

      <Typography
        variant="h4"
        component="h3"
        sx={{ color: atlasColors.textPrimary, mb: 1.5 }}
      >
        {fact.title}
      </Typography>
      <Typography
        variant="body1"
        sx={{ color: atlasColors.textSecondary, maxWidth: 720, mb: 2.5 }}
      >
        {fact.summary}
      </Typography>

      {relationChips.length > 0 ? (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mb: 3 }}>
          {relationChips.map((relation, index) => (
            <NeonChip
              key={`${relation.entityType}-${relation.entitySlug ?? index}`}
              label={relation.entityLabel}
              accent="cyan"
            />
          ))}
        </Box>
      ) : null}

      <Box
        sx={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 2,
        }}
      >
        <NeonButton neon="cyan" component={Link} href={`/facts/${fact.slug}`}>
          Know More
        </NeonButton>
        <NeonButton neon="outline" component={Link} href="/facts/random">
          Surprise Me
        </NeonButton>
        <FactCountdown nextRotationAt={nextRotationAt} />
      </Box>

      <Box sx={{ mt: 3, display: "flex", flexDirection: "column", gap: 1.5 }}>
        <DiscoveryProgress />
        <DiscoveryBadges />
      </Box>
    </GlowCard>
  );
}
