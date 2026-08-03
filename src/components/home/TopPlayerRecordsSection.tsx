// Top Player Records (neon pass). The archive's all-time leading scorers as
// collectible portrait cards — a single clean row of five on desktop, stepping
// down to 3 / 2 / 1 columns on smaller screens. Honest label + scope note:
// database-computed goal data across all imported tournaments, not an editorial
// legends list.

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import HomeSection from "./HomeSection";
import SectionHeader from "@/components/ui/SectionHeader";
import EmptyState from "@/components/ui/EmptyState";
import PlayerRecordCard from "./PlayerRecordCard";
import { atlasColors } from "@/theme/visualTokens";
import type { HomePlayerRecord } from "@/server/home/queries";

// Exactly five cards on desktop (one row); cramped 6-up avoided.
const MAX_VISIBLE = 5;

const LAYOUT = {
  display: "grid",
  gridTemplateColumns: {
    xs: "1fr",
    sm: "repeat(2, minmax(0, 1fr))",
    md: "repeat(3, minmax(0, 1fr))",
    lg: "repeat(5, minmax(0, 1fr))",
  },
  gap: { xs: 2, sm: 2.5, md: 3 },
} as const;

export default function TopPlayerRecordsSection({
  players,
}: {
  players: HomePlayerRecord[];
}) {
  // Defensive cap so the homepage never shows more than five, regardless of how
  // many records the query returns. The full list lives behind "All players".
  const visiblePlayers = players.slice(0, MAX_VISIBLE);

  return (
    <HomeSection divider>
      <SectionHeader
        eyebrow="The pantheon"
        title="Top Player Records"
        accent="gold"
        subtitle="Leading scorers of the historical archive (1930–2022), computed from imported goal data. 2026 scoring leaders live in the 2026 archive hub."
        action={{ label: "All players", href: "/players" }}
      />
      {visiblePlayers.length > 0 ? (
        <>
          <Box sx={LAYOUT}>
            {visiblePlayers.map((player, index) => (
              <PlayerRecordCard
                key={player.id}
                player={player}
                accent={index % 2 === 0 ? "gold" : "cyan"}
              />
            ))}
          </Box>
          <Typography
            variant="caption"
            sx={{ color: atlasColors.textMuted, display: "block", mt: 3 }}
          >
            Goals counted across all imported tournaments (men&apos;s and
            women&apos;s). Squad selections are not match appearances.
          </Typography>
        </>
      ) : (
        <EmptyState
          title="Players coming soon"
          description="Player records will appear once archive data is available."
        />
      )}
    </HomeSection>
  );
}
