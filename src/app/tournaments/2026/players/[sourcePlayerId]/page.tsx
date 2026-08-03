// 2026 player profile — imported Mominul archive.
//
// 2026 players are deliberately NOT merged into the historical Player model
// (identity mapping is not reliable enough to automate), so they live under
// /tournaments/2026/players/<sourcePlayerId>. Read-only, MUI only.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Link from "@/components/Link";
import PageContainer from "@/components/layout/PageContainer";
import SectionHeading from "@/components/ui/SectionHeading";
import VaultButton from "@/components/vault/VaultButton";
import CountryFlag from "@/components/media/CountryFlag";
import { atlas, eyebrowSx, tabularNums } from "@/theme/tokens";
import {
  getWc2026PlayerDetail,
  MOMINUL_ATTRIBUTION,
} from "@/server/worldcup2026/queries";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ sourcePlayerId: string }> };

function parsePlayerId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id >= 1 && id <= 100000 ? id : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { sourcePlayerId } = await params;
  const id = parsePlayerId(sourcePlayerId);
  const player = id === null ? null : await getWc2026PlayerDetail(id);
  if (player === null) {
    return { title: "Player not found", robots: { index: false } };
  }
  return {
    title: `${player.name} — 2026 World Cup`,
    description: `${player.name} (${player.teamName ?? "2026 World Cup"}): tournament stats and match events from the 2026 archive dataset.`,
  };
}

function StatCell({ label, value }: { label: string; value: string | null }) {
  if (value === null) return null;
  return (
    <Box sx={{ border: `1px solid ${atlas.border}`, bgcolor: atlas.surfaceSoft, px: 2, py: 1.5 }}>
      <Typography component="p" sx={{ ...tabularNums, fontFamily: atlas.fontDisplay, fontWeight: 900, fontSize: "1.3rem", color: atlas.textPrimary }}>
        {value}
      </Typography>
      <Typography component="p" sx={{ ...eyebrowSx, fontSize: "0.58rem", color: atlas.textMuted, mt: 0.5 }}>
        {label}
      </Typography>
    </Box>
  );
}

export default async function Wc2026PlayerPage({ params }: Props) {
  const { sourcePlayerId } = await params;
  const id = parsePlayerId(sourcePlayerId);
  if (id === null) notFound();
  const player = await getWc2026PlayerDetail(id);
  if (player === null) notFound();

  const stats = player.stats;
  const factLine = [
    player.position,
    player.club !== null ? `Club: ${player.club}` : null,
    player.dateOfBirth !== null ? `Born ${player.dateOfBirth}` : null,
    player.heightCm !== null ? `${player.heightCm} cm` : null,
    player.caps !== null ? `${player.caps} caps` : null,
    player.marketValueEur !== null
      ? `Market value €${(player.marketValueEur / 1_000_000).toFixed(1)}m`
      : null,
  ]
    .filter((value): value is string => value !== null)
    .join(" · ");

  return (
    <Box>
      <Box sx={{ borderBottom: `1px solid ${atlas.border}`, bgcolor: atlas.black }}>
        <PageContainer sx={{ py: { xs: 6, md: 8 } }}>
          <Typography
            component={Link}
            href="/tournaments/2026#players"
            sx={{ ...eyebrowSx, fontSize: "0.62rem", color: atlas.textMuted, textDecoration: "none", "&:hover": { color: atlas.goldStrong } }}
          >
            ← 2026 players
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 2, mt: 3 }}>
            <CountryFlag code={player.teamCode} name={player.teamName} size="lg" />
            <Box>
              <Typography variant="h1" sx={{ fontSize: { xs: "2.4rem", md: "3.4rem" } }}>
                {player.name}
              </Typography>
              <Typography component="p" sx={{ ...eyebrowSx, fontSize: "0.66rem", color: atlas.gold, mt: 1 }}>
                {player.teamName ?? "2026 World Cup"} · 2026 World Cup squad
              </Typography>
            </Box>
          </Box>
          {factLine !== "" ? (
            <Typography variant="body2" sx={{ color: atlas.textSecondary, mt: 2.5 }}>
              {factLine}
            </Typography>
          ) : null}
        </PageContainer>
      </Box>

      <PageContainer component="section" sx={{ py: { xs: 4, md: 5 } }}>
        <SectionHeading eyebrow="Tournament totals" title="2026 stats" />
        {stats === null ? (
          <Typography variant="body2" sx={{ color: atlas.textMuted }}>
            No per-tournament statistics recorded for this player in the
            archive dataset.
          </Typography>
        ) : (
          <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "repeat(2, minmax(0,1fr))", sm: "repeat(3, minmax(0,1fr))", lg: "repeat(5, minmax(0,1fr))" } }}>
            <StatCell label="Matches" value={stats.matchesPlayed !== null ? String(stats.matchesPlayed) : null} />
            <StatCell label="Starts" value={stats.matchesStarted !== null ? String(stats.matchesStarted) : null} />
            <StatCell label="Minutes" value={stats.minutesPlayed !== null ? String(stats.minutesPlayed) : null} />
            <StatCell label="Goals" value={stats.goals !== null ? String(stats.goals) : null} />
            <StatCell label="Assists" value={stats.assists !== null ? String(stats.assists) : null} />
            <StatCell label="Yellow cards" value={stats.yellowCards !== null ? String(stats.yellowCards) : null} />
            <StatCell label="Red cards" value={stats.redCards !== null ? String(stats.redCards) : null} />
            <StatCell label="Saves" value={stats.saves !== null && stats.saves > 0 ? String(stats.saves) : null} />
            <StatCell label="Clean sheets" value={stats.cleanSheets !== null && stats.cleanSheets > 0 ? String(stats.cleanSheets) : null} />
            <StatCell label="Avg rating" value={stats.averageRating !== null ? stats.averageRating.toFixed(2) : null} />
          </Box>
        )}
      </PageContainer>

      <PageContainer component="section" sx={{ py: { xs: 4, md: 5 }, pb: { xs: 7, md: 9 } }}>
        <SectionHeading eyebrow="Recorded moments" title="Match events" />
        {player.matchEvents.length === 0 ? (
          <Typography variant="body2" sx={{ color: atlas.textMuted }}>
            No individual match events recorded for this player.
          </Typography>
        ) : (
          <Box sx={{ border: `1px solid ${atlas.border}` }}>
            {player.matchEvents.map((event, index) => (
              <Box
                key={`${event.matchSourceId}-${index}`}
                component={Link}
                href={`/matches/2026/${event.matchSourceId}`}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1.5,
                  px: 2,
                  py: 1.1,
                  textDecoration: "none",
                  borderTop: index > 0 ? `1px solid ${atlas.border}` : "none",
                  "&:hover": { backgroundColor: "rgba(0,217,255,0.05)" },
                }}
              >
                <Typography component="span" sx={{ ...tabularNums, fontSize: "0.8rem", color: atlas.textSecondary, width: 44, flexShrink: 0 }}>
                  {event.minute !== null ? `${event.minute}′` : "—"}
                </Typography>
                <Typography component="span" sx={{ fontSize: "0.85rem", color: atlas.bodyStrong, minWidth: 110 }}>
                  {event.eventType}
                </Typography>
                <Typography component="span" sx={{ fontSize: "0.8rem", color: atlas.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {event.matchLabel}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, alignItems: "center", justifyContent: "space-between", mt: 4 }}>
          <Typography component="p" sx={{ fontSize: "0.75rem", color: atlas.textMuted }}>
            Data source: {MOMINUL_ATTRIBUTION}
          </Typography>
          <VaultButton component={Link} href="/tournaments/2026" variant="outline">
            2026 hub
          </VaultButton>
        </Box>
      </PageContainer>
    </Box>
  );
}
