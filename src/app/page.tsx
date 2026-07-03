// DB-backed home page (neon premium pass). Data comes from the server-side
// orchestrator (getHomeViewModel), which wraps every section in its own
// try/catch so a failed fixture/media/finals query degrades to a polished
// fallback instead of crashing. The visuals are a deep-blue / cyan / gold
// "stadium at night" shell (src/theme/visualTokens.ts); nothing is hardcoded.

import type { Metadata } from "next";
import Box from "@mui/material/Box";
import HomeSection from "@/components/home/HomeSection";
import SectionHeader from "@/components/ui/SectionHeader";
import EmptyState from "@/components/ui/EmptyState";
import HomeLatestMatchesSection from "@/components/fixtures/HomeLatestMatchesSection";
import HomeHero from "@/components/home/HomeHero";
import ArchiveStatsSection from "@/components/home/ArchiveStatsSection";
import DiscoveryVaultSection from "@/components/facts/DiscoveryVaultSection";
import TournamentTimelineSection from "@/components/home/TournamentTimelineSection";
import FeaturedTournamentsSection from "@/components/home/FeaturedTournamentsSection";
import RecentFinalsSection from "@/components/home/RecentFinalsSection";
import ExploreByCountrySection from "@/components/home/ExploreByCountrySection";
import TopPlayerRecordsSection from "@/components/home/TopPlayerRecordsSection";
import RecordsFirstsSection from "@/components/home/RecordsFirstsSection";
import { getHomeViewModel } from "@/server/home/queries";
import {
  atlasBorders,
  atlasColors,
  atlasGradients,
  atlasRadius,
} from "@/theme/visualTokens";

// Live archive data — always render from the current database state.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "WORLDCUP Nexus — Independent World Cup Archive" },
  description:
    "Explore every World Cup tournament, nation, player, match, goal, and penalty in one independent historical archive.",
};

export default async function Home() {
  const home = await getHomeViewModel();
  const { archiveStats } = home;

  const span =
    archiveStats.spanStart !== null && archiveStats.spanEnd !== null
      ? `${archiveStats.spanStart}–${archiveStats.spanEnd}`
      : null;

  return (
    <Box
      sx={{
        position: "relative",
        minHeight: "100vh",
        background: atlasGradients.page,
        color: atlasColors.textPrimary,
      }}
    >
      {/* 1 — Hero (full-bleed). */}
      <HomeHero span={span} />

      {/* Centered content shell with a soft rounded frame on larger screens. */}
      <Box
        sx={{
          maxWidth: 1280,
          mx: "auto",
          px: { xs: 1.5, sm: 2.5, md: 4 },
          py: { xs: 2, md: 5 },
        }}
      >
        <Box
          sx={{
            borderRadius: {
              xs: `${atlasRadius.lg}px`,
              md: `${atlasRadius.xl}px`,
            },
            border: { md: `1px solid ${atlasBorders.soft}` },
            background: {
              md: "linear-gradient(180deg, rgba(8,20,32,0.5) 0%, rgba(3,12,22,0.28) 100%)",
            },
            boxShadow: { md: "0 40px 120px rgba(0,0,0,0.5)" },
            px: { xs: 0, md: 4, lg: 6 },
            overflow: "hidden",
          }}
        >
          {/* 2 — Latest 2026 Matches / Schedule (existing fixture pipeline;
              DB-backed, no third-party calls from the browser). */}
          <HomeSection>
            <SectionHeader
              eyebrow="2026 World Cup"
              title="Latest Matches & Scores"
              accent="cyan"
              subtitle="Live, today's, recent, and upcoming 2026 World Cup fixtures."
              action={{ label: "Full schedule", href: "/schedule/2026" }}
            />
            {home.fixtures !== null ? (
              <HomeLatestMatchesSection data={home.fixtures} />
            ) : (
              <EmptyState
                title="2026 schedule temporarily unavailable"
                description="Fixtures appear here once the next sync runs. The rest of the archive is unaffected."
              />
            )}
          </HomeSection>

          {/* 3 — Archive at a Glance */}
          <ArchiveStatsSection stats={archiveStats} />

          {/* 3.5 — Discovery Vault (hourly rotating fact). */}
          <DiscoveryVaultSection hourlyFact={home.hourlyFact} />

          {/* 4 — Tournament Timeline */}
          <TournamentTimelineSection entries={home.timeline} />

          {/* 5 — Featured Tournaments */}
          <FeaturedTournamentsSection tournaments={home.featuredTournaments} />

          {/* 6 — Recent Finals / Iconic Matches */}
          <RecentFinalsSection finals={home.recentFinals} />

          {/* 7 — Explore by Country */}
          <ExploreByCountrySection countries={home.countries} />

          {/* 8 — Top Player Records */}
          <TopPlayerRecordsSection players={home.playerRecords} />

          {/* 9 — Records & Firsts */}
          <RecordsFirstsSection records={home.records} />
        </Box>
      </Box>
    </Box>
  );
}
