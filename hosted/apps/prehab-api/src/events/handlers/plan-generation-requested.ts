import type { Task } from "graphile-worker";
import type { EventPayloads } from "../types.js";
import {
  isOnboardingComplete,
  markPlanFailed,
  PlanGenerationProfileMissingError,
  runPlanGeneration,
} from "../../services/plan-generation-job.js";

/**
 * Async plan generation (PRE-152). The canonical end-of-onboarding moment
 * (disclaimer answered) enqueues this; the worker runs the slow scaffold
 * generation and writes the active plan row.
 *
 * On a transient failure we rethrow so Graphile Worker retries with backoff.
 * The "profile missing" case is special: it means the user hasn't finished
 * structured onboarding yet, so we suppress instead of retrying — a fresh
 * enqueue happens once the disclaimer fires.
 */
export const planGenerationRequested: Task = async (rawPayload, helpers) => {
  const { userId, today } = rawPayload as EventPayloads["plan_generation_requested"];

  try {
    await runPlanGeneration(userId, today);
    helpers.logger.info("Plan generated", { userId, today });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Profile not yet materialized — only retry if onboarding is actually
    // complete (transient race). If onboarding hasn't finished, suppress so the
    // queue isn't churning waiting for a user who hasn't completed signup.
    if (err instanceof PlanGenerationProfileMissingError) {
      const onboardingDone = await isOnboardingComplete(userId).catch(() => false);
      if (!onboardingDone) {
        helpers.logger.info("Plan generation deferred — onboarding not complete", { userId });
        return;
      }
      // onboarding complete but profile missing → genuine bug; let it retry/log
    }

    const isFinalAttempt = helpers.job.attempts >= helpers.job.max_attempts;
    if (isFinalAttempt) {
      // Flip the plan row to `generation_status = 'failed'` so the reveal /
      // loading screen surfaces a "Try again" CTA instead of polling forever
      // (PRE-153). Best-effort: if the row doesn't exist yet, no-op.
      await markPlanFailed(userId, message).catch(() => undefined);
      helpers.logger.error("Plan generation failed (final attempt)", {
        userId,
        today,
        message,
      });
      return;
    }

    helpers.logger.warn("Plan generation failed, will retry", {
      userId,
      today,
      message,
      attempt: helpers.job.attempts,
      maxAttempts: helpers.job.max_attempts,
    });
    throw err;
  }
};
