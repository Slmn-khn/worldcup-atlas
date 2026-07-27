// Player identity resolution for the 2026 candidate providers (Phase 1).
//
// Resolves provider player rows onto known player identities with explicit
// confidence. Ambiguous names (two players sharing a normalized name within
// the same team, or a name matching multiple teams when no team is given)
// are NEVER merged — they resolve to UNRESOLVED and stay separate records.

import { canonicalTeamKey, normalizeSlug } from "./resolver";

export const PLAYER_RESOLUTION_CONFIDENCES = [
  "EXACT_PROVIDER_ID",
  "EXACT_NAME_TEAM",
  "UNRESOLVED",
] as const;
export type PlayerResolutionConfidence =
  (typeof PLAYER_RESOLUTION_CONFIDENCES)[number];

/** A player identity the pipeline already knows (from any provider file). */
export type ReferencePlayer = {
  /** Stable key the resolution points back to. */
  key: string;
  /** Provider-specific player ids this player is known under. */
  providerIds?: Array<string | number | null | undefined>;
  name?: string | null;
  /** Team code or name; resolved through the country/flag helpers. */
  team?: string | null;
};

export type PlayerQuery = {
  providerId?: string | number | null;
  name?: string | null;
  team?: string | null;
};

export type PlayerResolution = {
  confidence: PlayerResolutionConfidence;
  referenceKey: string | null;
  /** True when the query matched more than one identity (never merged). */
  ambiguous: boolean;
  note?: string;
};

function idKey(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const text = String(value).trim().toLowerCase();
  return text === "" ? null : text;
}

/** Normalized name key: diacritics/punctuation-insensitive slug. */
export function playerNameKey(name: string | null | undefined): string | null {
  return normalizeSlug(name);
}

function teamKey(team: string | null | undefined): string | null {
  if (team == null || team.trim() === "") return null;
  return canonicalTeamKey(team, { fifaCode: team }) ?? normalizeSlug(team);
}

export type PlayerIdentityIndex = {
  byProviderId: Map<string, string>;
  /** name key → set of reference keys (>1 = ambiguous). */
  byName: Map<string, Set<string>>;
  /** name+team key → set of reference keys (>1 = ambiguous). */
  byNameTeam: Map<string, Set<string>>;
};

export function buildPlayerIdentityIndex(
  players: ReferencePlayer[],
): PlayerIdentityIndex {
  const index: PlayerIdentityIndex = {
    byProviderId: new Map(),
    byName: new Map(),
    byNameTeam: new Map(),
  };
  const addTo = (map: Map<string, Set<string>>, key: string | null, ref: string) => {
    if (key === null) return;
    const set = map.get(key) ?? new Set<string>();
    set.add(ref);
    map.set(key, set);
  };
  for (const player of players) {
    for (const id of player.providerIds ?? []) {
      const key = idKey(id);
      if (key !== null) index.byProviderId.set(key, player.key);
    }
    const nameKey = playerNameKey(player.name);
    addTo(index.byName, nameKey, player.key);
    const team = teamKey(player.team);
    if (nameKey !== null && team !== null) {
      addTo(index.byNameTeam, `${nameKey}::${team}`, player.key);
    }
  }
  return index;
}

/**
 * Resolves a provider player row.
 *   EXACT_PROVIDER_ID — provider id maps directly.
 *   EXACT_NAME_TEAM   — normalized name + team resolves to exactly one
 *                       identity (also used when only a name is given and it
 *                       is globally unique).
 *   UNRESOLVED        — no match, or any ambiguity. Ambiguous players are
 *                       flagged and never merged.
 */
export function resolvePlayer(
  index: PlayerIdentityIndex,
  query: PlayerQuery,
): PlayerResolution {
  const byId = index.byProviderId.get(idKey(query.providerId) ?? "");
  if (byId !== undefined) {
    return { confidence: "EXACT_PROVIDER_ID", referenceKey: byId, ambiguous: false };
  }

  const nameKey = playerNameKey(query.name);
  if (nameKey === null) {
    return { confidence: "UNRESOLVED", referenceKey: null, ambiguous: false };
  }

  const team = teamKey(query.team);
  if (team !== null) {
    const matches = index.byNameTeam.get(`${nameKey}::${team}`);
    if (matches !== undefined && matches.size === 1) {
      return {
        confidence: "EXACT_NAME_TEAM",
        referenceKey: [...matches][0],
        ambiguous: false,
      };
    }
    if (matches !== undefined && matches.size > 1) {
      return {
        confidence: "UNRESOLVED",
        referenceKey: null,
        ambiguous: true,
        note: `Name "${query.name ?? ""}" is ambiguous within team ${query.team ?? ""} — never merged.`,
      };
    }
    return { confidence: "UNRESOLVED", referenceKey: null, ambiguous: false };
  }

  // Team-less query: only a globally unique name may resolve.
  const byName = index.byName.get(nameKey);
  if (byName !== undefined && byName.size === 1) {
    return {
      confidence: "EXACT_NAME_TEAM",
      referenceKey: [...byName][0],
      ambiguous: false,
      note: "Matched by globally unique name (no team provided).",
    };
  }
  if (byName !== undefined && byName.size > 1) {
    return {
      confidence: "UNRESOLVED",
      referenceKey: null,
      ambiguous: true,
      note: `Name "${query.name ?? ""}" matches multiple identities — never merged.`,
    };
  }
  return { confidence: "UNRESOLVED", referenceKey: null, ambiguous: false };
}
