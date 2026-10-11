import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * plan_generation_requested worker handler resilience contract (PRE-152).
 *
 * The handler:
 *  - runs `runPlanGeneration` on the happy path
 *  - rethrows transient failures to let Graphile Worker retry
 *  - on the final attempt logs and swallows so the job completes
 *  - SPECIAL: on `PlanGenerationProfileMissingError`, suppresses without retry
 *    when onboarding is not yet complete (transient race during sign-up flow)
 */

const { runPlanGeneration, isOnboardingComplete, markPlanFailed } = vi.hoisted(() => ({
  runPlanGeneration: vi.fn(),
  isOnboardingComplete: vi.fn(),
  markPlanFailed: vi.fn(),
}));

vi.mock("../services/plan-generation-job", () => {
  // Inlined so vi.mock's hoisted factory has no out-of-scope references.
  class MissingProfileError extends Error {
    constructor() {
      super("Sport profile not found. Complete onboarding first.");
      this.name = "PlanGenerationProfileMissingError";
    }
  }
  return {
    runPlanGeneration: (...args: unknown[]) => runPlanGeneration(...args),
    isOnboardingComplete: (...args: unknown[]) => isOnboardingComplete(...args),
    markPlanFailed: (...args: unknown[]) => markPlanFailed(...args),
    PlanGenerationProfileMissingError: MissingProfileError,
  };
});

import { planGenerationRequested } from "../events/handlers/plan-generation-requested";
import { PlanGenerationProfileMissingError } from "../services/plan-generation-job";

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

const PAYLOAD = { userId: "user_1", today: "2026-05-27" };

describe("planGenerationRequested handler", () => {
  beforeEach(() => {
    runPlanGeneration.mockReset();
    isOnboardingComplete.mockReset();
    markPlanFailed.mockReset();
    markPlanFailed.mockResolvedValue(undefined);
  });

  it("success → runs generation, no retry", async () => {
    runPlanGeneration.mockResolvedValueOnce(undefined);

    await planGenerationRequested(PAYLOAD, makeHelpers({ attempts: 1, max_attempts: 5 }));

    expect(runPlanGeneration).toHaveBeenCalledWith("user_1", "2026-05-27");
  });

  it("transient failure (attempts < max) → rethrows for retry", async () => {
    runPlanGeneration.mockRejectedValueOnce(new Error("scaffold 503"));

    await expect(
      planGenerationRequested(PAYLOAD, makeHelpers({ attempts: 1, max_attempts: 5 })),
    ).rejects.toThrow("scaffold 503");
  });

  it("final attempt failure → marks plan failed, logs, and swallows (no rethrow)", async () => {
    runPlanGeneration.mockRejectedValueOnce(new Error("permanent boom"));

    await planGenerationRequested(PAYLOAD, makeHelpers({ attempts: 5, max_attempts: 5 }));

    // PRE-153: terminal failure stamps the active plan row so the reveal /
    // loading screen surfaces a "Try again" CTA instead of polling forever.
    expect(markPlanFailed).toHaveBeenCalledWith("user_1", "permanent boom");
  });

  it("profile missing + onboarding NOT complete → suppress (no retry)", async () => {
    runPlanGeneration.mockRejectedValueOnce(new PlanGenerationProfileMissingError());
    isOnboardingComplete.mockResolvedValueOnce(false);

    // Must NOT throw — Coach completed early in the flow before disclaimer set
    // onboarding_completed_at; a fresh enqueue arrives later from the disclaimer.
    await planGenerationRequested(PAYLOAD, makeHelpers({ attempts: 1, max_attempts: 5 }));

    expect(isOnboardingComplete).toHaveBeenCalledWith("user_1");
  });

  it("profile missing + onboarding IS complete → retry (genuine bug)", async () => {
    runPlanGeneration.mockRejectedValueOnce(new PlanGenerationProfileMissingError());
    isOnboardingComplete.mockResolvedValueOnce(true);

    await expect(
      planGenerationRequested(PAYLOAD, makeHelpers({ attempts: 1, max_attempts: 5 })),
    ).rejects.toThrow("Sport profile not found");
  });
});
