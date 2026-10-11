/**
 * Domain events delivered via Graphile Worker.
 * Each event name maps to a typed payload for type-safe emission and handling.
 */

// ── Event names ────────────────────────────────────────────────────────

export const DomainEvents = {
  WAITLIST_SIGNUP: "waitlist_signup",
  ACCOUNT_DELETION_SCHEDULED: "account_deletion_scheduled",
  ACCOUNT_REACTIVATED: "account_reactivated",
  // Async session generation (PRE-138): the request path inserts a `pending`
  // session row and enqueues this; the worker runs the LLM generation and
  // flips the row to `ready`/`failed`. Payload is just the row id — all
  // generation inputs are read back from the row (stashed in generationContext).
  SESSION_GENERATION_REQUESTED: "session_generation_requested",
  // Async plan generation (PRE-152): enqueued at the canonical end-of-onboarding
  // moment (disclaimer answered) so the slow scaffold LLM call runs off the
  // request path. Idempotent — the job no-ops if an active plan already exists.
  PLAN_GENERATION_REQUESTED: "plan_generation_requested",
} as const;

export type DomainEventName = (typeof DomainEvents)[keyof typeof DomainEvents];

// ── Payload types ──────────────────────────────────────────────────────

export interface EventPayloads {
  waitlist_signup: { email: string };
  // deletionDate is the ISO timestamp the grace window ends (request + 30d).
  account_deletion_scheduled: { email: string; name: string; deletionDate: string };
  account_reactivated: { email: string; name: string };
  session_generation_requested: { sessionId: string };
  // userId is the target user; today is the YYYY-MM-DD start date for the new
  // plan in the user's locale (sent by the enqueuing RPC so the worker doesn't
  // guess a server timezone).
  plan_generation_requested: { userId: string; today: string };
}
