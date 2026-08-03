// Records & Firsts (neon pass). Database-backed leaderboard highlights as
// glowing badge-cards — one marquee card per record category, alternating gold
// and cyan, each showing the current leader and an honest description. Links to
// the full /records surface.

import Box from "@mui/material/Box";
import HomeSection from "./HomeSection";
import SectionHeader from "@/components/ui/SectionHeader";
import EmptyState from "@/components/ui/EmptyState";
import RecordHighlightCard from "./RecordHighlightCard";
import { formatNumber } from "@/lib/format";
import type { RecordLeaderboardDto } from "@/server/queries/types";

const GRID = {
  display: "grid",
  gap: { xs: 2.5, md: 3 },
  gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "repeat(3, 1fr)" },
};

export default function RecordsFirstsSection({
  records,
}: {
  records: RecordLeaderboardDto[];
}) {
  const cards = records
    .map((board) => {
      const top = board.items[0];
      if (top === undefined) return null;
      return {
        key: board.key,
        title: board.title,
        value: `${top.label} — ${top.detail ?? formatNumber(top.value)}`,
        description: board.description,
        href: top.href ?? "/records",
      };
    })
    .filter((card): card is NonNullable<typeof card> => card !== null);

  return (
    <HomeSection divider>
      <SectionHeader
        eyebrow="Still standing"
        title="Records & Firsts"
        accent="gold"
        subtitle="Database-backed leaderboards computed from imported historical events (1930–2022); 2026 tournament stats live in the 2026 archive hub."
        action={{ label: "All records", href: "/records" }}
      />
      {cards.length > 0 ? (
        <Box sx={GRID}>
          {cards.map((card, index) => (
            <RecordHighlightCard
              key={card.key}
              title={card.title}
              value={card.value}
              description={card.description}
              href={card.href}
              accent={index % 2 === 0 ? "gold" : "cyan"}
            />
          ))}
        </Box>
      ) : (
        <EmptyState
          title="Records coming soon"
          description="Leaderboards appear once event data is imported."
        />
      )}
    </HomeSection>
  );
}
