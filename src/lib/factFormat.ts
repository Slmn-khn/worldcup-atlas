// Shared display formatting for Discovery Vault facts — used by the homepage
// card, the fact detail page, and the /facts archive listing so labels stay
// consistent in one place.

import type { FactCategory, FactDifficulty } from "@/generated/prisma/enums";

export const FACT_CATEGORY_LABELS: Record<FactCategory, string> = {
  FUN_FACT: "Fun Fact",
  RECORD: "Record",
  HISTORY: "History",
  PLAYER_COMPARISON: "Player Comparison",
  COUNTRY_COMPARISON: "Country Comparison",
  FINAL: "Final",
  PENALTY: "Penalty",
  HOST: "Host Nation",
  FORMAT: "Format",
  ICONIC_MOMENT: "Iconic Moment",
  SCHEDULE_2026: "2026 Schedule",
};

export const FACT_DIFFICULTY_LABELS: Record<FactDifficulty, string> = {
  CASUAL: "Casual",
  FAN: "Fan",
  EXPERT: "Expert",
};

/** "1930", "1958–2002", or null when no era is set. */
export function formatFactEra(
  eraStartYear: number | null,
  eraEndYear: number | null,
): string | null {
  if (eraStartYear === null && eraEndYear === null) return null;
  if (eraStartYear !== null && eraEndYear !== null) {
    return eraStartYear === eraEndYear
      ? String(eraStartYear)
      : `${eraStartYear}–${eraEndYear}`;
  }
  return String(eraStartYear ?? eraEndYear);
}
