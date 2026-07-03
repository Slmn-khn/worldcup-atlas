// Seed conservative starter facts from data/facts/starter-facts.json.
//
// Safety rules (see docs/DISCOVERY_VAULT.md):
// - Every record is validated with Zod (src/server/facts/seedSchema.ts); an
//   invalid record is skipped (with the exact issues logged), never imported
//   half-formed.
// - A fact without at least one source is refused by the schema itself.
// - A fact cannot be seeded as PUBLISHED unless verificationStatus is
//   DB_VERIFIED, SOURCE_VERIFIED, or MANUALLY_VERIFIED (enforced by the
//   schema) — anything less certain must ship as DRAFT/NEEDS_REVIEW.
// - Upsert-safe by slug: re-running replaces a fact's sources/relations
//   in place rather than accumulating duplicates.
// - Never publishes anything itself — status/verificationStatus come from the
//   data file only.

import "dotenv/config";

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createScriptPrismaClient } from "../import/utils/db";
import type { ScriptPrismaClient } from "../import/utils/db";
import { factSeedSchema, type FactSeedRecord } from "../../src/server/facts/seedSchema";
import { resolveEntityId } from "./utils/resolveEntityId";

const DATA_FILE = resolve(process.cwd(), "data", "facts", "starter-facts.json");

type Summary = {
  recordsRead: number;
  created: number;
  updated: number;
  skipped: number;
  relationsResolved: number;
};

async function seedFact(
  prisma: ScriptPrismaClient,
  fact: FactSeedRecord,
  summary: Summary,
): Promise<void> {
  const existing = await prisma.fact.findUnique({ where: { slug: fact.slug } });

  const factData = {
    slug: fact.slug,
    title: fact.title,
    summary: fact.summary,
    category: fact.category,
    difficulty: fact.difficulty,
    status: fact.status,
    verificationStatus: fact.verificationStatus,
    eraStartYear: fact.eraStartYear ?? null,
    eraEndYear: fact.eraEndYear ?? null,
    readTimeMinutes: fact.readTimeMinutes,
    contentBlocks: fact.contentBlocks,
    tags: fact.tags,
    publishedAt:
      fact.status === "PUBLISHED" ? (existing?.publishedAt ?? new Date()) : null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  const saved = existing
    ? await prisma.fact.update({ where: { id: existing.id }, data: factData })
    : await prisma.fact.create({ data: factData });

  // Replace sources and relations in place — the seed file is the source of
  // truth for a starter fact's supporting evidence, not an incremental patch.
  await prisma.factSource.deleteMany({ where: { factId: saved.id } });
  await prisma.factSource.createMany({
    data: fact.sources.map((source) => ({
      factId: saved.id,
      label: source.label,
      sourceType: source.sourceType,
      url: source.url ?? null,
      notes: source.notes ?? null,
    })),
  });

  await prisma.factRelation.deleteMany({ where: { factId: saved.id } });
  for (const relation of fact.relations) {
    const entityId = await resolveEntityId(
      prisma,
      relation.entityType,
      relation.entitySlug,
    );
    if (entityId !== null) summary.relationsResolved += 1;
    await prisma.factRelation.create({
      data: {
        factId: saved.id,
        entityType: relation.entityType,
        entityId,
        entitySlug: relation.entitySlug ?? null,
        entityLabel: relation.entityLabel ?? null,
        relationType: relation.relationType,
      },
    });
  }

  if (existing) {
    summary.updated += 1;
    console.log(`[UPDATE] ${fact.slug} (${fact.status})`);
  } else {
    summary.created += 1;
    console.log(`[CREATE] ${fact.slug} (${fact.status})`);
  }
}

async function main() {
  console.log("WORLDCUP Nexus — Discovery Vault starter facts seed\n");

  if (!existsSync(DATA_FILE)) {
    console.log(
      "No data/facts/starter-facts.json found. Nothing to seed — exiting.",
    );
    return;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(DATA_FILE, "utf8"));
  } catch (error) {
    console.error(
      "Failed to parse starter-facts.json:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
    return;
  }

  if (!Array.isArray(raw)) {
    console.error("starter-facts.json must be a JSON array. Nothing seeded.");
    process.exitCode = 1;
    return;
  }

  if (raw.length === 0) {
    console.log("starter-facts.json is empty ([]). Nothing to seed — exiting.");
    return;
  }

  const prisma = createScriptPrismaClient();
  const summary: Summary = {
    recordsRead: raw.length,
    created: 0,
    updated: 0,
    skipped: 0,
    relationsResolved: 0,
  };

  try {
    for (let i = 0; i < raw.length; i += 1) {
      const parsed = factSeedSchema.safeParse(raw[i]);
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("; ");
        console.log(`[SKIP] record #${i} — invalid: ${issues}`);
        summary.skipped += 1;
        continue;
      }
      await seedFact(prisma, parsed.data, summary);
    }

    console.log(
      "\nDone.\n" +
        `  recordsRead:       ${summary.recordsRead}\n` +
        `  created:           ${summary.created}\n` +
        `  updated:           ${summary.updated}\n` +
        `  skipped:           ${summary.skipped}\n` +
        `  relationsResolved: ${summary.relationsResolved}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("\nSeed failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
