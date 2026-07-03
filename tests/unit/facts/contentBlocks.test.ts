import { describe, expect, it } from "vitest";
import { parseContentBlocks } from "../../../src/server/facts/types";

describe("parseContentBlocks", () => {
  it("returns an empty array for non-array input", () => {
    expect(parseContentBlocks(undefined)).toEqual([]);
    expect(parseContentBlocks(null)).toEqual([]);
    expect(parseContentBlocks("not an array")).toEqual([]);
    expect(parseContentBlocks({ type: "paragraph" })).toEqual([]);
  });

  it("keeps valid blocks of every known type", () => {
    const blocks = parseContentBlocks([
      { type: "heading", text: "Title" },
      { type: "paragraph", text: "Body copy." },
      { type: "callout", text: "Heads up.", variant: "gold" },
      { type: "source_note", text: "See sources." },
    ]);
    expect(blocks).toHaveLength(4);
    expect(blocks.map((block) => block.type)).toEqual([
      "heading",
      "paragraph",
      "callout",
      "source_note",
    ]);
  });

  it("silently drops unknown block types instead of throwing", () => {
    const blocks = parseContentBlocks([
      { type: "paragraph", text: "Kept." },
      { type: "some_future_block", text: "Dropped." },
      { type: "heading", text: "Also kept." },
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks.map((block) => block.type)).toEqual(["paragraph", "heading"]);
  });

  it("drops a block that matches a known type but fails its shape", () => {
    // stat_grid requires at least one item.
    const blocks = parseContentBlocks([{ type: "stat_grid", items: [] }]);
    expect(blocks).toEqual([]);
  });

  it("parses list-shaped blocks", () => {
    const blocks = parseContentBlocks([
      {
        type: "stat_grid",
        items: [{ label: "Titles", value: "5" }],
      },
      {
        type: "timeline",
        items: [{ year: 1930, label: "First tournament" }],
      },
    ]);
    expect(blocks).toHaveLength(2);
  });

  it("keeps a well-formed quiz block", () => {
    const blocks = parseContentBlocks([
      {
        type: "quiz",
        question: "Who won the 1930 World Cup?",
        options: ["Argentina", "Uruguay"],
        correctIndex: 1,
        explanation: "Uruguay beat Argentina 4-2 in the first ever final.",
      },
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("quiz");
  });

  it("drops a quiz block whose correctIndex doesn't reference an option", () => {
    const blocks = parseContentBlocks([
      {
        type: "quiz",
        question: "Who won the 1930 World Cup?",
        options: ["Argentina", "Uruguay"],
        correctIndex: 2,
      },
    ]);
    expect(blocks).toEqual([]);
  });

  it("drops a quiz block with fewer than two options", () => {
    const blocks = parseContentBlocks([
      {
        type: "quiz",
        question: "Who won the 1930 World Cup?",
        options: ["Uruguay"],
        correctIndex: 0,
      },
    ]);
    expect(blocks).toEqual([]);
  });
});
