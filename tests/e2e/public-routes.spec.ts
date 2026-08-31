// Smoke tests for the public surface (Checkpoint 7B). Requires the local
// database to be running — no external internet.

import { test, expect } from "@playwright/test";

const STATIC_ROUTES: { path: string; expectText: string | RegExp }[] = [
  { path: "/", expectText: "Explore the Complete History of the World Cup" },
  { path: "/tournaments", expectText: "World Cup Tournaments" },
  { path: "/matches", expectText: "World Cup Matches" },
  { path: "/countries", expectText: "World Cup Nations" },
  { path: "/players", expectText: "World Cup Players" },
  { path: "/records", expectText: "Book of Records" },
  { path: "/explorer", expectText: "Data Explorer" },
  { path: "/sources", expectText: "Data Sources" },
  { path: "/about", expectText: "About WORLDCUP Nexus" },
  { path: "/privacy", expectText: "Privacy" },
];

for (const route of STATIC_ROUTES) {
  test(`renders ${route.path}`, async ({ page }) => {
    const response = await page.goto(route.path);
    expect(response?.status()).toBe(200);
    await expect(
      page
        .getByRole("heading", { name: route.expectText, exact: false })
        .first(),
    ).toBeVisible();
    // Independence disclaimer is in the footer on every page.
    await expect(
      page.getByText("not affiliated with FIFA").first(),
    ).toBeVisible();
  });
}

test("health API responds", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.ok).toBe(true);
  expect(body.database).toBe("connected");
});

// Representative dynamic routes. Each asserts the index works first, so a
// slug drift fails with a clear signal instead of a mystery 404.
test("tournament detail renders (1986)", async ({ page }) => {
  await page.goto("/tournaments");
  await expect(
    page.getByRole("heading", { name: "World Cup Tournaments" }),
  ).toBeVisible();
  await page.goto("/tournaments/1986");
  // Vault dossier hero: the year is the h1; the full tournament name and the
  // champion panel render as supporting text.
  await expect(page.getByRole("heading", { name: "1986" })).toBeVisible();
  await expect(
    page.getByText("1986 FIFA Men's World Cup").first(),
  ).toBeVisible();
  await expect(page.getByText("Champion").first()).toBeVisible();
  await expect(page.getByText("Argentina").first()).toBeVisible();
});

test("match detail renders (1986 final)", async ({ page }) => {
  await page.goto("/matches/m-1986-52-argentina-vs-west-germany");
  await expect(page.getByText("3–2").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
});

test("country profile renders (Argentina)", async ({ page }) => {
  await page.goto("/countries/argentina");
  await expect(
    page.getByRole("heading", { name: "Argentina", exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "All-Time Record" }),
  ).toBeVisible();
});

test("player profile renders (Maradona)", async ({ page }) => {
  await page.goto("/players/diego-maradona");
  await expect(
    page.getByRole("heading", { name: "Diego Maradona", exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "World Cup Squads" }),
  ).toBeVisible();
});

test("unknown page shows not-found with 404 status", async ({ page }) => {
  const response = await page.goto("/this-page-does-not-exist");
  expect(response?.status()).toBe(404);
  await expect(page.getByText("Page not found")).toBeVisible();
});

test("explorer filters via URL params", async ({ page }) => {
  await page.goto("/explorer?eventType=Goal&tournamentYear=1986");
  await expect(page.getByText("132 rows").first()).toBeVisible();
});

// Checkpoint 8B hardening: baseline security headers on every response,
// Report-Only CSP (non-enforcing), and the rebranded export filename.
test("security headers are present", async ({ request }) => {
  const response = await request.get("/");
  expect(response.status()).toBe(200);
  const headers = response.headers();
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["permissions-policy"]).toContain("camera=()");
  expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
  expect(headers["cross-origin-resource-policy"]).toBe("same-origin");
  expect(headers["content-security-policy-report-only"]).toContain(
    "default-src 'self'",
  );
});

test("explorer export uses Nexus filename", async ({ request }) => {
  const response = await request.get(
    "/api/export/explorer?format=csv&eventType=Goal&tournamentYear=1986",
  );
  expect(response.status()).toBe(200);
  expect(response.headers()["content-disposition"]).toContain(
    "worldcup-nexus-explorer.csv",
  );
  expect(response.headers()["x-ratelimit-limit"]).toBeUndefined(); // only on 429
});

test("sitemap and robots respond", async ({ request }) => {
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toContain("Disallow: /api/");

  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  expect(await sitemap.text()).toContain("/tournaments/1986");
});
