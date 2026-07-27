import { describe, expect, it } from "vitest";

import { parseBustamiFile } from "../../../src/server/agents/worldcup2026/providers/bustamiEfiDataset";
import { parseMominulFile } from "../../../src/server/agents/worldcup2026/providers/mominulDataset";

describe("parseMominulFile", () => {
  it("parses teams.csv rows with numeric coercion and null for empties", () => {
    const result = parseMominulFile(
      "teams.csv",
      "team_id,team_name,fifa_code,group_name\n1,Spain,ESP,Group E\n2,Argentina,ARG,\n",
    );
    expect(result.fileError).toBeNull();
    expect(result.records).toHaveLength(2);
    expect(result.records[0].parsed).toMatchObject({
      team_id: 1,
      team_name: "Spain",
      fifa_code: "ESP",
    });
    expect(result.records[1].parsed.group_name).toBeNull();
    expect(result.records[1].sourceFile).toBe("teams.csv");
    expect(result.records[1].sourceRowNumber).toBe(2);
  });

  it("keeps malformed matches.csv rows as flagged records", () => {
    const result = parseMominulFile(
      "matches.csv",
      "match_id,home_team,away_team,home_score,away_score\n" +
        "104,Spain,Argentina,2,1\n" +
        ",,,,\n",
    );
    expect(result.records).toHaveLength(2);
    expect(result.records[0].parseStatus).toBe("OK");
    expect(result.records[1].parseStatus).toBe("ERROR");
  });

  it("parses real_match_details.json through the JSON path", () => {
    const result = parseMominulFile(
      "real_match_details.json",
      JSON.stringify([{ match_id: "104", attendance: 87000 }]),
    );
    expect(result.records[0].parsed.attendance).toBe(87000);
  });

  it("tolerates unknown headers (no required columns → no ERROR storm)", () => {
    const result = parseMominulFile(
      "teams.csv",
      "totally,different,headers\nx,y,z\n",
    );
    expect(result.records[0].parseStatus).toBe("OK");
  });
});

describe("parseBustamiFile", () => {
  it("parses wc2026_efi.csv with extra metric columns allowed", () => {
    const result = parseBustamiFile(
      "wc2026_efi.csv",
      "match_id,player_id,player_name,team,xg,pressures,line_breaks\n" +
        "400123,7001,Lamine Yamal,ESP,0.8,22,14\n",
    );
    expect(result.fileError).toBeNull();
    expect(result.columns).toContain("line_breaks");
    expect(result.records[0].parsed).toMatchObject({
      match_id: 400123,
      player_id: 7001,
      player_name: "Lamine Yamal",
      xg: 0.8,
    });
  });

  it("flags rows missing every required id as ERROR without failing the file", () => {
    const result = parseBustamiFile(
      "wc2026_matches.csv",
      "match_id,home,away\n400123,Spain,Argentina\n,,\n",
    );
    expect(result.records).toHaveLength(2);
    expect(result.records[0].parseStatus).toBe("OK");
    expect(result.records[1].parseStatus).toBe("ERROR");
  });
});
