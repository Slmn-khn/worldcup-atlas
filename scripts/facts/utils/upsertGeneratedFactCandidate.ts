// Shared safe-upsert for machine-generated fact candidates. Used by both
// generate-fact-candidates.ts (deterministic templates) and
// draft-ai-fact-candidates.ts (AI-assisted drafts) so the two writers can
// never drift on the protection/idempotency rules.
//
// Safety rules (see docs/DISCOVERY_VAULT.md):
// - Every candidate is written with status = NEEDS_REVIEW, never PUBLISHED —
//   regardless of how confident the underlying numbers are.
// - Never touches a Fact whose status is not NEEDS_REVIEW. Once a human has
//   reviewed a generated candidate (published it, archived it, rejected it,
//   or started hand-editing it as a DRAFT), re-running a generator must
//   never silently overwrite that decision.

import type { ScriptPrismaClient } from "../../import/utils/db";
import type { GeneratedFactCandidate } from "../../../src/server/facts/generator";
import { resolveEntityId } from "./resolveEntityId";

export type UpsertSummary = {
  created: number;
  updated: number;
  protectedSkipped: number;
  relationsResolved: number;
};

export function createUpsertSummary(): UpsertSummary {
  return { created: 0, updated: 0, protectedSkipped: 0, relationsResolved: 0 };
}

/** Statuses a human may have moved a candidate to — never touched again. */
const PROTECTED_STATUSES = new Set(["PUBLISHED", "ARCHIVED", "REJECTED", "DRAFT"]);

export async function upsertGeneratedFactCandidate(
  prisma: ScriptPrismaClient,
  candidate: GeneratedFactCandidate,
  summary: UpsertSummary,
): Promise<void> {
  const existing = await prisma.fact.findUnique({
    where: { slug: candidate.slug },
    select: { id: true, status: true },
  });

  if (existing !== null && PROTECTED_STATUSES.has(existing.status)) {
    summary.protectedSkipped += 1;
    console.log(`[SKIP] ${candidate.slug} — already ${existing.status}, left untouched`);
    return;
  }

  const factData = {
    title: candidate.title,
    summary: candidate.summary,
    category: candidate.category,
    difficulty: candidate.difficulty,
    status: "NEEDS_REVIEW",
    verificationStatus: "DB_VERIFIED",
    eraStartYear: candidate.eraStartYear,
    eraEndYear: candidate.eraEndYear,
    readTimeMinutes: candidate.readTimeMinutes,
    contentBlocks: candidate.contentBlocks,
    tags: candidate.tags,
    publishedAt: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  const saved = existing
    ? await prisma.fact.update({ where: { id: existing.id }, data: factData })
    : await prisma.fact.create({ data: { slug: candidate.slug, ...factData } });

  await prisma.factSource.deleteMany({ where: { factId: saved.id } });
  await prisma.factSource.createMany({
    data: candidate.sources.map((source) => ({
      factId: saved.id,
      label: source.label,
      sourceType: source.sourceType,
      notes: source.notes ?? null,
    })),
  });

  await prisma.factRelation.deleteMany({ where: { factId: saved.id } });
  for (const relation of candidate.relations) {
    const entityId = await resolveEntityId(prisma, relation.entityType, relation.entitySlug);
    if (entityId !== null) summary.relationsResolved += 1;
    await prisma.factRelation.create({
      data: {
        factId: saved.id,
        entityType: relation.entityType,
        entityId,
        entitySlug: relation.entitySlug ?? null,
        entityLabel: relation.entityLabel ?? null,
        relationType: relation.relationType ?? "RELATED",
      },
    });
  }

  if (existing) {
    summary.updated += 1;
    console.log(`[UPDATE] ${candidate.slug} (${candidate.templateId})`);
  } else {
    summary.created += 1;
    console.log(`[CREATE] ${candidate.slug} (${candidate.templateId})`);
  }
}
