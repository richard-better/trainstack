import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Worker handler resilience contract (PRE-138).
 *
 * The handler retries transient failures (rethrows so Graphile Worker re-runs)
 * but on the final attempt marks the row `failed` and swallows the error so the
 * job completes and the client stops polling. We mock the orchestration module
 * so no DB / LLM is touched — only the attempts logic is under test.
 */

const runSessionGeneration = vi.fn();
const markSessionFailed = vi.fn();

vi.mock("../services/session-generation-job", () => ({
  runSessionGeneration: (...args: unknown[]) => runSessionGeneration(...args),
  markSessionFailed: (...args: unknown[]) => markSessionFailed(...args),
}));

import { sessionGenerationRequested } from "../events/handlers/session-generation-requested";

interface FakeJob {
  attempts: number;
  max_attempts: number;
}

function makeHelpers(job: FakeJob) {
  return {
    job,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  } as never;
}

const PAYLOAD = { sessionId: "sess_1" };

describe("sessionGenerationRequested handler", () => {
  beforeEach(() => {
    runSessionGeneration.mockReset();
    markSessionFailed.mockReset();
  });

  it("success → runs generation, never marks failed", async () => {
    runSessionGeneration.mockResolvedValueOnce(undefined);

    await sessionGenerationRequested(PAYLOAD, makeHelpers({ attempts: 1, max_attempts: 3 }));

    expect(runSessionGeneration).toHaveBeenCalledWith("sess_1");
    expect(markSessionFailed).not.toHaveBeenCalled();
  });

  it("transient failure (attempts < max) → rethrows for retry, does not mark failed", async () => {
    runSessionGeneration.mockRejectedValueOnce(new Error("model 503"));

    await expect(
      sessionGenerationRequested(PAYLOAD, makeHelpers({ attempts: 1, max_attempts: 3 })),
    ).rejects.toThrow("model 503");

    expect(markSessionFailed).not.toHaveBeenCalled();
  });

  it("final attempt failure → marks failed with the message, swallows the error", async () => {
    runSessionGeneration.mockRejectedValueOnce(new Error("all models exhausted"));

    // Should NOT throw — the job completes; the row carries the failure.
    await sessionGenerationRequested(PAYLOAD, makeHelpers({ attempts: 3, max_attempts: 3 }));

    expect(markSessionFailed).toHaveBeenCalledWith("sess_1", "all models exhausted");
  });
});
