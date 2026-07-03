// Shared entity-slug → id resolution for FactRelation rows. Used by both the
// hand-curated starter seed (seed-starter-facts.ts) and the data-template
// generator (generate-fact-candidates.ts) so the two never drift.

import type { ScriptPrismaClient } from "../../import/utils/db";
import type { FactRelationEntityType } from "../../../src/generated/prisma/enums";

/** Resolve an entity id from its slug for relation types that have one. */
export async function resolveEntityId(
  prisma: ScriptPrismaClient,
  entityType: FactRelationEntityType,
  slug: string | undefined,
): Promise<string | null> {
  if (slug === undefined) return null;
  switch (entityType) {
    case "PLAYER": {
      const row = await prisma.player.findUnique({ where: { slug } });
      return row?.id ?? null;
    }
    case "COUNTRY": {
      const row = await prisma.country.findUnique({ where: { slug } });
      return row?.id ?? null;
    }
    case "TOURNAMENT": {
      const row = await prisma.tournament.findUnique({ where: { slug } });
      return row?.id ?? null;
    }
    case "MATCH": {
      const row = await prisma.match.findUnique({ where: { slug } });
      return row?.id ?? null;
    }
    default:
      return null;
  }
}
