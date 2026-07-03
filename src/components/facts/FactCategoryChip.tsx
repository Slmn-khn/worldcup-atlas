// Small glowing badges for a fact's category and difficulty. Server-safe.

import NeonChip from "@/components/ui/NeonChip";
import type { FactCategory, FactDifficulty } from "@/generated/prisma/enums";
import { FACT_CATEGORY_LABELS, FACT_DIFFICULTY_LABELS } from "@/lib/factFormat";

export default function FactCategoryChip({
  category,
}: {
  category: FactCategory;
}) {
  return <NeonChip label={FACT_CATEGORY_LABELS[category]} accent="cyan" dot />;
}

export function FactDifficultyChip({
  difficulty,
}: {
  difficulty: FactDifficulty;
}) {
  return <NeonChip label={FACT_DIFFICULTY_LABELS[difficulty]} accent="gold" />;
}
