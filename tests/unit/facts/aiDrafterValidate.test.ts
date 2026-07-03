import { describe, expect, it } from "vitest";
import {
  extractNumbers,
  extractNumericClaims,
  getAllowedNumbers,
  validateDraftNumbers,
} from "../../../src/server/facts/aiDrafter/validate";
import type { AiDraftFact, AiDraftedText } from "../../../src/server/facts/aiDrafter/types";

function draft(overrides: Partial<AiDraftedText> = {}): AiDraftedText {
  return {
    title: "Title",
    summary: "Summary",
    paragraph: "Paragraph",
    ...overrides,
  };
}

describe("extractNumbers", () => {
  it("returns a numeric value as itself", () => {
    expect(extractNumbers(16)).toEqual([16]);
  });

  it("extracts every digit run from a string, in order", () => {
    expect(extractNumbers("2002–2014")).toEqual([2002, 2014]);
  });

  it("returns an empty array when a string has no digits", () => {
    expect(extractNumbers("Miroslav Klose")).toEqual([]);
  });
});

describe("getAllowedNumbers", () => {
  it("collects numbers from both numeric and string fact values", () => {
    const facts: AiDraftFact[] = [
      { label: "Player", value: "Miroslav Klose" },
      { label: "Goals", value: 16 },
      { label: "Era", value: "2002–2014" },
    ];
    expect(getAllowedNumbers(facts)).toEqual(new Set([16, 2002, 2014]));
  });
});

describe("extractNumericClaims", () => {
  it("finds every digit sequence across a full text", () => {
    expect(extractNumericClaims("Klose scored 16 goals between 2002 and 2014.")).toEqual([
      16, 2002, 2014,
    ]);
  });
});

describe("validateDraftNumbers", () => {
  const facts: AiDraftFact[] = [
    { label: "Player", value: "Miroslav Klose" },
    { label: "Goals", value: 16 },
    { label: "Archive rank", value: 1 },
    { label: "Era", value: "2002–2014" },
  ];

  it("passes when every stated number is in the fact list", () => {
    const result = validateDraftNumbers(
      draft({
        title: "Miroslav Klose — 16 Goals",
        summary: "Klose is #1 on the archive's all-time scorer list.",
        paragraph: "Between 2002 and 2014, Klose scored 16 World Cup goals.",
      }),
      facts,
    );
    expect(result.valid).toBe(true);
    expect(result.invalidNumbers).toEqual([]);
  });

  it("fails when the draft states a number absent from the facts", () => {
    const result = validateDraftNumbers(
      draft({ paragraph: "Klose scored 16 goals across 4 tournaments." }),
      facts,
    );
    expect(result.valid).toBe(false);
    expect(result.invalidNumbers).toEqual([4]);
  });

  it("fails on a plausible-looking but unsupported rounded/derived number", () => {
    const result = validateDraftNumbers(
      draft({ summary: "Klose averaged roughly 4 goals per tournament." }),
      facts,
    );
    expect(result.valid).toBe(false);
    expect(result.invalidNumbers).toContain(4);
  });

  it("checks all three fields, not just one", () => {
    const failingInTitle = validateDraftNumbers(draft({ title: "Klose — 99 Goals" }), facts);
    const failingInSummary = validateDraftNumbers(draft({ summary: "Ranked 99th" }), facts);
    expect(failingInTitle.valid).toBe(false);
    expect(failingInSummary.valid).toBe(false);
  });

  it("does not flag numbers that only appear as part of a larger allowed number", () => {
    // "2002" is allowed via the era string; a draft that just repeats it back
    // (not a substring match against "0" or "02") must still pass.
    const result = validateDraftNumbers(draft({ paragraph: "He debuted in 2002." }), facts);
    expect(result.valid).toBe(true);
  });
});
