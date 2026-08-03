// Tournament detail page (Checkpoint 5B) — database-backed via the query layer.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import PageContainer from "@/components/layout/PageContainer";
import SectionHeading from "@/components/ui/SectionHeading";
import EmptyState from "@/components/ui/EmptyState";
import TournamentHero from "@/components/tournaments/TournamentHero";
import TournamentStatGrid from "@/components/tournaments/TournamentStatGrid";
import TournamentSectionNav from "@/components/tournaments/TournamentSectionNav";
import TournamentTeamsGrid from "@/components/tournaments/TournamentTeamsGrid";
import TournamentMatchList from "@/components/tournaments/TournamentMatchList";
import TournamentTopScorers from "@/components/tournaments/TournamentTopScorers";
import TournamentAwards from "@/components/tournaments/TournamentAwards";
import VaultFilterBar from "@/components/filters/VaultFilterBar";
import { formatNumber, formatStage } from "@/lib/format";
import { getStringParam, type RawSearchParams } from "@/lib/search-params";
import { getTournamentByYear } from "@/server/queries/tournaments";
import { getWc2026Overview } from "@/server/worldcup2026/queries";
import Wc2026Hub from "@/components/worldcup2026/Wc2026Hub";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ year: string }>;
  searchParams: Promise<RawSearchParams>;
};

function parseYear(raw: string): number | null {
  const year = Number(raw);
  return Number.isInteger(year) && year >= 1900 && year <= 2100 ? year : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { year: rawYear } = await params;
  const year = parseYear(rawYear);
  if (year === null) {
    return { title: "Tournament not found", robots: { index: false } };
  }
  if (year === 2026) {
    return {
      title: "2026 World Cup — Tournament Archive",
      description:
        "The completed 2026 World Cup: matches, groups, bracket, teams, venues, players, and stats from the imported archive dataset.",
    };
  }
  return {
    title: `${year} World Cup`,
    description: `Explore the ${year} World Cup tournament, including teams, matches, goals, awards, and records.`,
  };
}

const SECTION_SX = { py: { xs: 4, md: 5 }, scrollMarginTop: 96 };

export default async function TournamentDetailPage({
  params,
  searchParams,
}: Props) {
  const { year: rawYear } = await params;
  const year = parseYear(rawYear);
  if (year === null) notFound();

  // 2026 — the imported Mominul archive hub (quarantined WorldCup2026*
  // tables), not the canonical historical Tournament model. Falls through to
  // the standard page (and its 404) when the import has not run.
  if (year === 2026) {
    const [overview, rawParams2026] = await Promise.all([
      getWc2026Overview(),
      searchParams,
    ]);
    if (overview !== null) {
      return <Wc2026Hub overview={overview} rawParams={rawParams2026} />;
    }
  }

  const [tournament, rawParams] = await Promise.all([
    getTournamentByYear(year),
    searchParams,
  ]);
  if (tournament === null) notFound();

  const shootoutMatches = tournament.matches.filter(
    (match) => match.decidedByPenalties,
  );

  // Local archive controls — they narrow the match list only; the hero,
  // stats, awards, and top scorers always show the full tournament.
  const matchFilters = {
    q: getStringParam(rawParams, "q"),
    stage: getStringParam(rawParams, "stage"),
    teamSlug: getStringParam(rawParams, "teamSlug"),
  };
  const q = matchFilters.q?.toLowerCase();
  const filteredMatches = tournament.matches.filter((match) => {
    if (
      matchFilters.stage !== undefined &&
      match.stage.toLowerCase() !== matchFilters.stage.toLowerCase()
    ) {
      return false;
    }
    if (
      matchFilters.teamSlug !== undefined &&
      match.homeTeam.slug !== matchFilters.teamSlug &&
      match.awayTeam.slug !== matchFilters.teamSlug
    ) {
      return false;
    }
    if (q !== undefined) {
      const haystack =
        `${match.homeTeam.name} ${match.awayTeam.name} ${match.stage} ${match.stadiumName ?? ""}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
  const stageOptions = [
    ...new Set(tournament.matches.map((match) => match.stage)),
  ].map((stage) => ({
    label: formatStage(stage) ?? stage,
    value: stage,
  }));
  const teamOptions = tournament.teams.map((team) => ({
    label: team.name,
    value: team.slug,
  }));
  const teamName =
    teamOptions.find((option) => option.value === matchFilters.teamSlug)
      ?.label ?? matchFilters.teamSlug;

  const activeMatchFilters = [
    matchFilters.q !== undefined
      ? { param: "q", label: "Search", value: matchFilters.q }
      : null,
    matchFilters.stage !== undefined
      ? {
          param: "stage",
          label: "Stage",
          value: formatStage(matchFilters.stage) ?? matchFilters.stage,
        }
      : null,
    matchFilters.teamSlug !== undefined
      ? { param: "teamSlug", label: "Team", value: teamName ?? "" }
      : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null);

  return (
    <Box>
      <TournamentHero tournament={tournament} />

      <PageContainer sx={{ pt: 3 }}>
        <TournamentSectionNav />
      </PageContainer>

      {/* Overview */}
      <PageContainer component="section" id="overview" sx={SECTION_SX}>
        <SectionHeading
          eyebrow="The tournament in numbers"
          title="Overview"
          subtitle="Tournament totals counted from imported source data."
        />
        <TournamentStatGrid tournament={tournament} />
        <Typography
          variant="caption"
          sx={{ color: "text.secondary", display: "block", mt: 2 }}
        >
          Group standings and knockout bracket views will be added after
          standings/bracket queries are finalized.
        </Typography>
      </PageContainer>

      {/* Teams */}
      <PageContainer component="section" id="teams" sx={SECTION_SX}>
        <SectionHeading
          title="Teams"
          subtitle={`${formatNumber(tournament.teams.length)} nations qualified for this tournament.`}
        />
        <TournamentTeamsGrid teams={tournament.teams} />
      </PageContainer>

      {/* Matches */}
      <PageContainer component="section" id="matches" sx={SECTION_SX}>
        <SectionHeading
          title="Matches"
          subtitle={`Every match of the tournament, stage by stage (${formatNumber(tournament.matches.length)} total).`}
        />
        <Box sx={{ mb: 3 }}>
          <VaultFilterBar
            fields={[
              { kind: "search", placeholder: "Search matches…" },
              {
                kind: "select",
                param: "stage",
                label: "Stage",
                options: stageOptions,
                allLabel: "All stages",
              },
              {
                kind: "select",
                param: "teamSlug",
                label: "Team",
                options: teamOptions,
                allLabel: "All teams",
              },
            ]}
            active={activeMatchFilters}
            resultCount={filteredMatches.length}
            totalCount={tournament.matches.length}
            resultNoun="matches"
          />
        </Box>
        {filteredMatches.length > 0 ? (
          <TournamentMatchList matches={filteredMatches} />
        ) : (
          <EmptyState
            title="No matches fit these filters"
            description="No match in this tournament fits the current stage, team, or search."
          />
        )}
      </PageContainer>

      {/* Top Scorers */}
      <PageContainer component="section" id="top-scorers" sx={SECTION_SX}>
        <SectionHeading
          title="Top Scorers"
          subtitle="Leading scorers of the tournament, excluding own goals."
        />
        <TournamentTopScorers scorers={tournament.topScorers} />
      </PageContainer>

      {/* Awards */}
      <PageContainer component="section" id="awards" sx={SECTION_SX}>
        <SectionHeading
          eyebrow="Honours"
          title="Awards"
          subtitle="Official tournament awards in the archive."
        />
        <TournamentAwards awards={tournament.awards} />
      </PageContainer>

      {/* Penalties */}
      <PageContainer
        component="section"
        id="penalties"
        sx={{ ...SECTION_SX, pb: { xs: 7, md: 9 } }}
      >
        <SectionHeading
          title="Penalty Shootouts"
          subtitle={
            tournament.stats.penaltyShootouts > 0
              ? `${formatNumber(tournament.stats.penaltyShootouts)} matches went to penalties, with ${formatNumber(tournament.stats.penaltyKicks)} shootout kicks recorded.`
              : undefined
          }
        />
        {shootoutMatches.length > 0 ? (
          <TournamentMatchList matches={shootoutMatches} />
        ) : (
          <EmptyState
            title="No penalty shootouts"
            description="No match at this tournament was decided by a penalty shootout."
          />
        )}
      </PageContainer>
    </Box>
  );
}
