// Pure prompt construction — no AI call, no Prisma import. Given the same
// AiDraftInput, always builds the same prompt text, so this is unit
// testable without a network connection. See ./client.ts for the only file
// that actually sends these strings to the Anthropic API.

import type { AiDraftInput } from "./types";

export function buildSystemPrompt(): string {
  return [
    "You are a copywriter for WORLDCUP Nexus, an independent historical archive of the FIFA World Cup.",
    "You will be given a short list of facts that have already been verified against the archive's own database, plus brief context.",
    "Write a title, a one-sentence summary, and a short paragraph (2-3 sentences) describing ONLY the facts given.",
    "",
    "Strict rules:",
    "- Use ONLY the numbers listed under Facts. Do not calculate, estimate, round, average, or introduce any other number — including years, counts, scores, ranks, or percentages that are not explicitly given.",
    "- Do not state any claim that is not directly supported by the given facts. Do not add trivia, superlatives, or comparisons the facts don't support.",
    "- Always write numbers as digits (16, not sixteen).",
    "- Do not mention that this text was written or drafted by AI.",
    "- Write like a premium sports almanac: factual and engaging, with no marketing hype or clickbait phrasing.",
  ].join("\n");
}

export function buildUserPrompt(input: AiDraftInput): string {
  const factLines = input.facts.map((fact) => `- ${fact.label}: ${fact.value}`).join("\n");
  return [
    `Facts:\n${factLines}`,
    "",
    `Context: ${input.context}`,
    "",
    "Write the title, summary, and paragraph now, using only the facts above.",
  ].join("\n");
}
