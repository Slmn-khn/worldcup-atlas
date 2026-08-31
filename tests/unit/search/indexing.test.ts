// Tests for the builder-doc → SearchDocument-row mapping used by
// `pnpm search:index` (scripts/search/build-postgres-index.ts). Pure
// functions — the document construction is exercised with synthetic docs,
// standing in for the Prisma-backed builders.

import { describe, expect, it } from "vitest";

import {
  SEARCH_PRIORITY_BY_TYPE,
  countByEntityType,
  isWorldCup2026Doc,
  slugFromHref,
  toSearchDocumentRow,
  toSearchDocumentRows,
} from "@/server/search/indexing";
import type { SearchDocument } from "@/server/search/types";

const tournamentDoc: SearchDocument = {
  id: "wc2026-tournament",
  type: "tournament",
  title: "2026 World Cup",
  subtitle: "Completed tournament archive",
  description: "Champion Spain · Final Spain 1–0 Argentina AET",
  href: "/tournaments/2026",
  keywords: ["2026", "world cup 2026", "2026 final", "Spain"],
  tournamentYear: 2026,
  sortYear: 2026,
};

const matchDoc: SearchDocument = {
  id: "wc2026-match-abc",
  type: "match",
  title: "Spain 1–0 Argentina",
  subtitle: "2026 · Final",
  description: "New York New Jersey Stadium (MetLife Stadium)",
  href: "/matches/2026/104",
  keywords: ["Spain", "Argentina", "Final", "2026"],
  tournamentYear: 2026,
  stage: "Final",
  sortYear: 2026,
};

const factDoc: SearchDocument = {
  id: "fact-clx123",
  type: "fact",
  title: "Brazil 1970: The First Team to Win Three World Cups",
  subtitle: "Discovery Vault · Record",
  description: "Brazil won their third title in Mexico in 1970.",
  href: "/facts/brazil-1970-first-team-to-three-titles",
  keywords: ["brazil", "1970", "Record", "fact", "discovery vault"],
  tournamentYear: 1970,
  sortYear: 1970,
};

describe("toSearchDocumentRow", () => {
  it("maps a 2026 tournament doc with boosted priority and source tag", () => {
    const row = toSearchDocumentRow(tournamentDoc);
    expect(row.entityType).toBe("tournament");
    expect(row.entityId).toBe("wc2026-tournament");
    expect(row.title).toBe("2026 World Cup");
    expect(row.url).toBe("/tournaments/2026");
    expect(row.slug).toBe("2026");
    expect(row.year).toBe(2026);
    expect(row.source).toBe("mominul_2026_dataset");
    expect(row.priority).toBeLessThan(SEARCH_PRIORITY_BY_TYPE.tournament + 1);
    expect(row.priority).toBeGreaterThanOrEqual(1);
  });

  it("maps a 2026 match doc", () => {
    const row = toSearchDocumentRow(matchDoc);
    expect(row.entityType).toBe("match");
    expect(row.title).toBe("Spain 1–0 Argentina");
    expect(row.subtitle).toBe("2026 · Final");
    expect(row.body).toBe("New York New Jersey Stadium (MetLife Stadium)");
    expect(row.keywords).toContain("Argentina");
    // stage is folded into keywords so full-text search still matches it.
    expect(row.keywords).toContain("Final");
    expect(row.year).toBe(2026);
  });

  it("maps a Discovery Vault fact doc", () => {
    const row = toSearchDocumentRow(factDoc);
    expect(row.entityType).toBe("fact");
    expect(row.url).toBe("/facts/brazil-1970-first-team-to-three-titles");
    expect(row.slug).toBe("brazil-1970-first-team-to-three-titles");
    expect(row.year).toBe(1970);
    expect(row.source).toBe("fjelstul");
    expect(row.priority).toBe(SEARCH_PRIORITY_BY_TYPE.fact);
  });

  it("normalizes empty subtitle/description to null", () => {
    const row = toSearchDocumentRow({
      ...factDoc,
      subtitle: "",
      description: "  ",
    });
    expect(row.subtitle).toBeNull();
    expect(row.body).toBeNull();
  });

  it("dedupes keywords and folds player/country/stage in", () => {
    const row = toSearchDocumentRow({
      ...matchDoc,
      keywords: ["Spain", "Spain"],
      playerName: "Ferran Torres",
      countryName: "Spain",
      stage: "Final",
    });
    expect(row.keywords).toEqual(["Spain", "Ferran Torres", "Final"]);
  });
});

describe("index construction counts", () => {
  it("counts rows per entity type in sorted order", () => {
    const rows = toSearchDocumentRows([
      tournamentDoc,
      matchDoc,
      { ...matchDoc, id: "wc2026-match-def" },
      factDoc,
    ]);
    expect(rows).toHaveLength(4);
    expect(countByEntityType(rows)).toEqual([
      ["fact", 1],
      ["match", 2],
      ["tournament", 1],
    ]);
  });
});

describe("helpers", () => {
  it("derives slugs from hrefs, ignoring hash/query", () => {
    expect(slugFromHref("/players/pele")).toBe("pele");
    expect(slugFromHref("/tournaments/2026#teams")).toBe("2026");
    expect(slugFromHref("/records?tab=teams")).toBe("records");
    expect(slugFromHref("/")).toBeNull();
  });

  it("detects 2026 archive docs by id prefix", () => {
    expect(isWorldCup2026Doc(tournamentDoc)).toBe(true);
    expect(isWorldCup2026Doc(factDoc)).toBe(false);
  });
});
