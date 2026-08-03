// 2026 World Cup archive hub — /tournaments/2026.
//
// Rendered entirely from the imported Mominul archive tables (sourceId
// "mominul_2026_dataset"): hero, stat band, anchor tabs, and the Overview /
// Matches / Groups / Bracket / Teams / Venues / Players / Stats sections.
// Server component; no provider fetches, no sync, MUI only. Awards are
// omitted — the selected dataset does not include awards.

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Link from "@/components/Link";
import PageContainer from "@/components/layout/PageContainer";
import SectionHeading from "@/components/ui/SectionHeading";
import EmptyState from "@/components/ui/EmptyState";
import VaultEyebrow from "@/components/vault/VaultEyebrow";
import VaultButton from "@/components/vault/VaultButton";
import CountryFlag from "@/components/media/CountryFlag";
import Wc2026MatchRows, { wc2026ScoreLine } from "./Wc2026MatchRows";
import { atlas, eyebrowSx, tabularNums } from "@/theme/tokens";
import { getStringParam, type RawSearchParams } from "@/lib/search-params";
import {
  computeGroupStandings,
  getWc2026Matches,
  getWc2026Players,
  getWc2026Stats,
  getWc2026Teams,
  getWc2026Venues,
  MOMINUL_ATTRIBUTION,
  type Wc2026Group,
  type Wc2026Overview,
  type Wc2026StatLeader,
} from "@/server/worldcup2026/queries";

const SECTION_SX = { py: { xs: 4, md: 5 }, scrollMarginTop: 96 } as const;

const KNOCKOUT_ORDER = [
  "Round of 32",
  "Round of 16",
  "Quarter-finals",
  "Semi-finals",
  "Third-place match",
  "Final",
];

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "matches", label: "Matches" },
  { id: "groups", label: "Groups" },
  { id: "bracket", label: "Bracket" },
  { id: "teams", label: "Teams" },
  { id: "venues", label: "Venues" },
  { id: "players", label: "Players" },
  { id: "stats", label: "Stats" },
];

// --- small building blocks -------------------------------------------------

function StatCell({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <Box sx={{ border: `1px solid ${accent ? atlas.goldBorder : atlas.border}`, bgcolor: atlas.surfaceSoft, px: 2.5, py: 2 }}>
      <Typography
        component="p"
        sx={{ ...tabularNums, fontFamily: atlas.fontDisplay, fontWeight: 900, fontSize: "1.6rem", color: accent ? atlas.gold : atlas.textPrimary, lineHeight: 1.1 }}
      >
        {value}
      </Typography>
      <Typography component="p" sx={{ ...eyebrowSx, fontSize: "0.62rem", color: atlas.textMuted, mt: 0.75 }}>
        {label}
      </Typography>
    </Box>
  );
}

function PodiumLine({ label, name, code }: { label: string; name: string | null; code: string | null }) {
  if (name === null) return null;
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
      <Typography component="span" sx={{ ...eyebrowSx, fontSize: "0.6rem", color: atlas.textMuted, width: 92 }}>
        {label}
      </Typography>
      <CountryFlag code={code} name={name} size="xs" />
      <Typography component="span" sx={{ color: atlas.bodyStrong, fontSize: "0.95rem", fontWeight: label === "Champion" ? 800 : 500 }}>
        {name}
      </Typography>
    </Box>
  );
}

function LeaderList({ title, leaders, valueLabel, secondaryLabel }: { title: string; leaders: Wc2026StatLeader[]; valueLabel: string; secondaryLabel?: string }) {
  return (
    <Box sx={{ border: `1px solid ${atlas.border}`, bgcolor: atlas.surfaceSoft, p: 2.5 }}>
      <Typography component="p" sx={{ ...eyebrowSx, fontSize: "0.66rem", color: atlas.gold, mb: 2 }}>
        {title}
      </Typography>
      {leaders.length === 0 ? (
        <Typography variant="body2" sx={{ color: atlas.textMuted }}>
          Not recorded in the archive dataset.
        </Typography>
      ) : (
        leaders.map((leader, index) => (
          <Box
            key={`${leader.sourcePlayerId}`}
            component={Link}
            href={`/tournaments/2026/players/${leader.sourcePlayerId}`}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1.25,
              py: 0.9,
              textDecoration: "none",
              borderTop: index > 0 ? `1px solid ${atlas.border}` : "none",
              "&:hover span:nth-of-type(2)": { color: atlas.goldStrong },
            }}
          >
            <Typography component="span" sx={{ ...tabularNums, fontSize: "0.72rem", color: atlas.textMuted, width: 20 }}>
              {index + 1}
            </Typography>
            <CountryFlag code={leader.teamCode} name={null} size="xs" />
            <Typography component="span" sx={{ color: atlas.bodyStrong, fontSize: "0.88rem", flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {leader.name}
            </Typography>
            <Typography component="span" sx={{ ...tabularNums, fontFamily: atlas.fontDisplay, fontWeight: 900, color: atlas.textPrimary }}>
              {leader.value}
              {secondaryLabel !== undefined && leader.secondary != null && leader.secondary > 0 ? (
                <Typography component="span" sx={{ fontSize: "0.68rem", color: atlas.textMuted, ml: 0.5 }}>
                  ({leader.secondary} {secondaryLabel})
                </Typography>
              ) : null}
            </Typography>
          </Box>
        ))
      )}
      <Typography component="p" sx={{ ...eyebrowSx, fontSize: "0.55rem", color: atlas.textMuted, mt: 1.5 }}>
        {valueLabel}
      </Typography>
    </Box>
  );
}

function GroupTable({ group }: { group: Wc2026Group }) {
  return (
    <Box sx={{ border: `1px solid ${atlas.border}`, bgcolor: atlas.surfaceSoft }}>
      <Typography component="p" sx={{ ...eyebrowSx, fontSize: "0.66rem", color: atlas.gold, px: 2, pt: 1.75, pb: 1.25 }}>
        Group {group.letter}
      </Typography>
      <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", "& th, & td": { fontSize: "0.78rem", px: 1, py: 0.75, textAlign: "right", borderTop: `1px solid ${atlas.border}` }, "& th": { ...eyebrowSx, fontSize: "0.55rem", color: atlas.textMuted, pb: 0.75 } }}>
        <Box component="thead">
          <Box component="tr">
            <Box component="th" sx={{ textAlign: "left", pl: 2 }}>Team</Box>
            <Box component="th">P</Box>
            <Box component="th">W</Box>
            <Box component="th">D</Box>
            <Box component="th">L</Box>
            <Box component="th">GF</Box>
            <Box component="th">GA</Box>
            <Box component="th" sx={{ pr: 2 }}>Pts</Box>
          </Box>
        </Box>
        <Box component="tbody">
          {group.rows.map((row, index) => (
            <Box component="tr" key={row.teamName} sx={{ backgroundColor: index < 2 ? "rgba(0,217,255,0.05)" : "transparent" }}>
              <Box component="td" sx={{ textAlign: "left", pl: 2, color: atlas.bodyStrong }}>
                <Box sx={{ display: "inline-flex", alignItems: "center", gap: 1 }}>
                  <CountryFlag code={row.teamCode} name={row.teamName} size="xs" />
                  <Typography component="span" sx={{ fontSize: "0.82rem", fontWeight: index < 2 ? 700 : 400 }}>
                    {row.teamName}
                  </Typography>
                </Box>
              </Box>
              <Box component="td" sx={{ ...tabularNums }}>{row.played}</Box>
              <Box component="td" sx={{ ...tabularNums }}>{row.wins}</Box>
              <Box component="td" sx={{ ...tabularNums }}>{row.draws}</Box>
              <Box component="td" sx={{ ...tabularNums }}>{row.losses}</Box>
              <Box component="td" sx={{ ...tabularNums }}>{row.goalsFor}</Box>
              <Box component="td" sx={{ ...tabularNums }}>{row.goalsAgainst}</Box>
              <Box component="td" sx={{ ...tabularNums, pr: 2, fontWeight: 800, color: atlas.textPrimary }}>{row.points}</Box>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

// --- hub -------------------------------------------------------------------

export default async function Wc2026Hub({
  overview,
  rawParams,
}: {
  overview: Wc2026Overview;
  rawParams: RawSearchParams;
}) {
  const playerQuery = getStringParam(rawParams, "pq", 60);
  const [matches, teams, venues, stats, playerResult] = await Promise.all([
    getWc2026Matches(),
    getWc2026Teams(),
    getWc2026Venues(),
    getWc2026Stats(),
    getWc2026Players({ q: playerQuery, limit: 48 }),
  ]);
  const groups = computeGroupStandings(matches.filter((m) => m.stageName === "Group Stage"));
  const knockoutByStage = KNOCKOUT_ORDER.flatMap((stageName) => {
    const stageMatches = matches.filter((m) => m.stageName === stageName);
    return stageMatches.length > 0 ? [{ stageName, matches: stageMatches }] : [];
  });
  const championPath =
    overview.championCode === null
      ? []
      : matches.filter(
          (m) =>
            m.homeTeamCode === overview.championCode ||
            m.awayTeamCode === overview.championCode,
        );
  const hostLabel = overview.hosts
    .map((code) => ({ CAN: "Canada", MEX: "Mexico", USA: "United States" })[code] ?? code)
    .join(", ");

  return (
    <Box>
      {/* Hero */}
      <Box sx={{ borderBottom: `1px solid ${atlas.border}`, bgcolor: atlas.black }}>
        <PageContainer sx={{ py: { xs: 7, md: 10 } }}>
          <VaultEyebrow label={`Hosts: ${hostLabel}`} sx={{ mb: 2.5 }} />
          <Typography variant="h1" sx={{ fontSize: { xs: "3rem", sm: "3.6rem", md: "4.6rem" }, mb: 2 }}>
            2026 World Cup
          </Typography>
          <Typography variant="body1" sx={{ color: atlas.textSecondary, maxWidth: 640, mb: 3 }}>
            The completed 2026 tournament, archived: every match, squad, venue,
            and stat from the imported archive dataset.
          </Typography>
          <Box sx={{ display: "grid", gap: 1 }}>
            <PodiumLine label="Champion" name={overview.championName} code={overview.championCode} />
            <PodiumLine label="Runner-up" name={overview.runnerUpName} code={overview.runnerUpCode} />
            <PodiumLine label="Third" name={overview.thirdName} code={overview.thirdCode} />
            <PodiumLine label="Fourth" name={overview.fourthName} code={overview.fourthCode} />
          </Box>
          <Typography component="p" sx={{ ...tabularNums, color: atlas.textMuted, mt: 3, fontSize: "0.8rem" }}>
            Data source: {MOMINUL_ATTRIBUTION}
          </Typography>
        </PageContainer>
      </Box>

      {/* Stat band */}
      <PageContainer component="section" sx={{ pt: { xs: 4, md: 5 } }}>
        <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "repeat(2, minmax(0,1fr))", sm: "repeat(3, minmax(0,1fr))", lg: "repeat(5, minmax(0,1fr))" } }}>
          <StatCell label="Teams" value={String(overview.teamsCount)} />
          <StatCell label="Matches" value={String(overview.matchesCount)} />
          <StatCell label="Venues" value={String(overview.venuesCount)} />
          <StatCell label="Goals" value={String(overview.goalsCount)} />
          <StatCell label="Players" value={String(overview.playersCount)} />
        </Box>
      </PageContainer>

      {/* Anchor tabs */}
      <Box sx={{ position: "sticky", top: 0, zIndex: 10, bgcolor: atlas.black, borderBottom: `1px solid ${atlas.border}` }}>
        <PageContainer>
          <Box sx={{ display: "flex", gap: { xs: 2, md: 3.5 }, overflowX: "auto", py: 1.75 }}>
            {SECTIONS.map((section) => (
              <Typography
                key={section.id}
                component="a"
                href={`#${section.id}`}
                sx={{ ...eyebrowSx, fontSize: "0.66rem", color: atlas.textSecondary, whiteSpace: "nowrap", textDecoration: "none", "&:hover": { color: atlas.goldStrong } }}
              >
                {section.label}
              </Typography>
            ))}
          </Box>
        </PageContainer>
      </Box>

      {/* Overview */}
      <PageContainer component="section" id="overview" sx={SECTION_SX}>
        <SectionHeading eyebrow="The decider" title="Overview" />
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" } }}>
          <Box sx={{ border: `1px solid ${atlas.goldBorder}`, bgcolor: atlas.surfaceSoft, p: 3 }}>
            <Typography component="p" sx={{ ...eyebrowSx, fontSize: "0.62rem", color: atlas.gold, mb: 1.5 }}>
              The Final · {overview.finalMatch?.date ?? ""}
            </Typography>
            {overview.finalMatch !== null ? (
              <>
                <Typography sx={{ fontFamily: atlas.fontDisplay, fontWeight: 900, fontSize: "1.5rem", color: atlas.textPrimary }}>
                  {overview.finalMatch.homeTeamName} {wc2026ScoreLine(overview.finalMatch)} {overview.finalMatch.awayTeamName}
                </Typography>
                <Typography variant="body2" sx={{ color: atlas.textMuted, mt: 1 }}>
                  {overview.finalMatch.venueName ?? ""}
                  {overview.finalMatch.cityName !== null ? ` · ${overview.finalMatch.cityName}` : ""}
                </Typography>
                <Box sx={{ mt: 2.5 }}>
                  <VaultButton component={Link} href={`/matches/2026/${overview.finalMatch.sourceMatchId}`} variant="outline">
                    Final match report
                  </VaultButton>
                </Box>
              </>
            ) : null}
          </Box>
          <Box sx={{ border: `1px solid ${atlas.border}`, bgcolor: atlas.surfaceSoft, p: 3 }}>
            <Typography component="p" sx={{ ...eyebrowSx, fontSize: "0.62rem", color: atlas.gold, mb: 1.5 }}>
              Awards
            </Typography>
            <Typography variant="body2" sx={{ color: atlas.textMuted }}>
              Awards are not included in the selected dataset. Match-level
              player-of-the-match honours appear on each match report page.
            </Typography>
          </Box>
        </Box>
        {championPath.length > 0 ? (
          <Box sx={{ mt: 4 }}>
            <Typography component="p" sx={{ ...eyebrowSx, fontSize: "0.66rem", color: atlas.gold, mb: 2 }}>
              {overview.championName}&apos;s road to the title
            </Typography>
            <Wc2026MatchRows matches={championPath} showStage />
          </Box>
        ) : null}
      </PageContainer>

      {/* Matches */}
      <PageContainer component="section" id="matches" sx={SECTION_SX}>
        <SectionHeading
          eyebrow="All 104 fixtures"
          title="Matches"
          subtitle="Every completed 2026 match with final scores. Open a row for events, lineups, and team stats."
          action={
            <VaultButton component={Link} href="/schedule/2026" variant="text">
              Full schedule view
            </VaultButton>
          }
        />
        <Wc2026MatchRows matches={matches} />
      </PageContainer>

      {/* Groups */}
      <PageContainer component="section" id="groups" sx={SECTION_SX}>
        <SectionHeading
          eyebrow="12 groups"
          title="Groups"
          subtitle="Final tables computed from the imported group-stage results."
        />
        {groups.length === 0 ? (
          <EmptyState title="Group results unavailable" />
        ) : (
          <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0,1fr))", lg: "repeat(3, minmax(0,1fr))" } }}>
            {groups.map((group) => (
              <GroupTable key={group.letter} group={group} />
            ))}
          </Box>
        )}
      </PageContainer>

      {/* Bracket */}
      <PageContainer component="section" id="bracket" sx={SECTION_SX}>
        <SectionHeading
          eyebrow="Knockout rounds"
          title="Bracket"
          subtitle="Round of 32 through the Final, from the imported knockout results."
        />
        <Box sx={{ display: "grid", gap: 3 }}>
          {knockoutByStage.map((stage) => (
            <Box key={stage.stageName}>
              <Typography component="p" sx={{ ...eyebrowSx, fontSize: "0.66rem", color: atlas.gold, mb: 1.5 }}>
                {stage.stageName}
              </Typography>
              <Wc2026MatchRows matches={stage.matches} />
            </Box>
          ))}
        </Box>
      </PageContainer>

      {/* Teams */}
      <PageContainer component="section" id="teams" sx={SECTION_SX}>
        <SectionHeading eyebrow="48 nations" title="Teams" />
        <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "repeat(2, minmax(0,1fr))", sm: "repeat(3, minmax(0,1fr))", lg: "repeat(4, minmax(0,1fr))" } }}>
          {teams.map((team) => (
            <Box key={team.id} sx={{ border: `1px solid ${atlas.border}`, bgcolor: atlas.surfaceSoft, p: 2 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, mb: 1 }}>
                <CountryFlag code={team.fifaCode} name={team.name} size="sm" />
                <Typography component="p" sx={{ color: atlas.bodyStrong, fontWeight: 700, fontSize: "0.92rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {team.name}
                </Typography>
              </Box>
              <Typography component="p" sx={{ fontSize: "0.72rem", color: atlas.textMuted }}>
                {team.groupLetter !== null ? `Group ${team.groupLetter}` : "—"}
                {team.confederation !== null ? ` · ${team.confederation}` : ""}
                {team.fifaRanking !== null ? ` · FIFA #${team.fifaRanking}` : ""}
              </Typography>
              {team.managerName !== null ? (
                <Typography component="p" sx={{ fontSize: "0.72rem", color: atlas.textMuted, mt: 0.5 }}>
                  Manager: {team.managerName}
                </Typography>
              ) : null}
            </Box>
          ))}
        </Box>
      </PageContainer>

      {/* Venues */}
      <PageContainer component="section" id="venues" sx={SECTION_SX}>
        <SectionHeading eyebrow="16 stadiums" title="Venues" />
        <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0,1fr))", lg: "repeat(4, minmax(0,1fr))" } }}>
          {venues.map((venue) => (
            <Box key={venue.id} sx={{ border: `1px solid ${atlas.border}`, bgcolor: atlas.surfaceSoft, p: 2 }}>
              <Typography component="p" sx={{ color: atlas.bodyStrong, fontWeight: 700, fontSize: "0.92rem" }}>
                {venue.name}
              </Typography>
              <Typography component="p" sx={{ fontSize: "0.72rem", color: atlas.textMuted, mt: 0.5 }}>
                {[venue.city, venue.country].filter((v) => v !== null).join(" · ")}
              </Typography>
              <Typography component="p" sx={{ ...tabularNums, fontSize: "0.72rem", color: atlas.textMuted, mt: 0.5 }}>
                {venue.capacity !== null ? `Capacity ${venue.capacity.toLocaleString("en-US")}` : ""}
                {venue.elevationMeters !== null ? ` · ${venue.elevationMeters} m elevation` : ""}
              </Typography>
            </Box>
          ))}
        </Box>
      </PageContainer>

      {/* Players */}
      <PageContainer component="section" id="players" sx={SECTION_SX}>
        <SectionHeading
          eyebrow={`${overview.playersCount.toLocaleString("en-US")} players`}
          title="Players"
          subtitle="Search the imported 2026 squads. Open a player for tournament stats."
        />
        <Box component="form" method="get" action="/tournaments/2026#players" sx={{ mb: 2.5, display: "flex", gap: 1.5, flexWrap: "wrap" }}>
          <Box
            component="input"
            type="text"
            name="pq"
            defaultValue={playerQuery ?? ""}
            placeholder="Search player name…"
            aria-label="Search players"
            sx={{
              bgcolor: atlas.surface2,
              border: `1px solid ${atlas.border}`,
              color: atlas.textPrimary,
              px: 2,
              py: 1.1,
              fontSize: "0.9rem",
              minWidth: { xs: "100%", sm: 320 },
              outline: "none",
              "&:focus": { borderColor: atlas.goldBorder },
            }}
          />
          <VaultButton type="submit" variant="outline">
            Search
          </VaultButton>
        </Box>
        {playerResult.players.length === 0 ? (
          <EmptyState title="No players match" description="Try a different name." />
        ) : (
          <>
            <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0,1fr))", lg: "repeat(3, minmax(0,1fr))" } }}>
              {playerResult.players.map((player) => (
                <Box
                  key={player.sourcePlayerId}
                  component={Link}
                  href={`/tournaments/2026/players/${player.sourcePlayerId}`}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1.25,
                    border: `1px solid ${atlas.border}`,
                    bgcolor: atlas.surfaceSoft,
                    px: 1.75,
                    py: 1.25,
                    textDecoration: "none",
                    "&:hover": { borderColor: atlas.goldBorder },
                  }}
                >
                  <CountryFlag code={player.teamCode} name={player.teamName} size="xs" />
                  <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                    <Typography component="p" sx={{ color: atlas.bodyStrong, fontSize: "0.88rem", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {player.name}
                    </Typography>
                    <Typography component="p" sx={{ fontSize: "0.68rem", color: atlas.textMuted }}>
                      {[player.position, player.teamName].filter((v) => v !== null).join(" · ")}
                    </Typography>
                  </Box>
                  {player.goals !== null && player.goals > 0 ? (
                    <Typography component="span" sx={{ ...tabularNums, fontSize: "0.75rem", color: atlas.gold }}>
                      {player.goals}⚽
                    </Typography>
                  ) : null}
                </Box>
              ))}
            </Box>
            {playerResult.total > playerResult.players.length ? (
              <Typography variant="body2" sx={{ color: atlas.textMuted, mt: 2 }}>
                Showing {playerResult.players.length} of {playerResult.total} players — refine the search to narrow further.
              </Typography>
            ) : null}
          </>
        )}
      </PageContainer>

      {/* Stats */}
      <PageContainer component="section" id="stats" sx={{ ...SECTION_SX, pb: { xs: 7, md: 9 } }}>
        <SectionHeading
          eyebrow="Tournament leaders"
          title="Stats"
          subtitle="Computed from the imported player and match statistics."
        />
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0,1fr))" } }}>
          <LeaderList title="Top scorers" leaders={stats.topScorers} valueLabel="Goals" secondaryLabel="assists" />
          <LeaderList title="Most assists" leaders={stats.topAssists} valueLabel="Assists" secondaryLabel="goals" />
          <LeaderList title="Most cards" leaders={stats.mostCards} valueLabel="Total cards" secondaryLabel="red" />
          <LeaderList title="Goalkeepers — clean sheets" leaders={stats.goalkeepers} valueLabel="Clean sheets" secondaryLabel="saves" />
        </Box>
        {stats.teamXg.length > 0 ? (
          <Box sx={{ mt: 3, border: `1px solid ${atlas.border}`, bgcolor: atlas.surfaceSoft, p: 2.5, overflowX: "auto" }}>
            <Typography component="p" sx={{ ...eyebrowSx, fontSize: "0.66rem", color: atlas.gold, mb: 2 }}>
              Team xG (top 12 by expected goals for)
            </Typography>
            <Box component="table" sx={{ width: "100%", minWidth: 480, borderCollapse: "collapse", "& th, & td": { fontSize: "0.8rem", px: 1.25, py: 0.75, textAlign: "right", borderTop: `1px solid ${atlas.border}` }, "& th": { ...eyebrowSx, fontSize: "0.55rem", color: atlas.textMuted } }}>
              <Box component="thead">
                <Box component="tr">
                  <Box component="th" sx={{ textAlign: "left" }}>Team</Box>
                  <Box component="th">Matches</Box>
                  <Box component="th">xG for</Box>
                  <Box component="th">xG against</Box>
                  <Box component="th">Goals</Box>
                </Box>
              </Box>
              <Box component="tbody">
                {stats.teamXg.map((row) => (
                  <Box component="tr" key={row.teamName}>
                    <Box component="td" sx={{ textAlign: "left" }}>
                      <Box sx={{ display: "inline-flex", alignItems: "center", gap: 1 }}>
                        <CountryFlag code={row.teamCode} name={row.teamName} size="xs" />
                        <Typography component="span" sx={{ fontSize: "0.84rem", color: atlas.bodyStrong }}>
                          {row.teamName}
                        </Typography>
                      </Box>
                    </Box>
                    <Box component="td" sx={{ ...tabularNums }}>{row.matches}</Box>
                    <Box component="td" sx={{ ...tabularNums, color: atlas.textPrimary, fontWeight: 700 }}>{row.xgFor.toFixed(1)}</Box>
                    <Box component="td" sx={{ ...tabularNums }}>{row.xgAgainst.toFixed(1)}</Box>
                    <Box component="td" sx={{ ...tabularNums }}>{row.goalsFor}</Box>
                  </Box>
                ))}
              </Box>
            </Box>
          </Box>
        ) : null}
        <Typography component="p" sx={{ fontSize: "0.75rem", color: atlas.textMuted, mt: 3 }}>
          Data source: {MOMINUL_ATTRIBUTION}. Prediction/ML feature data from the
          source repository is deliberately excluded from this archive.
        </Typography>
      </PageContainer>
    </Box>
  );
}
