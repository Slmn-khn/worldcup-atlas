// Archive-through-2026 rollout: the coverage constant, the canonical bridge
// (2026 tournament card, finals entry, stat additions, nations union), the
// double-counting guard, and flag resolution for the 2026 podium/hosts.
// All pure — no database, no fs, no network.

import { describe, expect, it } from "vitest";

import { ARCHIVE_COVERAGE } from "../../../src/lib/archiveCoverage";
import {
  buildWc2026FinalSummary,
  buildWc2026StatAdditions,
  buildWc2026TournamentCard,
  countNewWc2026Nations,
  mergeWc2026TournamentCard,
  wc2026HostLabel,
} from "../../../src/server/worldcup2026/canonicalBridge";
import { getFlagCodeForCountry } from "../../../src/lib/media/flags";
import type { TournamentCardDto } from "../../../src/server/queries/types";
import type {
  Wc2026MatchDto,
  Wc2026Overview,
} from "../../../src/server/worldcup2026/queries";

const FINAL: Wc2026MatchDto = {
  id: "m104",
  sourceMatchId: 104,
  matchNumber: 104,
  date: "2026-07-19",
  kickoffTimeUtc: "20:00",
  stageName: "Final",
  groupLetter: null,
  venueName: "New York New Jersey Stadium (MetLife Stadium)",
  cityName: "East Rutherford",
  homeTeamName: "Spain",
  awayTeamName: "Argentina",
  homeTeamCode: "ESP",
  awayTeamCode: "ARG",
  homeScore: 1,
  awayScore: 0,
  homePenaltyScore: null,
  awayPenaltyScore: null,
  resultType: "AET",
  status: "Completed",
  winnerTeamCode: "ESP",
  homeXg: 0.52,
  awayXg: 0.09,
};

const OVERVIEW: Wc2026Overview = {
  teamsCount: 48,
  matchesCount: 104,
  venuesCount: 16,
  playersCount: 1248,
  goalsCount: 308,
  hosts: ["CAN", "MEX", "USA"],
  startDate: "2026-06-11",
  endDate: "2026-07-19",
  championName: "Spain",
  championCode: "ESP",
  runnerUpName: "Argentina",
  runnerUpCode: "ARG",
  thirdName: "England",
  thirdCode: "ENG",
  fourthName: "France",
  fourthCode: "FRA",
  finalMatch: FINAL,
  thirdPlaceMatch: null,
};

function canonicalCard(year: number, winner: string | null): TournamentCardDto {
  return {
    id: `t-${year}`,
    year,
    name: `${year} FIFA World Cup`,
    slug: `world-cup-${year}`,
    hostName: "Somewhere",
    teamsCount: 32,
    matchesCount: 64,
    goalsCount: 170,
    winner,
    winnerSlug: null,
    winnerCode: null,
    runnerUp: null,
    runnerUpSlug: null,
    runnerUpCode: null,
    finalScore: null,
  };
}

describe("ARCHIVE_COVERAGE", () => {
  it("spans 1930–2026 with live mode off", () => {
    expect(ARCHIVE_COVERAGE.startYear).toBe(1930);
    expect(ARCHIVE_COVERAGE.endYear).toBe(2026);
    expect(ARCHIVE_COVERAGE.label).toBe("1930–2026");
    expect(ARCHIVE_COVERAGE.latestCompletedTournamentYear).toBe(2026);
    expect(ARCHIVE_COVERAGE.includes2026).toBe(true);
    expect(ARCHIVE_COVERAGE.liveModeEnabled).toBe(false);
  });
});

describe("buildWc2026TournamentCard", () => {
  it("derives the card from the imported overview — champion, hosts, final", () => {
    const card = buildWc2026TournamentCard(OVERVIEW);
    expect(card.year).toBe(2026);
    expect(card.winner).toBe("Spain");
    expect(card.runnerUp).toBe("Argentina");
    expect(card.hostName).toBe("Canada · Mexico · USA");
    expect(card.teamsCount).toBe(48);
    expect(card.matchesCount).toBe(104);
    expect(card.goalsCount).toBe(308);
    expect(card.finalScore).toBe("1–0 AET");
  });

  it("labels penalty finals with the shootout score", () => {
    const card = buildWc2026TournamentCard({
      ...OVERVIEW,
      finalMatch: {
        ...FINAL,
        homeScore: 1,
        awayScore: 1,
        homePenaltyScore: 4,
        awayPenaltyScore: 2,
        resultType: "Penalties",
      },
    });
    expect(card.finalScore).toBe("1–1 (4–2 pens)");
  });
});

describe("mergeWc2026TournamentCard (timeline/featured/tournaments order + guard)", () => {
  const canonical = [canonicalCard(2022, "Argentina"), canonicalCard(2018, "France")];

  it("puts 2026 first, latest-to-oldest", () => {
    const merged = mergeWc2026TournamentCard(
      canonical,
      buildWc2026TournamentCard(OVERVIEW),
    );
    expect(merged.map((card) => card.year)).toEqual([2026, 2022, 2018]);
    expect(merged[0]?.winner).toBe("Spain");
  });

  it("never double-counts when canonical 2026 exists (post-promotion guard)", () => {
    const withCanonical2026 = [canonicalCard(2026, "Spain"), ...canonical];
    const merged = mergeWc2026TournamentCard(
      withCanonical2026,
      buildWc2026TournamentCard(OVERVIEW),
    );
    expect(merged).toHaveLength(3);
    expect(merged.filter((card) => card.year === 2026)).toHaveLength(1);
    expect(merged[0]?.id).toBe("t-2026");
  });

  it("passes canonical cards through when the 2026 archive is absent", () => {
    expect(mergeWc2026TournamentCard(canonical, null)).toBe(canonical);
  });
});

describe("buildWc2026FinalSummary (homepage Recent Finals)", () => {
  it("produces Spain 1–0 Argentina AET linking to the 2026 match report", () => {
    const summary = buildWc2026FinalSummary(OVERVIEW);
    expect(summary).not.toBeNull();
    expect(summary!.homeTeam).toBe("Spain");
    expect(summary!.awayTeam).toBe("Argentina");
    expect(summary!.score).toBe("1–0 AET");
    expect(summary!.decidedByPenalties).toBe(false);
    expect(summary!.matchSlugPath).toBe("2026/104");
    expect(summary!.venue).toContain("MetLife");
  });

  it("returns null rather than inventing a final without scores", () => {
    expect(
      buildWc2026FinalSummary({
        ...OVERVIEW,
        finalMatch: { ...FINAL, homeScore: null, awayScore: null },
      }),
    ).toBeNull();
  });
});

describe("buildWc2026StatAdditions (combined archive stats)", () => {
  it("adds one tournament and match-score-derived goals", () => {
    const additions = buildWc2026StatAdditions(OVERVIEW);
    expect(additions.tournaments).toBe(1);
    expect(additions.matches).toBe(104);
    expect(additions.goals).toBe(308);
    expect(additions.latestYear).toBe(2026);
  });
});

describe("countNewWc2026Nations", () => {
  const canonicalNations = [
    { name: "Spain", code: "ESP" },
    { name: "United States", code: "USA" },
    { name: "West Germany", code: "DEU" },
    { name: "South Korea", code: "KOR" },
  ];

  it("does not re-count returning nations, even under name variants", () => {
    expect(
      countNewWc2026Nations(
        [
          { name: "Spain", fifaCode: "ESP" },
          { name: "USA", fifaCode: "USA" }, // name differs, code/flag match
          { name: "Germany", fifaCode: "GER" }, // matches West Germany by flag
          { name: "Korea Republic", fifaCode: "KOR" },
        ],
        canonicalNations,
      ),
    ).toBe(0);
  });

  it("counts genuine 2026 debutants", () => {
    expect(
      countNewWc2026Nations(
        [
          { name: "Jordan", fifaCode: "JOR" },
          { name: "Cape Verde", fifaCode: "CPV" },
          { name: "Spain", fifaCode: "ESP" },
        ],
        canonicalNations,
      ),
    ).toBe(2);
  });
});

describe("2026 flag resolution", () => {
  it("resolves podium and host flags", () => {
    expect(getFlagCodeForCountry({ name: "Spain", code: "ESP" })).toBe("es");
    expect(getFlagCodeForCountry({ name: "Argentina", code: "ARG" })).toBe("ar");
    expect(getFlagCodeForCountry({ name: "England", code: "ENG" })).toBe("gb-eng");
    expect(getFlagCodeForCountry({ name: "France", code: "FRA" })).toBe("fr");
    expect(getFlagCodeForCountry({ name: "Canada", code: "CAN" })).toBe("ca");
    expect(getFlagCodeForCountry({ name: "Mexico", code: "MEX" })).toBe("mx");
    expect(getFlagCodeForCountry({ name: "United States", code: "USA" })).toBe("us");
  });

  it("labels the tri-host string", () => {
    expect(wc2026HostLabel(["CAN", "MEX", "USA"])).toBe("Canada · Mexico · USA");
  });
});
