/**
 * Async session generation (PRE-138).
 *
 * The RPC request path inserts a `pending` session row, stashes the request
 * params in its `generationContext.request`, and enqueues a
 * `session_generation_requested` job. This module is what the worker runs: it
 * reads everything back from the row, does the (slow) LLM generation, and flips
 * the row to `ready` — or, on a final failed attempt, `failed`.
 *
 * Keeping the orchestration here (not in the worker handler) makes it a single,
 * testable entry point and keeps the request handler thin.
 */

import { and, desc, eq, gte, lt } from "drizzle-orm";
import {
  capacityLogs,
  dailyCheckIns,
  db,
  intakeSummaries,
  plans,
  programSchedule,
  sessions,
} from "../db";
import type { GeneratedSession } from "@trainstack/prehab-contract";
import { DomainEvents } from "../events/types.js";
import { emitEvent } from "../events/emit.js";
import { derivePrimarySportConfidence, hydrateProfile } from "./profile-projection";
import {
  generateDailySessionWithAI,
  generateWeeklyScaffoldWithAI,
  getLeanDailyModels,
  type ScaffoldItem,
} from "./session-generator";
import {
  addDays,
  computeAge,
  getActivePlanArc,
  getActivePlanId,
  SCAFFOLD_WINDOW_DAYS,
} from "./session-context";
import { instrumentGenerateObject } from "./llm/observability";

// Request params stashed on the pending row's generationContext at submit time
// so the worker is fully self-contained from just the session id.
export interface SessionGenerationRequest {
  readiness: "low" | "normal" | "high";
  sessionType?: "prehab" | "recovery" | "mobility" | "activation";
  regenerationNote?: string;
  // Lean tap-through path (single fast model) for the daily auto-generate;
  // regenerate uses the full two-model fallback for quality (PRE-147).
  lean: boolean;
}

interface StashedContext {
  request?: SessionGenerationRequest;
}

/**
 * Run generation for a `pending` session row. Idempotent: a no-op if the row is
 * gone or already `ready`. Throws on generation failure so Graphile Worker can
 * retry; the worker handler decides when to mark the row `failed`.
 */
export async function runSessionGeneration(sessionId: string): Promise<void> {
  const rows = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  const row = rows[0];
  // Row may have been archived/superseded (e.g. a second regenerate) before the
  // worker picked the job up, or already produced by a duplicate job.
  if (!row || row.status === "ready" || row.archivedAt) return;

  const stashed = (row.generationContext ?? {}) as StashedContext;
  const request: SessionGenerationRequest = stashed.request ?? { readiness: "normal", lean: true };
  const { userId, sessionDate } = row;
  const requestedType = request.sessionType;

  // Mark in-flight so the agenda shows a "generating" state while we work.
  await db.update(sessions).set({ status: "generating" }).where(eq(sessions.id, sessionId));

  const profile = await hydrateProfile(userId);
  if (!profile) {
    throw new Error("Sport profile not found. Complete onboarding first.");
  }

  // PRE-152 defensive heal: orphan-scaffold users (profile + intake exist, but
  // no active plan) get a plan generation enqueued. Idempotent via jobKey.
  const activePlanId = await getActivePlanId(userId);
  if (!activePlanId) {
    await emitEvent(
      DomainEvents.PLAN_GENERATION_REQUESTED,
      { userId, today: sessionDate },
      { maxAttempts: 5, jobKey: `plan-gen:${userId}` },
    );
  }

  // Ensure program_schedule covers today; generate the scaffold window if it's
  // missing (lazy fill). Moved here from the RPC so the scaffold's own LLM call
  // no longer blocks the request (PRE-138).
  let scheduleRow = await db
    .select()
    .from(programSchedule)
    .where(and(eq(programSchedule.userId, userId), eq(programSchedule.date, sessionDate)));

  if (scheduleRow.length === 0) {
    const windowEnd = addDays(sessionDate, SCAFFOLD_WINDOW_DAYS);
    const coveredRows = await db
      .select()
      .from(programSchedule)
      .where(
        and(
          eq(programSchedule.userId, userId),
          gte(programSchedule.date, sessionDate),
          lt(programSchedule.date, windowEnd),
        ),
      );

    const coveredDates = new Set(coveredRows.map((r) => r.date));
    let uncoveredCount = 0;
    for (let i = 0; i < SCAFFOLD_WINDOW_DAYS; i++) {
      const d = addDays(sessionDate, i);
      if (!coveredDates.has(d)) uncoveredCount++;
    }

    if (uncoveredCount > 0) {
      const scaffold: ScaffoldItem[] = await generateWeeklyScaffoldWithAI(
        {
          sport: profile.primarySport,
          trainingVolumeHrs: profile.trainingVolumeHrsPerWeek,
          startDate: sessionDate,
          daysAhead: SCAFFOLD_WINDOW_DAYS,
          goals: profile.goals,
          focusAreas: profile.focusAreas,
          sportTimeBreakdown: profile.sportTimeBreakdown,
        },
        instrumentGenerateObject({ endpoint: "weekly_scaffold", userId }),
      );

      if (scaffold.length > 0) {
        // Re-resolve in case the plan-generation job we may have just enqueued
        // raced ahead of us (rare but cheap to check).
        const lazyFillPlanId = (await getActivePlanId(userId)) ?? activePlanId;
        await db
          .insert(programSchedule)
          .values(
            scaffold.map((item) => ({
              userId,
              planId: lazyFillPlanId,
              date: item.date,
              sessionTheme: item.sessionTheme,
              sessionType: item.sessionType,
            })),
          )
          .onConflictDoNothing();
      }

      scheduleRow = await db
        .select()
        .from(programSchedule)
        .where(and(eq(programSchedule.userId, userId), eq(programSchedule.date, sessionDate)));
    }
  }

  const sessionTheme = scheduleRow[0]?.sessionTheme ?? null;

  // Yesterday's feedback + post-session capacity ratings.
  const yesterday = addDays(sessionDate, -1);
  const yesterdaySessions = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, userId), eq(sessions.sessionDate, yesterday)));

  const yesterdayRow = yesterdaySessions[0] ?? null;
  const yesterdayFeedback = yesterdayRow?.feedbackRating
    ? `Feeling: ${yesterdayRow.feedbackRating}${
        Array.isArray(yesterdayRow.feedbackTags) &&
        (yesterdayRow.feedbackTags as string[]).length > 0
          ? `, tags: ${(yesterdayRow.feedbackTags as string[]).join(", ")}`
          : ""
      }${yesterdayRow.feedbackComment ? `, comment: "${yesterdayRow.feedbackComment}"` : ""}`
    : null;

  let yesterdayCapacityAfter: Record<string, number> | null = null;
  if (yesterdayRow?.id) {
    const capacityRows = await db
      .select()
      .from(capacityLogs)
      .where(eq(capacityLogs.sessionId, yesterdayRow.id));
    yesterdayCapacityAfter =
      (capacityRows[0]?.capacityRatingsAfter as Record<string, number> | null) ?? null;
  }

  // Readiness from the day's check-in, falling back to the submitted value.
  // `readinessSource` preserves provenance so the prompt knows whether to
  // treat "normal" as a real signal or a fallback default.
  const checkInRows = await db
    .select()
    .from(dailyCheckIns)
    .where(and(eq(dailyCheckIns.userId, userId), eq(dailyCheckIns.checkInDate, sessionDate)));
  const checkInReadiness = checkInRows[0]?.readiness as "low" | "normal" | "high" | undefined;
  const effectiveReadiness = checkInReadiness ?? request.readiness;
  const readinessSource: "check_in" | "default" = checkInReadiness != null ? "check_in" : "default";

  // An explicit on-demand sessionType overrides the scaffold's planned type.
  // Theme provenance: on-demand requests drop the scaffold theme (see
  // `sessionTheme` below), so themed sessions on this path always trace to
  // the weekly scaffold.
  const effectiveSessionType = requestedType ?? scheduleRow[0]?.sessionType ?? undefined;
  const sessionThemeSource: "weekly_scaffold" | "on_demand" | "none" = requestedType
    ? "on_demand"
    : sessionTheme
      ? "weekly_scaffold"
      : "none";

  const intakeSummaryRows = await db
    .select()
    .from(intakeSummaries)
    .where(eq(intakeSummaries.userId, userId));
  const intakeSummary = (intakeSummaryRows[0]?.summary as never) ?? null;

  const planArc = await getActivePlanArc(userId, sessionDate);

  // Plan-arc copy (PRE-154): keep the daily voice consistent with the reveal
  // screen. Falls through cleanly when the user has no active plan (the prompt
  // omits ## PLAN ARC entirely).
  const activePlanRows = await db
    .select({ headline: plans.headline, subtitle: plans.subtitle, themes: plans.themes })
    .from(plans)
    .where(and(eq(plans.userId, userId), eq(plans.status, "active")))
    .orderBy(desc(plans.createdAt))
    .limit(1);
  const activePlan = activePlanRows[0] ?? null;

  const inputs = {
    sport: profile.primarySport,
    sports: profile.sports,
    readiness: effectiveReadiness,
    readinessSource,
    primarySportConfidence: derivePrimarySportConfidence(
      profile.sports,
      profile.sportTimeBreakdown,
    ),
    trainingVolumeHrs: profile.trainingVolumeHrsPerWeek,
    sessionTheme: requestedType ? null : sessionTheme, // skip scaffold theme on-demand
    sessionThemeSource,
    sessionType: effectiveSessionType,
    yesterdayFeedback,
    yesterdayCapacityAfter,
    name: profile.name,
    age: computeAge(profile.dateOfBirth),
    gender: profile.gender,
    goals: profile.goals,
    focusAreas: profile.focusAreas,
    equipment: profile.equipment,
    dailySessionTimeMin: profile.dailySessionTimeMin,
    sportTimeBreakdown: profile.sportTimeBreakdown,
    intakeSummary,
    planWeek: planArc?.week ?? null,
    planTotalWeeks: planArc?.totalWeeks ?? null,
    planHeadline: activePlan?.headline ?? null,
    planSubtitle: activePlan?.subtitle ?? null,
    planThemes: (activePlan?.themes as string[] | null) ?? null,
  };

  // Daily auto-generate uses the lean single-model path; regenerate keeps the
  // full two-model fallback for resilience/quality (PRE-147). Every model call
  // is metered (tokens/cost/latency) per user + endpoint (PRE-131).
  const dailyGenFn = instrumentGenerateObject({
    endpoint: request.lean ? "daily_generation" : "regenerate",
    userId,
    metadata: { sessionId, lean: request.lean },
  });
  const generationResult = request.lean
    ? await generateDailySessionWithAI(inputs, dailyGenFn, getLeanDailyModels(), { lean: true })
    : await generateDailySessionWithAI(inputs, dailyGenFn);

  const generationContext = {
    ...(generationResult.generationContext as Record<string, unknown>),
    request,
    ...(request.regenerationNote ? { regenerationNote: request.regenerationNote } : {}),
    ...(row.replacesSessionId ? { replacesSessionId: row.replacesSessionId } : {}),
  };

  await db
    .update(sessions)
    .set({
      status: "ready",
      generationError: null,
      exercises: generationResult.session as GeneratedSession,
      generationContext,
    })
    .where(eq(sessions.id, sessionId));
}

/**
 * Mark a session row as permanently failed (final retry exhausted). Surfaced to
 * the client via `status: "failed"` + `generationError` so it can offer a retry.
 */
export async function markSessionFailed(sessionId: string, error: string): Promise<void> {
  await db
    .update(sessions)
    .set({ status: "failed", generationError: error.slice(0, 1000) })
    .where(eq(sessions.id, sessionId));
}
