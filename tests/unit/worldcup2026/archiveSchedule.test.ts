// Archive schedule builder — the file-backed source behind /schedule/2026 in
// post-tournament mode. Tested against BOTH the real manual verified
// reference pack (frozen human-authenticated data under data/2026/reference)
// and small inline packs for the mapping/gap-fill rules.

import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import {
  approvedGapFills,
  archivedDateLabel,
  archivedStatusFor,
  archivedVerificationFor,
  buildArchivedScheduleResult,
  buildArchivedScheduleRows,
  formatArchivedScore,
  type Archived2026ScheduleRow,
} from "../../../src/server/worldcup2026/archiveSchedule";
import {
  loadManualReferencePack,
  type ManualReferencePack,
} from "../../../src/server/agents/worldcup2026/manualReferencePack";

const REAL_PACK_DIR = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "data",
  "2026",
  "reference",
  "manual-verified-v1",
);

let pack: ManualReferencePack;
let rows: Archived2026ScheduleRow[];
let byId: Map<string, Archived2026ScheduleRow>;

beforeAll(async () => {
  const result = await loadManualReferencePack(REAL_PACK_DIR);
  if (result === null || !result.ok) {
    throw new Error("real manual verified pack must load");
  }
  pack = result.pack;
  rows = buildArchivedScheduleRows(pack.matches, pack);
  byId = new Map(rows.map((row) => [row.matchId, row]));
});

describe("archivedStatusFor (mapping rules)", () => {
  const base = {
    match_id: "T-1",
    stage: "group",
    date: "2026-06-11",
    home: "MEX",
    away: "RSA",
    winner: null,
    venue_id: null,
    notes: null,
    verification: "verified" as const,
    sources: [],
  };

  it("normal score becomes FULL_TIME", () => {
    expect(
      archivedStatusFor({
        ...base,
        score: { home: 2, away: 0, extra_time: false, penalties: null },
      }),
    ).toBe("FULL_TIME");
  });

  it("extra_time true becomes AFTER_EXTRA_TIME", () => {
    expect(
      archivedStatusFor({
        ...base,
        score: { home: 2, away: 1, extra_time: true, penalties: null },
      }),
    ).toBe("AFTER_EXTRA_TIME");
  });

  it("penalties become PENALTIES, even after extra time", () => {
    expect(
      archivedStatusFor({
        ...base,
        score: {
          home: 1,
          away: 1,
          extra_time: true,
          penalties: { home: 2, away: 3, winner: "RSA" },
        },
      }),
    ).toBe("PENALTIES");
  });

  it("null score becomes RESULT_UNDER_REVIEW even when a shootout winner is known", () => {
    expect(
      archivedStatusFor({
        ...base,
        score: {
          home: null,
          away: null,
          extra_time: false,
          penalties: { home: null, away: null, winner: "MEX" },
        },
      }),
    ).toBe("RESULT_UNDER_REVIEW");
  });

  it("missing team becomes RESULT_UNDER_REVIEW", () => {
    expect(
      archivedStatusFor({
        ...base,
        away: null,
        score: { home: 1, away: 0, extra_time: false, penalties: null },
      }),
    ).toBe("RESULT_UNDER_REVIEW");
  });

  it("never returns SCHEDULED for any pack row", () => {
    for (const match of pack.matches) {
      expect(archivedStatusFor(match)).not.toBe("SCHEDULED");
    }
  });
});

describe("display helpers", () => {
  it("formats dates and flags missing ones for review", () => {
    expect(archivedDateLabel("2026-06-11")).toBe("11 June 2026");
    expect(archivedDateLabel(null)).toBe("Date under review");
  });

  it("maps pack verification levels", () => {
    expect(archivedVerificationFor("verified")).toBe("VERIFIED");
    expect(archivedVerificationFor("reported")).toBe("REPORTED");
    expect(archivedVerificationFor("partial")).toBe("PARTIAL");
    expect(archivedVerificationFor("unverified")).toBe("NEEDS_REVIEW");
  });
});

describe("buildArchivedScheduleRows over the real reference pack", () => {
  it("captures all 67 pack rows and never a SCHEDULED status", () => {
    expect(rows).toHaveLength(67);
    for (const row of rows) {
      expect(["FULL_TIME", "AFTER_EXTRA_TIME", "PENALTIES", "RESULT_UNDER_REVIEW", "INCOMPLETE"]).toContain(row.status);
    }
  });

  it("resolves team codes to display names", () => {
    const opener = byId.get("GA-1");
    expect(opener?.homeTeamName).toBe("Mexico");
    expect(opener?.awayTeamName).toBe("South Africa");
    expect(opener?.status).toBe("FULL_TIME");
    expect(opener?.verification).toBe("VERIFIED");
    expect(formatArchivedScore(opener!)).toBe("2–0");
  });

  it("resolves venue_id to the archive-canonical stadium name", () => {
    const r16 = byId.get("M89");
    expect(r16?.venueName).toBe("NRG Stadium");
    expect(r16?.cityName).toBe("Houston, Texas");
  });

  it("labels only confirmed group letters, never inventing one", () => {
    expect(byId.get("GA-1")?.groupName).toBe("Group A");
    expect(byId.get("GB-1")?.groupName).toBe("Group B");
    // GX-* teams belong to groups whose letters are unconfirmed in sources.
    expect(byId.get("GX-1")?.groupName).toBeNull();
    expect(byId.get("GX-1")?.stage).toBe("Group Stage");
  });

  it("formats penalty shootouts with the pens score", () => {
    const shootout = byId.get("M74");
    expect(shootout?.status).toBe("PENALTIES");
    expect(formatArchivedScore(shootout!)).toBe("1–1 (3–4 pens)");
    // Extra time + penalties is still a PENALTIES result.
    expect(byId.get("M75")?.status).toBe("PENALTIES");
  });

  it("final M104 formats as Spain 1–0 Argentina AET", () => {
    const final = byId.get("M104");
    expect(final?.homeTeamName).toBe("Spain");
    expect(final?.awayTeamName).toBe("Argentina");
    expect(final?.status).toBe("AFTER_EXTRA_TIME");
    expect(final?.winnerTeamCode).toBe("ESP");
    expect(formatArchivedScore(final!)).toBe("1–0 AET");
    expect(final?.venueName).toBe("MetLife Stadium");
  });

  it("keeps unresolved rows under review — M88 has no approved gap-fill", () => {
    const m88 = byId.get("M88");
    expect(m88?.status).toBe("RESULT_UNDER_REVIEW");
    expect(m88?.verification).toBe("NEEDS_REVIEW");
    expect(m88?.homeTeamName).toBe("Colombia");
    expect(m88?.awayTeamName).toBeNull();
    expect(formatArchivedScore(m88!)).toBeNull();
    for (const id of ["GB-6", "M92", "M93", "M94", "M95", "M96"]) {
      expect(byId.get(id)?.status).toBe("RESULT_UNDER_REVIEW");
    }
  });

  it("sorts by date ascending with undated rows last", () => {
    expect(rows[0]?.date).toBe("2026-06-11");
    const undatedFrom = rows.findIndex((row) => row.date === null);
    expect(undatedFrom).toBeGreaterThan(0);
    for (const row of rows.slice(undatedFrom)) {
      expect(row.date).toBeNull();
      expect(row.dateLabel).toBe("Date under review");
    }
  });

  it("summarizes counts for the header stats", () => {
    const result = buildArchivedScheduleResult(rows, pack.officialMatchCount);
    expect(result.mode).toBe("ARCHIVE");
    expect(result.tournamentComplete).toBe(true);
    expect(result.totalOfficialMatches).toBe(104);
    expect(result.capturedMatches).toBe(67);
    expect(result.unresolvedCount).toBe(7);
    expect(result.verifiedCount).toBe(60);
  });
});

describe("approved review gap-fills", () => {
  const m88Fill = {
    match_id: "M88",
    stage: "round_of_32",
    date: "2026-07-03",
    home: "COL",
    away: "SCO",
    score: { home: 2, away: 1, extra_time: false, penalties: null },
    winner: "COL",
    venue_id: null,
    notes: "Filled from reviewed provider data.",
    verification: "verified" as const,
    sources: ["provider-x"],
  };

  it("only approved decisions produce gap-fills", () => {
    const fills = approvedGapFills({
      decisions: [
        { approved: false, match: m88Fill },
        { approved: true },
      ],
    });
    expect(fills.size).toBe(0);
  });

  it("an approved fill resolves the row but is capped at REPORTED", () => {
    const filled = buildArchivedScheduleRows(
      pack.matches,
      pack,
      approvedGapFills({ decisions: [{ approved: true, match: m88Fill }] }),
    );
    const m88 = filled.find((row) => row.matchId === "M88");
    expect(m88?.status).toBe("FULL_TIME");
    expect(m88?.awayTeamName).toBe("Scotland");
    // Reviewed provider evidence never silently becomes VERIFIED.
    expect(m88?.verification).toBe("REPORTED");
  });

  it("an approved fill never overrides a pack-verified row", () => {
    const tamperedFinal = { ...m88Fill, match_id: "M104", home: "FRA", away: "ENG" };
    const filled = buildArchivedScheduleRows(
      pack.matches,
      pack,
      approvedGapFills({ decisions: [{ approved: true, match: tamperedFinal }] }),
    );
    const final = filled.find((row) => row.matchId === "M104");
    expect(final?.homeTeamName).toBe("Spain");
    expect(final?.verification).toBe("VERIFIED");
  });
});
