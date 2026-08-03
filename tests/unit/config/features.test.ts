import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isFixtureSyncEnabled,
  isLatestMatchesSectionEnabled,
  isPostTournamentArchiveMode,
} from "@/config/features";

// Flags read process.env at call time, so stubbing per test is enough.
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isLatestMatchesSectionEnabled", () => {
  it("defaults to false when the env var is missing", () => {
    vi.stubEnv("FEATURE_LATEST_MATCHES_SECTION", undefined);
    expect(isLatestMatchesSectionEnabled()).toBe(false);
  });

  it('is true only for the exact string "true"', () => {
    vi.stubEnv("FEATURE_LATEST_MATCHES_SECTION", "true");
    expect(isLatestMatchesSectionEnabled()).toBe(true);

    for (const value of ["", "TRUE", "1", "yes", "false"]) {
      vi.stubEnv("FEATURE_LATEST_MATCHES_SECTION", value);
      expect(isLatestMatchesSectionEnabled()).toBe(false);
    }
  });
});

describe("isFixtureSyncEnabled", () => {
  it("defaults to false when the env var is missing", () => {
    vi.stubEnv("FEATURE_2026_FIXTURE_SYNC", undefined);
    expect(isFixtureSyncEnabled()).toBe(false);
  });

  it('is true only for the exact string "true"', () => {
    vi.stubEnv("FEATURE_2026_FIXTURE_SYNC", "true");
    expect(isFixtureSyncEnabled()).toBe(true);

    for (const value of ["", "TRUE", "1", "yes", "false"]) {
      vi.stubEnv("FEATURE_2026_FIXTURE_SYNC", value);
      expect(isFixtureSyncEnabled()).toBe(false);
    }
  });
});

describe("isPostTournamentArchiveMode", () => {
  it("defaults to true when the env var is missing", () => {
    vi.stubEnv("FEATURE_2026_ARCHIVE_MODE", undefined);
    expect(isPostTournamentArchiveMode()).toBe(true);
  });

  it('is false only for the exact string "false"', () => {
    vi.stubEnv("FEATURE_2026_ARCHIVE_MODE", "false");
    expect(isPostTournamentArchiveMode()).toBe(false);

    for (const value of ["", "true", "FALSE", "0", "no"]) {
      vi.stubEnv("FEATURE_2026_ARCHIVE_MODE", value);
      expect(isPostTournamentArchiveMode()).toBe(true);
    }
  });
});
