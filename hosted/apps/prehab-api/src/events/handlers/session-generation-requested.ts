import type { Task } from "graphile-worker";
import type { EventPayloads } from "../types.js";
import { markSessionFailed, runSessionGeneration } from "../../services/session-generation-job.js";

/**
 * Async session generation (PRE-138). Runs the LLM generation for a `pending`
 * session row off the request path. On a transient failure we rethrow so
 * Graphile Worker retries; only on the final attempt do we mark the row
 * `failed` so the client stops polling and can offer a retry.
 */
export const sessionGenerationRequested: Task = async (rawPayload, helpers) => {
  const { sessionId } = rawPayload as EventPayloads["session_generation_requested"];

  try {
    await runSessionGeneration(sessionId);
    helpers.logger.info("Session generated", { sessionId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isFinalAttempt = helpers.job.attempts >= helpers.job.max_attempts;

    if (isFinalAttempt) {
      await markSessionFailed(sessionId, message);
      helpers.logger.error("Session generation failed (final attempt)", { sessionId, message });
      return; // swallow — job is done; the row carries the failure
    }

    helpers.logger.warn("Session generation failed, will retry", {
      sessionId,
      message,
      attempt: helpers.job.attempts,
      maxAttempts: helpers.job.max_attempts,
    });
    throw err; // let Graphile Worker retry
  }
};
