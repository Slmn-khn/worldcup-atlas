import { describe, expect, it } from "vitest";

import {
  buildPlayerIdentityIndex,
  resolvePlayer,
  type ReferencePlayer,
} from "../../../src/server/agents/worldcup2026/playerIdentity";

const PLAYERS: ReferencePlayer[] = [
  { key: "p1", providerIds: ["7001"], name: "Lamine Yamal", team: "ESP" },
  { key: "p2", providerIds: ["7002"], name: "João Silva", team: "POR" },
  // Two distinct players sharing a name within the same team → ambiguous.
  { key: "p3", providerIds: ["7003"], name: "James Smith", team: "ENG" },
  { key: "p4", providerIds: ["7004"], name: "James Smith", team: "ENG" },
];

const index = buildPlayerIdentityIndex(PLAYERS);

describe("resolvePlayer", () => {
  it("resolves by provider id first", () => {
    expect(resolvePlayer(index, { providerId: 7001 })).toMatchObject({
      confidence: "EXACT_PROVIDER_ID",
      referenceKey: "p1",
      ambiguous: false,
    });
  });

  it("resolves by name + team, diacritics-insensitively", () => {
    expect(
      resolvePlayer(index, { name: "Joao Silva", team: "POR" }),
    ).toMatchObject({ confidence: "EXACT_NAME_TEAM", referenceKey: "p2" });
  });

  it("marks same-name-same-team players as ambiguous and never merges", () => {
    const result = resolvePlayer(index, { name: "James Smith", team: "ENG" });
    expect(result.confidence).toBe("UNRESOLVED");
    expect(result.referenceKey).toBeNull();
    expect(result.ambiguous).toBe(true);
  });

  it("resolves a globally unique name without a team", () => {
    expect(resolvePlayer(index, { name: "Lamine Yamal" })).toMatchObject({
      confidence: "EXACT_NAME_TEAM",
      referenceKey: "p1",
    });
  });

  it("marks a team-less duplicate name as ambiguous", () => {
    const result = resolvePlayer(index, { name: "James Smith" });
    expect(result.confidence).toBe("UNRESOLVED");
    expect(result.ambiguous).toBe(true);
  });

  it("returns UNRESOLVED (not ambiguous) for unknown players", () => {
    const result = resolvePlayer(index, { name: "Unknown Player", team: "ESP" });
    expect(result.confidence).toBe("UNRESOLVED");
    expect(result.ambiguous).toBe(false);
  });
});
