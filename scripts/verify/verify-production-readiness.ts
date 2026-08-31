// Production readiness preflight (Checkpoint 8C). Static, local-only checks
// that the repository is ready for deployment — no live services are
// contacted, no database required, safe to run anywhere.
//
// Usage: pnpm prod:preflight
//
// Output: PASS/WARN/FAIL report; exits non-zero only on FAIL. Internal
// identifiers (package name `worldcup-atlas`, DB name `worldcup_atlas`)
// are intentionally allowed and at most WARN.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/** Recursively collects files under `dir` whose basename matches `name`. */
function findFiles(dir: string, name: string): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...findFiles(full, name));
    } else if (entry === name) {
      found.push(full);
    }
  }
  return found;
}

type Level = "PASS" | "WARN" | "FAIL";
type Check = { level: Level; name: string; detail: string };
const checks: Check[] = [];

function pass(name: string, detail: string): void {
  checks.push({ level: "PASS", name, detail });
}
function warn(name: string, detail: string): void {
  checks.push({ level: "WARN", name, detail });
}
function fail(name: string, detail: string): void {
  checks.push({ level: "FAIL", name, detail });
}
function report(name: string, ok: boolean, detail: string): void {
  (ok ? pass : fail)(name, detail);
}

function read(file: string): string {
  return readFileSync(path.resolve(file), "utf8");
}

function main() {
  console.log("WORLDCUP Nexus — production readiness preflight\n");

  // 1. Required files -------------------------------------------------------
  const REQUIRED_FILES = [
    "docs/DEPLOYMENT.md",
    "docs/PRODUCTION_RUNBOOK.md",
    "docs/VERCEL_DEPLOYMENT.md",
    "docs/DATABASE_PRODUCTION.md",
    "docs/SEARCH_PRODUCTION.md",
    "docs/SECURITY_AUDIT.md",
    "docs/SECURITY_HARDENING_PLAN.md",
    "SECURITY.md",
    ".env.example",
    ".env.production.example",
    "prisma/schema.prisma",
    "prisma.config.ts",
    "next.config.ts",
  ];
  const missingFiles = REQUIRED_FILES.filter(
    (file) => !existsSync(path.resolve(file)),
  );
  report(
    "required files exist",
    missingFiles.length === 0,
    missingFiles.length === 0
      ? `${REQUIRED_FILES.length} files present`
      : `missing: ${missingFiles.join(", ")}`,
  );
  if (missingFiles.length > 0) return finish(); // later checks read these

  // 2. package.json scripts --------------------------------------------------
  const packageJson = JSON.parse(read("package.json")) as {
    scripts?: Record<string, string>;
  };
  const scripts = packageJson.scripts ?? {};
  const REQUIRED_SCRIPTS = [
    "build",
    "start",
    "db:generate",
    "db:deploy",
    "data:import",
    "search:index",
    "prod:preflight",
    "prod:validate",
    "security:verify",
    "public:verify",
    "export:verify",
    "search:verify",
    "data:verify",
    "data:verify:queries",
    "test:e2e",
  ];
  const missingScripts = REQUIRED_SCRIPTS.filter(
    (script) => scripts[script] === undefined,
  );
  report(
    "package.json has required scripts",
    missingScripts.length === 0,
    missingScripts.length === 0
      ? `${REQUIRED_SCRIPTS.length} scripts present`
      : `missing: ${missingScripts.join(", ")}`,
  );
  report(
    "db:deploy uses prisma migrate deploy",
    (scripts["db:deploy"] ?? "").includes("prisma migrate deploy"),
    scripts["db:deploy"] ?? "missing",
  );

  // 3. .gitignore -------------------------------------------------------------
  const gitignore = read(".gitignore");
  const GITIGNORE_RULES = [
    ".env",
    ".env.*",
    "!.env.example",
    "!.env.production.example",
    "/src/generated/",
    "data/sources/fjelstul/raw/*.csv",
  ];
  const missingRules = GITIGNORE_RULES.filter(
    (rule) => !gitignore.split(/\r?\n/).includes(rule),
  );
  report(
    ".gitignore protects env files, generated client, raw CSVs",
    missingRules.length === 0,
    missingRules.length === 0
      ? `${GITIGNORE_RULES.length} rules present`
      : `missing rules: ${missingRules.join(", ")}`,
  );

  // 4. Production env example variables ---------------------------------------
  const prodEnv = read(".env.production.example");
  // Search is Postgres-backed — no Meilisearch (or other search service)
  // variables are required anymore.
  const REQUIRED_ENV_VARS = ["DATABASE_URL", "DIRECT_URL", "NEXT_PUBLIC_SITE_URL"];
  const missingVars = REQUIRED_ENV_VARS.filter(
    (name) => !new RegExp(`^${name}=`, "m").test(prodEnv),
  );
  report(
    ".env.production.example documents required variables",
    missingVars.length === 0,
    missingVars.length === 0
      ? REQUIRED_ENV_VARS.join(", ")
      : `missing: ${missingVars.join(", ")}`,
  );

  // 5. Security headers in next.config.ts --------------------------------------
  const nextConfig = read("next.config.ts");
  const HEADER_MARKERS = [
    "X-Content-Type-Options",
    "Referrer-Policy",
    "X-Frame-Options",
    "Permissions-Policy",
    "Content-Security-Policy-Report-Only",
    "Strict-Transport-Security",
  ];
  const missingMarkers = HEADER_MARKERS.filter(
    (marker) => !nextConfig.includes(marker),
  );
  report(
    "next.config.ts configures security headers",
    nextConfig.includes("headers()") && missingMarkers.length === 0,
    missingMarkers.length === 0
      ? `${HEADER_MARKERS.length} header keys found`
      : `missing: ${missingMarkers.join(", ")}`,
  );

  // 6.–7. Public surface files --------------------------------------------------
  const SURFACE_FILES = [
    "src/app/sitemap.ts",
    "src/app/robots.ts",
    "src/app/sources/page.tsx",
    "src/app/about/page.tsx",
    "src/app/privacy/page.tsx",
  ];
  const missingSurface = SURFACE_FILES.filter(
    (file) => !existsSync(path.resolve(file)),
  );
  report(
    "sitemap/robots/sources/about/privacy exist",
    missingSurface.length === 0,
    missingSurface.length === 0
      ? `${SURFACE_FILES.length} files present`
      : `missing: ${missingSurface.join(", ")}`,
  );

  // 8. Old brand references in user-facing docs ----------------------------------
  // "WorldCup Atlas" / "World Cup Atlas" as a styled brand name must not
  // appear in user-facing docs. Internal identifiers (`worldcup-atlas`
  // package/container names, `worldcup_atlas` DB names) are allowed
  // and only warned about — they are documented as internal in DEPLOYMENT.md.
  const USER_FACING_DOCS = [
    "README.md",
    "SECURITY.md",
    "docs/DEPLOYMENT.md",
    "docs/PRODUCTION_RUNBOOK.md",
    "docs/VERCEL_DEPLOYMENT.md",
    "docs/DATABASE_PRODUCTION.md",
    "docs/SEARCH_PRODUCTION.md",
  ];
  const brandHits: string[] = [];
  const internalNameHits: string[] = [];
  for (const doc of USER_FACING_DOCS) {
    const text = read(doc);
    if (/world\s?cup atlas/i.test(text)) brandHits.push(doc);
    if (/worldcup[-_]atlas/i.test(text)) internalNameHits.push(doc);
  }
  report(
    "no old brand name in user-facing docs",
    brandHits.length === 0,
    brandHits.length === 0
      ? `${USER_FACING_DOCS.length} docs clean of "WorldCup Atlas"`
      : `found in: ${brandHits.join(", ")}`,
  );
  if (internalNameHits.length > 0) {
    warn(
      "internal worldcup-atlas/worldcup_atlas identifiers mentioned in docs",
      `${internalNameHits.join(", ")} — allowed (documented internal names: package, local DB, index uid)`,
    );
  }

  // 9.–10. No real-looking secrets in tracked env examples -------------------------
  for (const envFile of [".env.example", ".env.production.example"]) {
    const text = read(envFile);
    const suspicious: string[] = [];
    for (const line of text.split(/\r?\n/)) {
      const match = /^([A-Z0-9_]+)=["']?([^"']*)["']?\s*$/.exec(line.trim());
      if (!match) continue;
      const [, name, value] = match;
      if (value === "") continue;
      // Connection strings must point at localhost only.
      if (
        /^(postgres(ql)?|mysql|redis|https?):\/\//.test(value) &&
        !/localhost|127\.0\.0\.1|your-production-domain/.test(value)
      ) {
        suspicious.push(`${name} (non-local URL)`);
      }
      // Long high-entropy strings look like real tokens/keys.
      if (/^[A-Za-z0-9+/=_-]{40,}$/.test(value)) {
        suspicious.push(`${name} (token-like value)`);
      }
    }
    report(
      `${envFile} contains no real-looking secrets`,
      suspicious.length === 0,
      suspicious.length === 0
        ? "placeholders and localhost values only"
        : suspicious.join(", "),
    );
  }
  // Legacy search-service variables must not resurface in env templates —
  // search is Postgres-backed and needs no MEILISEARCH_* configuration.
  for (const envFile of [".env.example", ".env.production.example"]) {
    const text = read(envFile);
    report(
      `${envFile} has no legacy Meilisearch variables`,
      !/MEILISEARCH_/.test(text),
      /MEILISEARCH_/.test(text)
        ? "MEILISEARCH_* found — search is Postgres-backed, remove them"
        : "no MEILISEARCH_* variables",
    );
  }

  // 11. No `prisma migrate dev` as a production step --------------------------------
  const PRODUCTION_DOCS = [
    "docs/PRODUCTION_RUNBOOK.md",
    "docs/VERCEL_DEPLOYMENT.md",
    "docs/DATABASE_PRODUCTION.md",
  ];
  const migrateDevHits = PRODUCTION_DOCS.filter((doc) => {
    // Lines that *warn against* migrate dev (never/not/avoid/instead of)
    // are fine; a bare instruction is not.
    return read(doc)
      .split(/\r?\n/)
      .some(
        (line) =>
          line.includes("migrate dev") &&
          !/never|do not|don't|avoid|instead of|not `?prisma migrate dev/i.test(
            line,
          ),
      );
  });
  report(
    "production docs never instruct `prisma migrate dev`",
    migrateDevHits.length === 0,
    migrateDevHits.length === 0
      ? "only `prisma migrate deploy` (db:deploy) in production docs"
      : `unguarded mention in: ${migrateDevHits.join(", ")}`,
  );

  // 12. No public API route triggers import/indexing ---------------------------------
  const routeFiles = findFiles(path.resolve("src/app/api"), "route.ts");
  const DANGEROUS_PATTERNS = [
    "scripts/import",
    "import-fjelstul",
    "download-fjelstul",
    "build-index",
    "addDocuments",
    "updateSettings",
    "deleteIndex",
    "createIndex",
    "migrate",
  ];
  const offendingRoutes: string[] = [];
  for (const file of routeFiles) {
    const text = read(file);
    const hits = DANGEROUS_PATTERNS.filter((pattern) => text.includes(pattern));
    if (hits.length > 0) offendingRoutes.push(`${file} (${hits.join(", ")})`);
  }
  report(
    "no public API route can trigger import/indexing/migration",
    offendingRoutes.length === 0,
    offendingRoutes.length === 0
      ? `${routeFiles.length} route files scanned`
      : offendingRoutes.join("; "),
  );

  finish();
}

function finish(): void {
  console.log("Checks");
  let failures = 0;
  let warnings = 0;
  for (const { level, name, detail } of checks) {
    if (level === "FAIL") failures += 1;
    if (level === "WARN") warnings += 1;
    console.log(`  [${level}] ${name} — ${detail}`);
  }

  if (failures > 0) {
    console.error(
      `\n${failures} preflight check(s) FAILED (${warnings} warning(s)). Not ready to deploy.`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      `\nAll preflight checks passed${warnings > 0 ? ` with ${warnings} warning(s)` : ""}. Repo is deployment-ready.`,
    );
  }
}

main();
