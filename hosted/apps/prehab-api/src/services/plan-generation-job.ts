/**
 * Async plan generation (PRE-152 / PRE-153).
 *
 * Mirrors the session-generation-job pattern: a worker job calls
 * `runPlanGeneration` so the slow LLM scaffold + reveal-copy calls run off the
 * request path and Graphile-retried. The inline retry path
 * (`plans.startGenerated` RPC) also calls this directly so there's one source
 * of truth.
 *
 * Two phases per attempt:
 * 1. Ensure an `active` plan row exists with `generation_status = 'pending'`.
 *    The reveal screen polls this row from the moment the worker is enqueued.
 * 2. Run the scaffold + reveal-copy LLM calls and flip the row to `ready`
 *    with the generated content + materialized schedule.
 *
 * If `generation_status` is already `ready`, runPlanGeneration is a no-op and
 * returns the existing row — re-runs (e.g. Coach re-eval re-enqueue) keep the
 * previously-revealed plan rather than wiping the user's homepage.
 */

import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db, intakeSummaries, plans, programSchedule, sessions, sportProfiles } from "../db";
import { emitEvent } from "../events/emit.js";
import { DomainEvents } from "../events/types.js";
import { hydrateProfile } from "./profile-projection";
import {
  generateRevealCopyWithAI,
  generateWeeklyScaffoldWithAI,
  type RevealCopy,
  type ScaffoldItem,
} from "./session-generator";
import { addDays, SCAFFOLD_WINDOW_DAYS } from "./session-context";
import { instrumentGenerateObject } from "./llm/observability";

export type PlanRow = typeof plans.$inferSelect;

// The generated plan's date window. Only the opening SCAFFOLD_WINDOW_DAYS are
// materialized at creation; later days fill lazily via daily session generation.
export const GENERATED_PLAN_WEEKS = 12;

export class PlanGenerationProfileMissingError extends Error {
  constructor() {
    super("Sport profile not found. Complete onboarding first.");
    this.name = "PlanGenerationProfileMissingError";
  }
}

/**
 * Create (or finish generating) the user's active plan.
 *
 * Returns the existing plan row when it's already `ready`. Otherwise, ensures a
 * `pending` row exists, runs the scaffold + reveal-copy LLM, materializes the
 * opening schedule window, and enqueues the first-day session generation.
 *
 * Throws `PlanGenerationProfileMissingError` when the user has no
 * sport_profiles row yet (transient during a Coach-first onboarding flow — the
 * worker retries and the row arrives once the user answers their first
 * structured question).
 */
export async function runPlanGeneration(userId: string, today: string): Promise<PlanRow> {
  // Short-circuit if the user already has a *ready* active plan (idempotency
  // for retries, defensive enqueues, and Coach re-eval re-runs).
  const existingActive = await db
    .select()
    .from(plans)
    .where(and(eq(plans.userId, userId), eq(plans.status, "active")))
    .orderBy(desc(plans.createdAt))
    .limit(1);
  if (existingActive[0] && existingActive[0].generationStatus === "ready") {
    return existingActive[0];
  }

  const profile = await hydrateProfile(userId);
  if (!profile) {
    throw new PlanGenerationProfileMissingError();
  }

  const startDate = today;
  const endDate = addDays(startDate, GENERATED_PLAN_WEEKS * 7 - 1);

  // Phase 1: ensure a pending plan row exists *before* the long LLM calls so
  // the reveal screen has something to poll while we work.
  const pendingPlan = await ensurePendingPlanRow({
    userId,
    today,
    startDate,
    endDate,
    profile: { goals: profile.goals, focusAreas: profile.focusAreas },
    existingActiveId: existingActive[0]?.id ?? null,
  });

  // Phase 2: run the scaffold + reveal copy LLM calls (slow). Re-throwing
  // bubbles up to the Graphile retry; the worker handler decides when to mark
  // the row `failed`.
  const intakeSummaryRows = await db
    .select()
    .from(intakeSummaries)
    .where(eq(intakeSummaries.userId, userId));
  const intakeSummary = (intakeSummaryRows[0]?.summary as never) ?? null;

  let scaffold: ScaffoldItem[] = [];
  try {
    scaffold = await generateWeeklyScaffoldWithAI(
      {
        sport: profile.primarySport,
        trainingVolumeHrs: profile.trainingVolumeHrsPerWeek,
        startDate,
        daysAhead: SCAFFOLD_WINDOW_DAYS,
        goals: profile.goals,
        focusAreas: profile.focusAreas,
        sportTimeBreakdown: profile.sportTimeBreakdown,
        intakeSummary,
      },
      instrumentGenerateObject({ endpoint: "weekly_scaffold", userId }),
    );
  } catch {
    // Lazy fill (generateDailySession) covers the schedule if the model is down.
    scaffold = [];
  }

  let revealCopy: RevealCopy | null = null;
  try {
    revealCopy = await generateRevealCopyWithAI(
      {
        name: profile.name,
        durationWeeks: GENERATED_PLAN_WEEKS,
        sport: profile.primarySport,
        sports: profile.sports,
        goals: profile.goals,
        focusAreas: profile.focusAreas,
        intakeSummary,
        scaffoldThemes: dedupeThemes(scaffold.map((s) => s.sessionTheme)),
      },
      instrumentGenerateObject({ endpoint: "reveal_copy", userId }),
    );
  } catch {
    // Reveal copy is best-effort — the screen falls back to a generic header.
    revealCopy = null;
  }

  // Phase 3: persist scaffold + reveal copy, flip the row to `ready`.
  const readyPlan = await db.transaction(async (tx) => {
    await tx
      .update(plans)
      .set({
        headline: revealCopy?.headline ?? null,
        subtitle: revealCopy?.subtitle ?? null,
        themes: revealCopy?.themes ?? null,
        generationStatus: "ready",
        generationError: null,
      })
      .where(eq(plans.id, pendingPlan.id));

    if (scaffold.length > 0) {
      await tx
        .insert(programSchedule)
        .values(
          scaffold.map((item) => ({
            userId,
            planId: pendingPlan.id,
            date: item.date,
            sessionTheme: item.sessionTheme,
            sessionType: item.sessionType,
          })),
        )
        .onConflictDoUpdate({
          target: [programSchedule.userId, programSchedule.date],
          set: {
            planId: pendingPlan.id,
            sessionTheme: sql`excluded.session_theme`,
            sessionType: sql`excluded.session_type`,
          },
        });
    }

    const refreshed = await tx.select().from(plans).where(eq(plans.id, pendingPlan.id));
    return refreshed[0]!;
  });

  // Enqueue today's first session so the reveal screen's "sneak peek" can
  // light up as soon as it lands. jobKey de-dupes if the worker fires twice.
  await enqueueFirstSessionForToday(userId, today);

  return readyPlan;
}

/**
 * Mark the user's active plan row as `failed` (final Graphile retry exhausted).
 * Surfaces a "Try again" CTA on the reveal/loading screen, which re-enqueues
 * a fresh plan_generation_requested.
 */
export async function markPlanFailed(userId: string, error: string): Promise<void> {
  const activePlan = await db
    .select({ id: plans.id })
    .from(plans)
    .where(and(eq(plans.userId, userId), eq(plans.status, "active")))
    .orderBy(desc(plans.createdAt))
    .limit(1);
  const row = activePlan[0];
  if (!row) return;
  await db
    .update(plans)
    .set({ generationStatus: "failed", generationError: error.slice(0, 1000) })
    .where(eq(plans.id, row.id));
}

/**
 * True iff the user has finished structured onboarding (disclaimer answered).
 * The plan-generation worker uses this as a gate so retries don't churn
 * indefinitely while the user is mid-flow.
 */
export async function isOnboardingComplete(userId: string): Promise<boolean> {
  const rows = await db
    .select({ completedAt: sportProfiles.onboardingCompletedAt })
    .from(sportProfiles)
    .where(eq(sportProfiles.userId, userId));
  return rows[0]?.completedAt != null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

interface PendingPlanArgs {
  userId: string;
  today: string;
  startDate: string;
  endDate: string;
  profile: { goals: string[]; focusAreas: string[] };
  existingActiveId: string | null;
}

/**
 * Ensure the user has exactly one `active` plan row with
 * `generation_status = 'pending'`. Idempotent across worker retries:
 *
 * - No active plan → insert one, supersede nothing.
 * - Active plan with status `pending`/`failed` → reuse the same row (flip back
 *   to `pending`, clear any prior error). We never abandon a row mid-flight
 *   because the reveal screen is already polling its id.
 */
async function ensurePendingPlanRow(args: PendingPlanArgs): Promise<PlanRow> {
  const { userId, startDate, endDate, profile, existingActiveId } = args;

  return db.transaction(async (tx) => {
    if (existingActiveId) {
      // Re-attempt path. Reset status, keep the id stable for any client polls.
      const updated = await tx
        .update(plans)
        .set({
          generationStatus: "pending",
          generationError: null,
          startDate,
          endDate,
          goalsSnapshot: profile.goals,
          focusSnapshot: profile.focusAreas,
        })
        .where(eq(plans.id, existingActiveId))
        .returning();
      return updated[0]!;
    }

    // Snapshot any other active plans defensively (app invariant: one per user).
    const priorActive = await tx
      .select({ id: plans.id })
      .from(plans)
      .where(and(eq(plans.userId, userId), eq(plans.status, "active")));
    const priorActiveIds = priorActive.map((p) => p.id);

    const inserted = await tx
      .insert(plans)
      .values({
        userId,
        source: "generated",
        status: "active",
        generationStatus: "pending",
        startDate,
        endDate,
        goalsSnapshot: profile.goals,
        focusSnapshot: profile.focusAreas,
      })
      .returning();
    const newPlan = inserted[0]!;

    if (priorActiveIds.length > 0) {
      await tx
        .update(plans)
        .set({ status: "superseded", supersededByPlanId: newPlan.id })
        .where(and(eq(plans.userId, userId), inArray(plans.id, priorActiveIds)));

      // Clear future schedule from prior plans so the new plan owns the
      // calendar from its start. Past rows stay as history.
      await tx
        .delete(programSchedule)
        .where(
          and(
            eq(programSchedule.userId, userId),
            inArray(programSchedule.planId, priorActiveIds),
            gte(programSchedule.date, startDate),
          ),
        );
    }

    // Re-home any null-plan legacy rows (orphan-scaffold from the pre-PRE-152
    // lazy-fill path) on/after startDate so they belong to the new plan.
    await tx
      .update(programSchedule)
      .set({ planId: newPlan.id })
      .where(
        and(
          eq(programSchedule.userId, userId),
          gte(programSchedule.date, startDate),
          sql`${programSchedule.planId} IS NULL`,
        ),
      );

    return newPlan;
  });
}

function dedupeThemes(themes: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of themes) {
    const trimmed = t.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/**
 * Enqueue the first daily session for today so the reveal-screen sneak peek
 * can light up the moment it lands. No-op if a live `daily` session for today
 * already exists (returns silently — idempotent).
 */
async function enqueueFirstSessionForToday(userId: string, today: string): Promise<void> {
  // Check for an existing live daily row for today to keep this idempotent
  // across retries / repeat enqueues.
  const existing = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        eq(sessions.sessionDate, today),
        eq(sessions.source, "daily"),
      ),
    );
  if (existing.length > 0) return;

  const inserted = await db
    .insert(sessions)
    .values({
      userId,
      sessionDate: today,
      status: "pending",
      source: "daily",
      exercises: [],
      generationContext: { request: { readiness: "normal", lean: true } },
    })
    .returning({ id: sessions.id });

  const row = inserted[0];
  if (!row) return;

  await emitEvent(
    DomainEvents.SESSION_GENERATION_REQUESTED,
    { sessionId: row.id },
    { maxAttempts: 3, jobKey: `session-gen:${row.id}` },
  );
}
