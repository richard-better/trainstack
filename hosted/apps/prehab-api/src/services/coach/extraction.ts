import { google } from "../durable/runtime";
import { IntakeSummarySchema, type IntakeSummary } from "@trainstack/prehab-contract";
import { generateObject as _generateObject } from "../durable/runtime";

import { GEMINI_MODEL } from "../session-generator";

import { buildCoachContextSystem } from "./agent";

// Loosely typed for test injection — see session-generator.ts for the same pattern.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GenerateObjectFn = (params: any) => Promise<{ object: any }>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ModelLike = any;

const EXTRACTION_TIMEOUT_MS = 30_000;

/**
 * Flattens a UIMessage `parts` array into the prompt text the extractor sees.
 * Tool calls/results are stringified compactly so the extractor can reference
 * them — `flagRedFlag` calls become a `constraints` entry, for example.
 */
function flattenPartsToText(parts: unknown[]): string {
  const out: string[] = [];
  for (const p of parts) {
    if (!p || typeof p !== "object") continue;
    const part = p as { type: string; text?: string; toolName?: string; input?: unknown };
    if (part.type === "text" && typeof part.text === "string") {
      out.push(part.text);
    } else if (part.type.startsWith("tool-")) {
      const name = part.type.slice("tool-".length);
      out.push(`[tool:${name}${part.input ? ` ${JSON.stringify(part.input)}` : ""}]`);
    }
  }
  return out.join(" ").trim();
}

export interface ExtractionMessage {
  role: "user" | "assistant" | "system";
  parts: unknown[];
}

export interface ExtractionInputs {
  /** NL "Q: ...\nA: ..." projection of structured intake. */
  structuredIntakeProse: string;
  messages: ExtractionMessage[];
}

const EXTRACTION_SYSTEM_PROMPT = `You are summarizing a sports physiotherapy intake conversation into a compact JSON record. Your output drives downstream AI session generation, so be precise and only include facts the user explicitly stated.

Rules:
- Use the focus area keys (e.g. "knees", "lower-back", "shoulders") from the structured intake exactly as provided. Do not invent new keys.
- For \`regions\`: only include focus areas the user said something concrete about. Empty object is valid.
- For \`currentInjuries\`: only include injuries the user actively named — current pain, recent strain, post-op, ongoing issue. Skip historical injuries that have fully resolved.
- For \`aggravators\`: short, specific phrases. "deep squats", "downhill running", "sitting all day" — not "movement" or "exercise".
- \`goalsContext\`: a single sentence capturing the user's most specific goal nuance. Null if they said nothing beyond the structured goals list.
- \`constraints\`: things to avoid. Include any \`flagRedFlag\` tool reasons here verbatim.
- Never invent diagnoses, dates, or symptoms not stated in the conversation.`;

export async function extractIntakeSummary(
  inputs: ExtractionInputs,
  generateObjectFn: GenerateObjectFn = _generateObject as GenerateObjectFn,
  model: ModelLike = google(GEMINI_MODEL),
): Promise<IntakeSummary> {
  const transcript = inputs.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => `${m.role.toUpperCase()}: ${flattenPartsToText(m.parts)}`)
    .filter((line) => line.length > line.indexOf(":") + 2)
    .join("\n\n");

  const prompt = `${buildCoachContextSystem(inputs.structuredIntakeProse)}\n\n# CONVERSATION\n${transcript}\n\nProduce the IntakeSummary JSON now.`;

  const { object } = await generateObjectFn({
    model,
    schema: IntakeSummarySchema,
    system: EXTRACTION_SYSTEM_PROMPT,
    prompt,
    abortSignal: AbortSignal.timeout(EXTRACTION_TIMEOUT_MS),
  });

  // generateObject already validates against the schema, but parse again so
  // defaults (empty arrays, null) are filled in even if the model omits them.
  return IntakeSummarySchema.parse(object);
}
