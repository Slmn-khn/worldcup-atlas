// Pure anti-hallucination guard: extracts every digit sequence the AI wrote
// and checks it against the exact numbers it was given (see ./types.ts
// AiDraftInput.facts). No AI call, no Prisma import — this is the part of
// the pipeline that must be trustworthy on its own, independent of whatever
// the model actually said, so it stays fully unit-testable in isolation.
//
// Deliberately strict: the AI is instructed (./prompt.ts) to use only the
// given numbers and to write them as digits, never spelled out or derived
// (rounded, averaged, summed). Any digit sequence in the output that isn't
// one of the allowed numbers is treated as an unverified claim and fails
// validation — see ./index.ts, which never writes a failed draft to the
// database. Failing closed here is the point: a stricter-than-necessary
// rejection is recoverable (re-run the drafter), a silently accepted
// hallucination is not.

import type { AiDraftFact, AiDraftedText, NumericValidationResult } from "./types";

const NUMBER_PATTERN = /\d+/g;

/** Every digit-sequence number found in a value, in order. A string value
 * like "2002–2014" yields [2002, 2014]; a numeric value yields itself. */
export function extractNumbers(value: string | number): number[] {
  if (typeof value === "number") return [value];
  const matches = value.match(NUMBER_PATTERN);
  return matches === null ? [] : matches.map((match) => Number.parseInt(match, 10));
}

/** The full set of numbers the AI was given permission to state. */
export function getAllowedNumbers(facts: AiDraftFact[]): Set<number> {
  const allowed = new Set<number>();
  for (const fact of facts) {
    for (const n of extractNumbers(fact.value)) allowed.add(n);
  }
  return allowed;
}

/** Every digit-sequence number the AI's drafted text actually states. */
export function extractNumericClaims(text: string): number[] {
  return extractNumbers(text);
}

/**
 * Validates a drafted title/summary/paragraph against the facts it was
 * supposed to be grounded in. Checks all three fields together (concatenated)
 * since a hallucinated number is equally unacceptable in any of them.
 */
export function validateDraftNumbers(
  draft: AiDraftedText,
  facts: AiDraftFact[],
): NumericValidationResult {
  const allowed = getAllowedNumbers(facts);
  const combinedText = `${draft.title} ${draft.summary} ${draft.paragraph}`;
  const claimed = extractNumericClaims(combinedText);
  const invalidNumbers = [...new Set(claimed.filter((n) => !allowed.has(n)))];
  return { valid: invalidNumbers.length === 0, invalidNumbers, allowedNumbers: [...allowed] };
}
