// Shared fact listing card — used by the /facts archive grid and the
// "Related Discoveries" section on a fact's detail page. Server-safe.

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Link from "@/components/Link";
import GlowCard from "@/components/ui/GlowCard";
import NeonChip from "@/components/ui/NeonChip";
import FactCategoryChip, { FactDifficultyChip } from "./FactCategoryChip";
import { formatFactEra } from "@/lib/factFormat";
import { nexusColors } from "@/theme/visualTokens";
import type { FactSummary } from "@/server/facts/types";

const MAX_RELATION_CHIPS = 3;

export default function FactCard({ fact }: { fact: FactSummary }) {
  const era = formatFactEra(fact.eraStartYear, fact.eraEndYear);
  const relationChips = fact.relations
    .filter((relation) => relation.entityLabel !== null)
    .slice(0, MAX_RELATION_CHIPS);
  const meta = [era, `${fact.readTimeMinutes} min read`]
    .filter((part): part is string => part !== null)
    .join(" · ");

  return (
    <GlowCard
      variant="default"
      clickable
      component={Link}
      href={`/facts/${fact.slug}`}
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 1.5,
        height: "100%",
        p: 3,
      }}
    >
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
        <FactCategoryChip category={fact.category} />
        <FactDifficultyChip difficulty={fact.difficulty} />
      </Box>
      <Typography
        variant="h6"
        component="h3"
        sx={{ color: nexusColors.textPrimary }}
      >
        {fact.title}
      </Typography>
      <Typography
        variant="body2"
        sx={{ color: nexusColors.textSecondary, flexGrow: 1 }}
      >
        {fact.summary}
      </Typography>
      {relationChips.length > 0 ? (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
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
          justifyContent: "space-between",
          alignItems: "center",
          mt: "auto",
          pt: 1,
        }}
      >
        <Typography variant="caption" sx={{ color: nexusColors.textMuted }}>
          {meta}
        </Typography>
        <Typography
          variant="caption"
          sx={{
            color: nexusColors.cyanStrong,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          Know More →
        </Typography>
      </Box>
    </GlowCard>
  );
}
