import { describe, expect, it } from "vitest";

import { CLAUDE_MODEL, GEMINI_MODEL } from "../services/llm/models";
import { estimateCostUsd } from "../services/llm/pricing";
import { instrumentGenerateObject, type RecordedCall } from "../services/llm/observability";

// A minimal stand-in for an `ai` LanguageModel — instrumentGenerateObject only
// reads `.modelId` / `.provider` off it.
function fakeModel(modelId: string, provider = "google.generative-ai") {
  return { modelId, provider };
}

describe("estimateCostUsd", () => {
  it("prices a known model from the per-MTok table", () => {
    // 1000 in * $0.1/M + 500 out * $0.4/M = 0.0001 + 0.0002 = 0.0003
    expect(estimateCostUsd(GEMINI_MODEL, 1000, 500)).toBeCloseTo(0.0003, 9);
    // Claude: 1000 in * $1/M + 1000 out * $5/M = 0.001 + 0.005 = 0.006
    expect(estimateCostUsd(CLAUDE_MODEL, 1000, 1000)).toBeCloseTo(0.006, 9);
  });

  it("returns null for an unknown model or missing usage", () => {
    expect(estimateCostUsd("mystery-model", 1000, 1000)).toBeNull();
    expect(estimateCostUsd(GEMINI_MODEL, null, null)).toBeNull();
  });
});

describe("instrumentGenerateObject", () => {
  it("records tokens, cost and model on a successful call and returns the result", async () => {
    let recorded: RecordedCall | undefined;
    const base = async () => ({
      object: { ok: true },
      usage: { inputTokens: 1200, outputTokens: 300, totalTokens: 1500 },
    });

    const fn = instrumentGenerateObject(
      { endpoint: "playground", userId: "u_1", onRecord: (r) => (recorded = r) },
      base,
    );
    const result = await fn({ model: fakeModel(GEMINI_MODEL) });

    expect(result.object).toEqual({ ok: true });
    expect(recorded).toMatchObject({
      endpoint: "playground",
      provider: "google", // normalised from "google.generative-ai"
      model: GEMINI_MODEL,
      status: "ok",
      inputTokens: 1200,
      outputTokens: 300,
      totalTokens: 1500,
    });
    expect(recorded?.costUsd).toBeCloseTo(0.00024, 9); // 1200*0.1/M + 300*0.4/M
    expect(recorded?.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("falls back to v4/v5 usage field names", async () => {
    let recorded: RecordedCall | undefined;
    const base = async () => ({
      object: {},
      usage: { promptTokens: 10, completionTokens: 20 },
    });
    const fn = instrumentGenerateObject(
      { endpoint: "daily_generation", onRecord: (r) => (recorded = r) },
      base,
    );
    await fn({ model: fakeModel(GEMINI_MODEL) });
    expect(recorded?.inputTokens).toBe(10);
    expect(recorded?.outputTokens).toBe(20);
    expect(recorded?.totalTokens).toBe(30);
  });

  it("records an error call and rethrows", async () => {
    let recorded: RecordedCall | undefined;
    const base = async () => {
      throw new Error("model exploded");
    };
    const fn = instrumentGenerateObject(
      { endpoint: "regenerate", userId: "u_2", onRecord: (r) => (recorded = r) },
      base,
    );

    await expect(fn({ model: fakeModel(CLAUDE_MODEL, "anthropic.messages") })).rejects.toThrow(
      "model exploded",
    );
    expect(recorded).toMatchObject({
      endpoint: "regenerate",
      provider: "anthropic",
      model: CLAUDE_MODEL,
      status: "error",
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
    });
    expect(recorded?.errorMessage).toContain("model exploded");
  });
});
