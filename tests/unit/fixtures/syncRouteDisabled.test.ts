// The cron/manual sync route in post-tournament archive mode: with
// FEATURE_2026_FIXTURE_SYNC unset it must acknowledge with 200
// { ok, disabled } and perform no work — and with the flag on, the existing
// CRON_SECRET protection must still gate the actual sync.

import { afterEach, describe, expect, it, vi } from "vitest";

const { syncFixtures2026 } = vi.hoisted(() => ({
  syncFixtures2026: vi.fn(),
}));

// The route imports the shared Prisma client and the sync orchestrator at
// module scope; both are stubbed so no database or provider is ever touched.
vi.mock("@/server/db/prisma", () => ({ prisma: {} }));
vi.mock("@/server/fixtures/sync", () => ({ syncFixtures2026 }));

import { GET, POST } from "@/app/api/cron/sync-2026-fixtures/route";

const ROUTE_URL = "http://localhost/api/cron/sync-2026-fixtures";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("sync route with the fixture sync flag off (archive mode)", () => {
  it("returns 200 disabled and calls no provider or database", async () => {
    vi.stubEnv("FEATURE_2026_FIXTURE_SYNC", undefined);
    vi.stubEnv("CRON_SECRET", "irrelevant");

    const response = await GET(new Request(ROUTE_URL));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      disabled: true,
      message:
        "2026 fixture sync is disabled because the tournament is in archive mode.",
    });
    expect(syncFixtures2026).not.toHaveBeenCalled();
  });

  it("does not fail a scheduled cron even without a secret configured", async () => {
    vi.stubEnv("FEATURE_2026_FIXTURE_SYNC", undefined);
    vi.stubEnv("CRON_SECRET", undefined);

    const response = await POST(new Request(ROUTE_URL));
    expect(response.status).toBe(200);
    expect(syncFixtures2026).not.toHaveBeenCalled();
  });
});

describe("sync route with the fixture sync flag on", () => {
  it("still rejects a missing/invalid secret with 401", async () => {
    vi.stubEnv("FEATURE_2026_FIXTURE_SYNC", "true");
    vi.stubEnv("CRON_SECRET", "test-secret");

    const response = await GET(new Request(ROUTE_URL));
    expect(response.status).toBe(401);
    expect(syncFixtures2026).not.toHaveBeenCalled();
  });

  it("runs the sync for a valid bearer secret", async () => {
    vi.stubEnv("FEATURE_2026_FIXTURE_SYNC", "true");
    vi.stubEnv("CRON_SECRET", "test-secret");
    syncFixtures2026.mockResolvedValueOnce({ mode: "openfootball-only" });

    const response = await GET(
      new Request(ROUTE_URL, {
        headers: { authorization: "Bearer test-secret" },
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(syncFixtures2026).toHaveBeenCalledTimes(1);
  });
});
