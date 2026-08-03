import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// Unit tests only — Playwright owns tests/e2e (those are .spec.ts and would
// fail under Vitest). Keep these to pure, dependency-light functions. The "@"
// alias mirrors tsconfig paths so route/module tests can resolve app imports.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(rootDir, "src") },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
