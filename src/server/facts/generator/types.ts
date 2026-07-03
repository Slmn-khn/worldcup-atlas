// Types shared by the data-template fact generator. Pure — no Prisma import
// — so src/server/facts/generator/format.ts (which builds candidates from
// these shapes) can be unit tested without a database. The DB-touching query
// layer (./queries.ts) fetches rows into these plain shapes before handing
// them to the builders in format.ts.

import type {
  FactCategory,
  FactDifficulty,
  FactRelationEntityType,
  FactRelationType,
  FactSourceType,
} from "@/generated/prisma/enums";
import type { FactContentBlock } from "@/server/facts/types";

export type FactTemplateId =
  | "top-scorers"
  | "squad-selections"
  | "biggest-wins"
  | "highest-scoring-matches"
  | "host-winners"
  | "penalty-shootouts"
  | "final-scores";

export type GeneratedFactSourceInput = {
  label: string;
  sourceType: FactSourceType;
  notes: string;
};

export type GeneratedFactRelationInput = {
  entityType: FactRelationEntityType;
  entitySlug?: string;
  entityLabel?: string;
  relationType?: FactRelationType;
};

/**
 * One machine-generated fact candidate. Always lands as
 * `status: NEEDS_REVIEW` regardless of how confident the numbers are — see
 * scripts/facts/generate-fact-candidates.ts. `verificationStatus` is
 * `DB_VERIFIED` because the values themselves are computed directly from our
 * own database; NEEDS_REVIEW is about the generated prose, not the numbers.
 */
export type GeneratedFactCandidate = {
  slug: string;
  title: string;
  summary: string;
  category: FactCategory;
  difficulty: FactDifficulty;
  eraStartYear: number | null;
  eraEndYear: number | null;
  readTimeMinutes: number;
  tags: string[];
  contentBlocks: FactContentBlock[];
  relations: GeneratedFactRelationInput[];
  sources: GeneratedFactSourceInput[];
  templateId: FactTemplateId;
};

/** A team side of a match, as needed to build match-shaped candidates. */
export type MatchFactTeamRef = {
  name: string;
  slug: string;
  countrySlug: string | null;
  countryName: string | null;
};

/** Plain, DB-shape-free representation of one match, fed to the builders. */
export type MatchFactInput = {
  slug: string;
  stage: string;
  year: number;
  tournamentSlug: string;
  home: MatchFactTeamRef;
  away: MatchFactTeamRef;
  homeScore: number;
  awayScore: number;
  homeScorePenalties: number | null;
  awayScorePenalties: number | null;
  decidedByPenalties: boolean;
};
