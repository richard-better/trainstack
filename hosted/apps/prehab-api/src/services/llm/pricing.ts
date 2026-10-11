/**
 * Per-model LLM pricing for cost estimation (PRE-131).
 *
 * USD per 1M tokens, input/output split. These are list prices and only an
 * *estimate* — actual billing (OpenRouter markup, cached-input discounts,
 * batch tiers) can differ. The point is queryable relative spend per
 * user/endpoint, not invoice-grade accounting.
 *
 * Keep model ids aligned with the canonical constants in ./models.
 * Unknown models fall back to `null` cost (tokens are still recorded).
 */
import { CLAUDE_MODEL, GEMINI_MODEL } from "./models";

export interface ModelPrice {
  /** USD per 1,000,000 input tokens. */
  inputPerMTok: number;
  /** USD per 1,000,000 output tokens. */
  outputPerMTok: number;
}

export const LLM_PRICING: Record<string, ModelPrice> = {
  // Google Gemini Flash Lite (primary). List price as of 2026-05.
  [GEMINI_MODEL]: { inputPerMTok: 0.1, outputPerMTok: 0.4 },
  // Anthropic Claude Haiku 4.5 (fallback).
  [CLAUDE_MODEL]: { inputPerMTok: 1.0, outputPerMTok: 5.0 },
};

/**
 * Estimated USD cost for a call, or null when the model isn't in the price
 * table or token counts are missing. Returned as a number; the DB column is
 * numeric(12,6).
 */
export function estimateCostUsd(
  model: string,
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
): number | null {
  const price = LLM_PRICING[model];
  if (!price) return null;
  if (inputTokens == null && outputTokens == null) return null;
  const inCost = ((inputTokens ?? 0) / 1_000_000) * price.inputPerMTok;
  const outCost = ((outputTokens ?? 0) / 1_000_000) * price.outputPerMTok;
  // Round to 6 dp to fit numeric(12,6) and avoid float noise.
  return Math.round((inCost + outCost) * 1_000_000) / 1_000_000;
}
