import { describe, expect, it } from "vitest";

import {
  coerceCell,
  parseProviderCsv,
  parseProviderJson,
  pickInt,
  pickString,
} from "../../../src/server/agents/worldcup2026/providers/tolerantCsv";

describe("coerceCell", () => {
  it("turns empty strings into null", () => {
    expect(coerceCell("")).toBeNull();
    expect(coerceCell("   ")).toBeNull();
    expect(coerceCell(null)).toBeNull();
    expect(coerceCell(undefined)).toBeNull();
  });
  it("converts numeric strings only when lossless", () => {
    expect(coerceCell("42")).toBe(42);
    expect(coerceCell("-3")).toBe(-3);
    expect(coerceCell("2.5")).toBe(2.5);
    expect(coerceCell("0")).toBe(0);
    // Id-like / zero-padded / trailing-zero values stay strings.
    expect(coerceCell("007")).toBe("007");
    expect(coerceCell("1.50")).toBe("1.50");
    expect(coerceCell("1e3")).toBe("1e3");
  });
  it("trims and keeps non-numeric text", () => {
    expect(coerceCell("  Spain ")).toBe("Spain");
  });
});

describe("parseProviderCsv", () => {
  const base = { sourceId: "test_source", sourceFile: "test.csv" };

  it("parses rows with coercion and preserves file + row number", () => {
    const result = parseProviderCsv({
      ...base,
      body: "team_id,name,goals\n1,Spain,7\n2,Argentina,\n",
    });
    expect(result.fileError).toBeNull();
    expect(result.columns).toEqual(["team_id", "name", "goals"]);
    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toMatchObject({
      sourceId: "test_source",
      sourceFile: "test.csv",
      sourceRowNumber: 1,
      parsed: { team_id: 1, name: "Spain", goals: 7 },
      parseStatus: "OK",
      warnings: [],
    });
    // Empty string → null.
    expect(result.records[1].parsed.goals).toBeNull();
    expect(result.records[1].sourceRowNumber).toBe(2);
  });

  it("keeps raw values alongside parsed values", () => {
    const result = parseProviderCsv({ ...base, body: "a,b\n01,x\n" });
    expect(result.records[0].raw).toMatchObject({ a: "01", b: "x" });
    expect(result.records[0].parsed).toMatchObject({ a: "01", b: "x" });
  });

  it("allows extra columns with a row-level warning", () => {
    const result = parseProviderCsv({
      ...base,
      body: "a,b\n1,2,unexpected\n",
    });
    expect(result.records[0].parseStatus).toBe("WARN");
    expect(result.records[0].warnings[0]).toContain("extra cells");
    expect(result.records[0].raw._extra).toEqual(["unexpected"]);
  });

  it("pads short rows with nulls and warns", () => {
    const result = parseProviderCsv({ ...base, body: "a,b,c\n1,2\n" });
    expect(result.records[0].parsed.c).toBeNull();
    expect(result.records[0].parseStatus).toBe("WARN");
  });

  it("keeps unusable rows as ERROR records instead of dropping them", () => {
    const result = parseProviderCsv({
      ...base,
      body: "id,name\n,,\n1,Spain\n",
      requiredColumns: ["id", "name"],
    });
    expect(result.records).toHaveLength(2);
    expect(result.records[0].parseStatus).toBe("ERROR");
    expect(result.records[0].warnings.join(" ")).toContain("unusable");
    expect(result.records[1].parseStatus).toBe("OK");
  });

  it("reports an empty document as a file error, not a crash", () => {
    const result = parseProviderCsv({ ...base, body: "" });
    expect(result.fileError).not.toBeNull();
    expect(result.records).toEqual([]);
  });
});

describe("parseProviderJson", () => {
  it("parses an array of objects into candidate records", () => {
    const result = parseProviderJson({
      sourceId: "test_source",
      sourceFile: "test.json",
      body: JSON.stringify([{ match_id: 1, note: "" }]),
    });
    expect(result.fileError).toBeNull();
    expect(result.records[0].parsed.match_id).toBe(1);
    expect(result.records[0].parsed.note).toBeNull();
  });
  it("keeps non-object entries as ERROR records", () => {
    const result = parseProviderJson({
      sourceId: "test_source",
      sourceFile: "test.json",
      body: JSON.stringify([{ ok: true }, "not-an-object"]),
    });
    expect(result.records[1].parseStatus).toBe("ERROR");
  });
  it("reports invalid JSON as a file error", () => {
    const result = parseProviderJson({
      sourceId: "test_source",
      sourceFile: "test.json",
      body: "{nope",
    });
    expect(result.fileError).toContain("Invalid JSON");
  });
});

describe("pickers", () => {
  it("pick the first non-null value among fallback keys", () => {
    expect(pickString({ b: "x" }, ["a", "b"])).toBe("x");
    expect(pickString({ a: 7 }, ["a"])).toBe("7");
    expect(pickString({}, ["a"])).toBeNull();
    expect(pickInt({ score: "3" }, ["score"])).toBe(3);
    expect(pickInt({ score: "3.5" }, ["score"])).toBeNull();
  });
});
