// The only file in the AI-assisted fact drafter that touches the Anthropic
// SDK or makes a network call. Reached exclusively via a dynamic import from
// ./index.ts, which in turn is only ever invoked from the offline CLI script
// scripts/facts/draft-ai-fact-candidates.ts — never from a route handler,
// page, or anything else that serves public traffic. See
// docs/DISCOVERY_VAULT.md "Why AI is not used at runtime".
//
// Uses structured outputs (output_config.format) rather than free-form text,
// so the response is always exactly { title, summary, paragraph } — no
// prose-parsing, no partial/garbled JSON to recover from.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import { aiDraftedTextSchema, type AiDraftedText } from "./types";

const MODEL = "claude-opus-4-8";
const MAX_TOKENS = 1024;

export async function draftFactText(
  systemPrompt: string,
  userPrompt: string,
): Promise<AiDraftedText> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey === undefined || apiKey === "") {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Set it in the environment to run the AI-assisted fact drafter.",
    );
  }

  const client = new Anthropic({ apiKey });
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
    output_config: { format: zodOutputFormat(aiDraftedTextSchema) },
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined to draft this fact (safety refusal).");
  }
  if (response.parsed_output === null) {
    throw new Error("Claude's response did not match the expected title/summary/paragraph schema.");
  }
  return response.parsed_output;
}
