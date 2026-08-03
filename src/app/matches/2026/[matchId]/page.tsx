// 2026 match report — imported Mominul archive detail page.
//
// Static "2026" segment takes precedence over the historical
// /matches/[idOrSlug] route, so the two archives never collide. Everything on
// this page comes from the WorldCup2026* tables (sourceId
// "mominul_2026_dataset"): score, xG, team stats, events timeline, lineups.
// Server component, read-only, MUI only.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Link from "@/components/Link";
import PageContainer from "@/components/layout/PageContainer";
import SectionHeading from "@/components/ui/SectionHeading";
import VaultButton from "@/components/vault/VaultButton";
import CountryFlag from "@/components/media/CountryFlag";
import { wc2026ScoreLine } from "@/components/worldcup2026/Wc2026MatchRows";
import { atlas, eyebrowSx, tabularNums } from "@/theme/tokens";
import {
  getWc2026MatchDetail,
  MOMINUL_ATTRIBUTION,
  type Wc2026LineupEntryDto,
  type Wc2026MatchDetail,
} from "@/server/worldcup2026/queries";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ matchId: string }> };

function parseMatchId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id >= 1 && id <= 10000 ? id : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { matchId } = await params;
  const id = parseMatchId(matchId);
  const match = id === null ? null : await getWc2026MatchDetail(id);
  if (match === null) {
    return { title: "Match not found", robots: { index: false } };
  }
  return {
    title: `${match.homeTeamName} ${match.homeScore}–${match.awayScore} ${match.awayTeamName} — 2026 World Cup`,
    description: `2026 World Cup ${match.stageName ?? "match"}: full result, events, lineups, and team stats from the archive dataset.`,
  };
}

const SECTION_SX = { py: { xs: 4, md: 5 } } as const;

function FactCell({ label, value }: { label: string; value: string | null }) {
  if (value === null || value === "") return null;
  return (
    <Box sx={{ border: `1px solid ${atlas.border}`, bgcolor: atlas.surfaceSoft, px: 2, py: 1.5 }}>
      <Typography component="p" sx={{ ...eyebrowSx, fontSize: "0.58rem", color: atlas.textMuted, mb: 0.5 }}>
        {label}
      </Typography>
      <Typography component="p" sx={{ color: atlas.bodyStrong, fontSize: "0.9rem" }}>
        {value}
      </Typography>
    </Box>
  );
}

function XgBar({ match }: { match: Wc2026MatchDetail }) {
  if (match.homeXg === null || match.awayXg === null) return null;
  const total = match.homeXg + match.awayXg;
  const homeShare = total > 0 ? (match.homeXg / total) * 100 : 50;
  return (
    <Box sx={{ mt: 3 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.75 }}>
        <Typography component="span" sx={{ ...tabularNums, fontSize: "0.8rem", color: atlas.textPrimary, fontWeight: 700 }}>
          {match.homeXg.toFixed(2)}
        </Typography>
        <Typography component="span" sx={{ ...eyebrowSx, fontSize: "0.58rem", color: atlas.textMuted }}>
          Expected goals (xG)
        </Typography>
        <Typography component="span" sx={{ ...tabularNums, fontSize: "0.8rem", color: atlas.textPrimary, fontWeight: 700 }}>
          {match.awayXg.toFixed(2)}
        </Typography>
      </Box>
      <Box sx={{ display: "flex", height: 6, overflow: "hidden", borderRadius: "3px" }}>
        <Box sx={{ width: `${homeShare}%`, bgcolor: "#00D9FF" }} />
        <Box sx={{ flexGrow: 1, bgcolor: atlas.gold }} />
      </Box>
    </Box>
  );
}

const TEAM_STAT_ROWS: { key: keyof Wc2026MatchDetail["teamStats"][number]; label: string; suffix?: string }[] = [
  { key: "possessionPct", label: "Possession", suffix: "%" },
  { key: "totalShots", label: "Shots" },
  { key: "shotsOnTarget", label: "On target" },
  { key: "corners", label: "Corners" },
  { key: "fouls", label: "Fouls" },
  { key: "offsides", label: "Offsides" },
  { key: "saves", label: "Saves" },
];

function eventGlyph(eventType: string): string {
  const lower = eventType.toLowerCase();
  if (lower.includes("own goal")) return "⚽ (OG)";
  if (lower.includes("penalty goal")) return "⚽ (pen)";
  if (lower.includes("goal")) return "⚽";
  if (lower.includes("second yellow")) return "🟨🟥";
  if (lower.includes("yellow")) return "🟨";
  if (lower.includes("red")) return "🟥";
  if (lower.includes("sub")) return "⇄";
  return "•";
}

function LineupColumn({
  title,
  entries,
}: {
  title: string;
  entries: Wc2026LineupEntryDto[];
}) {
  const starters = entries.filter((entry) => entry.isStarting === true);
  const bench = entries.filter((entry) => entry.isStarting !== true);
  const renderRow = (entry: Wc2026LineupEntryDto) => (
    <Box key={entry.id} sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.55 }}>
      <Typography component="span" sx={{ ...eyebrowSx, fontSize: "0.55rem", color: atlas.textMuted, width: 34, flexShrink: 0 }}>
        {entry.tacticalPosition ?? "—"}
      </Typography>
      {entry.playerSourceId !== null ? (
        <Typography
          component={Link}
          href={`/tournaments/2026/players/${entry.playerSourceId}`}
          sx={{ color: atlas.bodyStrong, fontSize: "0.85rem", textDecoration: "none", "&:hover": { color: atlas.goldStrong } }}
        >
          {entry.playerName ?? "Unknown"}
        </Typography>
      ) : (
        <Typography component="span" sx={{ color: atlas.bodyStrong, fontSize: "0.85rem" }}>
          {entry.playerName ?? "Unknown"}
        </Typography>
      )}
      {entry.minutesPlayed !== null ? (
        <Typography component="span" sx={{ ...tabularNums, fontSize: "0.7rem", color: atlas.textMuted, ml: "auto" }}>
          {entry.minutesPlayed}′
        </Typography>
      ) : null}
    </Box>
  );
  return (
    <Box sx={{ border: `1px solid ${atlas.border}`, bgcolor: atlas.surfaceSoft, p: 2.5 }}>
      <Typography component="p" sx={{ ...eyebrowSx, fontSize: "0.66rem", color: atlas.gold, mb: 1.5 }}>
        {title}
      </Typography>
      {starters.length > 0 ? (
        <>
          <Typography component="p" sx={{ ...eyebrowSx, fontSize: "0.55rem", color: atlas.textMuted, mb: 0.75 }}>
            Starting XI
          </Typography>
          {starters.map(renderRow)}
        </>
      ) : null}
      {bench.length > 0 ? (
        <>
          <Typography component="p" sx={{ ...eyebrowSx, fontSize: "0.55rem", color: atlas.textMuted, mt: 1.5, mb: 0.75 }}>
            Substitutes
          </Typography>
          {bench.map(renderRow)}
        </>
      ) : null}
    </Box>
  );
}

export default async function Wc2026MatchDetailPage({ params }: Props) {
  const { matchId } = await params;
  const id = parseMatchId(matchId);
  if (id === null) notFound();
  const match = await getWc2026MatchDetail(id);
  if (match === null) notFound();

  const homeLineups = match.lineups.filter((entry) => entry.teamCode === match.homeTeamCode);
  const awayLineups = match.lineups.filter((entry) => entry.teamCode === match.awayTeamCode);
  const homeStats = match.teamStats.find((stat) => stat.teamCode === match.homeTeamCode) ?? null;
  const awayStats = match.teamStats.find((stat) => stat.teamCode === match.awayTeamCode) ?? null;
  const resultTag =
    match.resultType === "AET"
      ? "After extra time"
      : match.resultType === "Penalties"
        ? "Decided on penalties"
        : "Full-time";

  return (
    <Box>
      {/* Score hero */}
      <Box sx={{ borderBottom: `1px solid ${atlas.border}`, bgcolor: atlas.black }}>
        <PageContainer sx={{ py: { xs: 6, md: 8 } }}>
          <Typography
            component={Link}
            href="/tournaments/2026"
            sx={{ ...eyebrowSx, fontSize: "0.62rem", color: atlas.textMuted, textDecoration: "none", "&:hover": { color: atlas.goldStrong } }}
          >
            ← 2026 World Cup archive
          </Typography>
          <Typography component="p" sx={{ ...eyebrowSx, fontSize: "0.66rem", color: atlas.gold, mt: 3 }}>
            {match.stageName ?? "Match"}
            {match.groupLetter !== null ? ` · Group ${match.groupLetter}` : ""}
            {match.date !== null ? ` · ${match.date}` : ""}
            {match.kickoffTimeUtc !== null ? ` · ${match.kickoffTimeUtc} UTC` : ""}
          </Typography>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "1fr auto 1fr" },
              alignItems: "center",
              gap: { xs: 2, md: 4 },
              mt: 2.5,
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 2, justifyContent: { md: "flex-end" } }}>
              <CountryFlag code={match.homeTeamCode} name={match.homeTeamName} size="lg" />
              <Typography variant="h2" sx={{ fontSize: { xs: "1.6rem", md: "2.2rem" } }}>
                {match.homeTeamName}
              </Typography>
            </Box>
            <Typography
              sx={{ ...tabularNums, fontFamily: atlas.fontDisplay, fontWeight: 900, fontSize: { xs: "2.6rem", md: "3.4rem" }, color: atlas.textPrimary, textAlign: "center", whiteSpace: "nowrap" }}
            >
              {wc2026ScoreLine(match)}
            </Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
              <Typography variant="h2" sx={{ fontSize: { xs: "1.6rem", md: "2.2rem" } }}>
                {match.awayTeamName}
              </Typography>
              <CountryFlag code={match.awayTeamCode} name={match.awayTeamName} size="lg" />
            </Box>
          </Box>
          <Typography component="p" sx={{ ...eyebrowSx, fontSize: "0.62rem", color: atlas.textSecondary, textAlign: "center", mt: 2 }}>
            {resultTag}
            {match.venueName !== null ? ` · ${match.venueName}` : ""}
            {match.cityName !== null ? ` · ${match.cityName}` : ""}
          </Typography>
          <XgBar match={match} />
        </PageContainer>
      </Box>

      {/* Match information */}
      <PageContainer component="section" sx={SECTION_SX}>
        <SectionHeading eyebrow="Match information" title="Details" />
        <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "repeat(2, minmax(0,1fr))", md: "repeat(4, minmax(0,1fr))" } }}>
          <FactCell label="Referee" value={match.refereeName} />
          <FactCell label="Player of the match" value={match.playerOfTheMatch} />
          <FactCell label="Home goalkeeper" value={match.goalkeeperHome} />
          <FactCell label="Away goalkeeper" value={match.goalkeeperAway} />
        </Box>
      </PageContainer>

      {/* Team stats */}
      {homeStats !== null || awayStats !== null ? (
        <PageContainer component="section" sx={SECTION_SX}>
          <SectionHeading eyebrow="From the archive dataset" title="Team stats" />
          <Box sx={{ border: `1px solid ${atlas.border}`, bgcolor: atlas.surfaceSoft, p: 2.5 }}>
            {TEAM_STAT_ROWS.map((row) => {
              const home = homeStats?.[row.key];
              const away = awayStats?.[row.key];
              if (home == null && away == null) return null;
              return (
                <Box key={row.label} sx={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 2, py: 0.9, borderTop: `1px solid ${atlas.border}`, "&:first-of-type": { borderTop: "none" } }}>
                  <Typography component="span" sx={{ ...tabularNums, textAlign: "right", color: atlas.textPrimary, fontWeight: 700 }}>
                    {home ?? "—"}
                    {row.suffix ?? ""}
                  </Typography>
                  <Typography component="span" sx={{ ...eyebrowSx, fontSize: "0.58rem", color: atlas.textMuted, textAlign: "center", minWidth: 110 }}>
                    {row.label}
                  </Typography>
                  <Typography component="span" sx={{ ...tabularNums, color: atlas.textPrimary, fontWeight: 700 }}>
                    {away ?? "—"}
                    {row.suffix ?? ""}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        </PageContainer>
      ) : null}

      {/* Events timeline */}
      <PageContainer component="section" sx={SECTION_SX}>
        <SectionHeading eyebrow="As it happened" title="Events" />
        {match.events.length === 0 ? (
          <Typography variant="body2" sx={{ color: atlas.textMuted }}>
            No timeline events recorded for this match in the archive dataset.
          </Typography>
        ) : (
          <Box sx={{ border: `1px solid ${atlas.border}` }}>
            {match.events.map((event, index) => (
              <Box key={event.id} sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 2, py: 1.1, borderTop: index > 0 ? `1px solid ${atlas.border}` : "none" }}>
                <Typography component="span" sx={{ ...tabularNums, fontSize: "0.8rem", color: atlas.textSecondary, width: 48, flexShrink: 0 }}>
                  {event.minute !== null
                    ? `${event.minute}${event.stoppageMinute !== null ? `+${event.stoppageMinute}` : ""}′`
                    : "—"}
                </Typography>
                <Typography component="span" sx={{ fontSize: "0.9rem", width: 56, flexShrink: 0 }}>
                  {eventGlyph(event.eventType)}
                </Typography>
                <CountryFlag code={event.teamCode} name={event.teamName} size="xs" />
                <Box sx={{ minWidth: 0 }}>
                  {event.playerSourceId !== null ? (
                    <Typography
                      component={Link}
                      href={`/tournaments/2026/players/${event.playerSourceId}`}
                      sx={{ color: atlas.bodyStrong, fontSize: "0.9rem", textDecoration: "none", "&:hover": { color: atlas.goldStrong } }}
                    >
                      {event.playerName ?? "Unknown player"}
                    </Typography>
                  ) : (
                    <Typography component="span" sx={{ color: atlas.bodyStrong, fontSize: "0.9rem" }}>
                      {event.playerName ?? "—"}
                    </Typography>
                  )}
                  <Typography component="span" sx={{ fontSize: "0.75rem", color: atlas.textMuted, ml: 1 }}>
                    {event.eventType}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </PageContainer>

      {/* Lineups */}
      {match.lineups.length > 0 ? (
        <PageContainer component="section" sx={SECTION_SX}>
          <SectionHeading eyebrow="Squads on the night" title="Lineups" />
          <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" } }}>
            <LineupColumn title={match.homeTeamName ?? "Home"} entries={homeLineups} />
            <LineupColumn title={match.awayTeamName ?? "Away"} entries={awayLineups} />
          </Box>
        </PageContainer>
      ) : null}

      {/* Attribution + related */}
      <PageContainer component="section" sx={{ ...SECTION_SX, pb: { xs: 7, md: 9 } }}>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, alignItems: "center", justifyContent: "space-between" }}>
          <Typography component="p" sx={{ fontSize: "0.75rem", color: atlas.textMuted }}>
            Data source: {MOMINUL_ATTRIBUTION}
          </Typography>
          <Box sx={{ display: "flex", gap: 1.5 }}>
            <VaultButton component={Link} href="/schedule/2026" variant="outline">
              2026 schedule
            </VaultButton>
            <VaultButton component={Link} href="/tournaments/2026" variant="outline">
              2026 hub
            </VaultButton>
          </Box>
        </Box>
      </PageContainer>
    </Box>
  );
}
