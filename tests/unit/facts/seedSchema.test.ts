import { describe, expect, it } from "vitest";
import { factSeedSchema } from "../../../src/server/facts/seedSchema";

function baseFact(overrides: Record<string, unknown> = {}) {
  return {
    slug: "a-valid-fact",
    title: "A Valid Fact",
    summary: "A short, honest summary.",
    category: "HISTORY",
    difficulty: "CASUAL",
    status: "DRAFT",
    verificationStatus: "UNVERIFIED",
    readTimeMinutes: 2,
    contentBlocks: [{ type: "paragraph", text: "Some body copy." }],
    tags: ["example"],
    sources: [
      { label: "Some source", sourceType: "OTHER", notes: "A note backing this up." },
    ],
    relations: [],
    ...overrides,
  };
}

describe("factSeedSchema", () => {
  it("accepts a well-formed draft record", () => {
    const result = factSeedSchema.safeParse(baseFact());
    expect(result.success).toBe(true);
  });

  it("rejects a fact with no sources", () => {
    const result = factSeedSchema.safeParse(baseFact({ sources: [] }));
    expect(result.success).toBe(false);
  });

  it("rejects a source with neither a url nor notes", () => {
    const result = factSeedSchema.safeParse(
      baseFact({ sources: [{ label: "Unbacked source", sourceType: "OTHER" }] }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts a source backed by only a url or only notes", () => {
    expect(
      factSeedSchema.safeParse(
        baseFact({
          sources: [
            { label: "Has url", sourceType: "OTHER", url: "https://example.com/a" },
          ],
        }),
      ).success,
    ).toBe(true);
    expect(
      factSeedSchema.safeParse(
        baseFact({
          sources: [{ label: "Has notes", sourceType: "OTHER", notes: "Trust me." }],
        }),
      ).success,
    ).toBe(true);
  });

  it("rejects PUBLISHED status without a verified verificationStatus", () => {
    const result = factSeedSchema.safeParse(
      baseFact({ status: "PUBLISHED", verificationStatus: "UNVERIFIED" }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts PUBLISHED status once verificationStatus is verified", () => {
    for (const verificationStatus of [
      "DB_VERIFIED",
      "SOURCE_VERIFIED",
      "MANUALLY_VERIFIED",
    ]) {
      const result = factSeedSchema.safeParse(
        baseFact({ status: "PUBLISHED", verificationStatus }),
      );
      expect(result.success).toBe(true);
    }
  });

  it("allows NEEDS_REVIEW status regardless of verificationStatus", () => {
    const result = factSeedSchema.safeParse(
      baseFact({ status: "NEEDS_REVIEW", verificationStatus: "UNVERIFIED" }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects a slug that isn't lowercase kebab-case", () => {
    expect(factSeedSchema.safeParse(baseFact({ slug: "Not Kebab Case" })).success).toBe(
      false,
    );
    expect(factSeedSchema.safeParse(baseFact({ slug: "UPPER-CASE" })).success).toBe(
      false,
    );
  });
});
