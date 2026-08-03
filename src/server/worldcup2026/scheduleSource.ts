// Source resolver for /schedule/2026 in post-tournament archive mode.
//
// Preference order:
//   1. Imported WorldCup2026Match rows (Mominul-only DB import) — complete
//      104-match archive with venues and result types.
//   2. File-backed archive chain (approved Mominul pack → finalized files →
//      manual verified reference pack) via getArchived2026Schedule().
//
// Never the legacy live Fixture table, never a provider fetch, never a sync.

import {
  buildArchivedScheduleResult,
  getArchived2026Schedule,
  mominulToArchivedRows,
  type Archived2026ScheduleResult,
} from "./archiveSchedule";
import {
  getWc2026Matches,
  hasImported2026Data,
  MOMINUL_ATTRIBUTION,
} from "./queries";
import { prisma } from "@/server/db/prisma";

export type Schedule2026Display = {
  result: Archived2026ScheduleResult;
  /** Human source line for the page meta — includes attribution. */
  sourceLabel: string;
  teamsCount: number | null;
  venuesCount: number | null;
};

export async function getSchedule2026ForDisplay(): Promise<Schedule2026Display> {
  try {
    if (await hasImported2026Data()) {
      const [matches, teamsCount, venuesCount] = await Promise.all([
        getWc2026Matches(),
        prisma.worldCup2026Team.count(),
        prisma.worldCup2026Venue.count(),
      ]);
      const rows = mominulToArchivedRows(matches);
      return {
        result: buildArchivedScheduleResult(
          rows,
          rows.length,
          `Data source: ${MOMINUL_ATTRIBUTION}`,
        ),
        sourceLabel: `Data source: ${MOMINUL_ATTRIBUTION}`,
        teamsCount,
        venuesCount,
      };
    }
  } catch (error) {
    console.error("[schedule-2026] imported archive unavailable", error);
  }

  const result = await getArchived2026Schedule();
  return {
    result,
    sourceLabel: result.lastUpdatedLabel ?? "Archived 2026 data",
    teamsCount: null,
    venuesCount: null,
  };
}
