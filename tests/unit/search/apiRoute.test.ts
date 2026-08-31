// /api/search route behavior with the search module mocked — asserts the
// response contract without a database, and that no Meilisearch client or
// configuration remains anywhere in the search path.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { searchDocumentsMock } = vi.hoisted(() => ({
  searchDocumentsMock: vi.fn(),
}));

vi.mock("@/server/search/postgresSearch", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/server/search/postgresSearch")
    >();
  return { ...actual, searchDocuments: searchDocumentsMock };
});

import { GET } from "@/app/api/search/route";

function request(query: string): Request {
  return new Request(`http://localhost:3000/api/search${query}`, {
    // Unique IP per test run keeps the in-memory rate limiter out of the way.
    headers: { "x-forwarded-for": `10.0.${Math.floor(Math.random() * 255)}.7` },
  });
}

beforeEach(() => {
  searchDocumentsMock.mockReset();
});

describe("GET /api/search", () => {
  it("returns empty results for a missing query without touching the DB", async () => {
    const response = await GET(request(""));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ query: "", count: 0, results: [] });
    expect(searchDocumentsMock).not.toHaveBeenCalled();
  });

  it("returns empty results for a too-short query", async () => {
    const response = await GET(request("?q=a"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      query: "a",
      count: 0,
      results: [],
    });
    expect(searchDocumentsMock).not.toHaveBeenCalled();
  });

  it("returns { query, count, results } for a real query", async () => {
    const results = [
      {
        id: "1",
        entityType: "player",
        entityId: "player-1",
        title: "Diego Maradona",
        subtitle: "Argentina · MF",
        url: "/players/diego-maradona",
        year: null,
        countryCode: null,
        imageUrl: null,
        source: "fjelstul",
        score: 2.5,
      },
    ];
    searchDocumentsMock.mockResolvedValue(results);

    const response = await GET(request("?q=maradona&type=player&year=1986"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      query: "maradona",
      count: 1,
      results,
    });
    expect(searchDocumentsMock).toHaveBeenCalledWith({
      query: "maradona",
      limit: undefined,
      year: 1986,
      entityTypes: ["player"],
    });
  });

  it("answers 503 with a generic message when search fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    searchDocumentsMock.mockRejectedValue(
      new Error("connect ECONNREFUSED db.internal:5432"),
    );
    const response = await GET(request("?q=maradona"));
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/temporarily unavailable/i);
    expect(JSON.stringify(body)).not.toContain("db.internal");
    vi.restoreAllMocks();
  });
});

describe("Meilisearch is fully removed", () => {
  const root = path.resolve(__dirname, "../../..");

  it("package.json has no meilisearch dependency", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain("meilisearch");
    expect(Object.keys(pkg.devDependencies ?? {})).not.toContain("meilisearch");
  });

  it("no search module or route imports meilisearch", () => {
    const files = [
      path.join(root, "src/app/api/search/route.ts"),
      ...readdirSync(path.join(root, "src/server/search")).map((name) =>
        path.join(root, "src/server/search", name),
      ),
      ...readdirSync(path.join(root, "scripts/search")).map((name) =>
        path.join(root, "scripts/search", name),
      ),
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file} must not import meilisearch`).not.toMatch(
        /from ["']meilisearch["']|require\(["']meilisearch["']\)/,
      );
    }
  });

  it("env templates carry no MEILISEARCH_* variables", () => {
    for (const envFile of [".env.example", ".env.production.example"]) {
      const text = readFileSync(path.join(root, envFile), "utf8");
      expect(text, `${envFile} must not define MEILISEARCH_*`).not.toMatch(
        /MEILISEARCH_/,
      );
    }
  });
});
