/**
 * Internal Coach / session-generator playground (PRE-130).
 *
 * Replays `generateDailySession` (and the regenerate path) against a real
 * user's context — or an arbitrary system-prompt override — without shipping
 * and poking the app by hand. Returns the full assembled inputs, the exact
 * system prompt, and the raw structured model output, plus the metered
 * tokens/cost/latency (the playground call is itself logged as endpoint
 * `playground` via the PRE-131 instrumentation).
 *
 * `assembleDailyInputs` mirrors the worker's input assembly in
 * session-generation-job.ts but is strictly read-only (no DB writes, no
 * scaffold lazy-fill) so running the playground never mutates a user's data.
 */
import { generateObject as _generateObject } from "../durable/runtime";
import { and, desc, eq } from "drizzle-orm";

import {
  capacityLogs,
  dailyCheckIns,
  db,
  intakeSummaries,
  plans,
  programSchedule,
  sessions,
} from "../../db";
import { derivePrimarySportConfidence, hydrateProfile } from "../profile-projection";
import { addDays, computeAge, getActivePlanArc } from "../session-context";
import { getExerciseNamesForSportsAndEquipment } from "../constants/exercises";
import {
  AISessionSchema,
  buildDailySystemPrompt,
  getLeanDailyModels,
  getModels,
  type DailyGenerationInputs,
} from "../session-generator";
import { instrumentGenerateObject, type RecordedCall } from "./observability";

const PLAYGROUND_TIMEOUT_MS = 30_000;

export interface DailyPlaygroundOptions {
  userId: string;
  sessionDate: string;
  readiness: "low" | "normal" | "high";
  sessionType?: "prehab" | "recovery" | "mobility" | "activation";
  // lean=true → tap-through single fast model + selection prompt (the daily
  // auto-generate path). lean=false → full prompt (the regenerate path).
  lean: boolean;
  // Override the assembled system prompt to iterate on wording without a deploy.
  systemPromptOverride?: string;
}

export interface DailyPlaygroundResult {
  systemPrompt: string;
  inputs: DailyGenerationInputs;
  exerciseNames: string[];
  model: string;
  status: "ok" | "error";
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  output: unknown;
  error: string | null;
}

/**
 * Build the `DailyGenerationInputs` the worker would feed the prompt for this
 * user on this date — read-only. Returns null when the user hasn't onboarded.
 */
export async function assembleDailyInputs(
  opts: Pick<DailyPlaygroundOptions, "userId" | "sessionDate" | "readiness" | "sessionType">,
): Promise<DailyGenerationInputs | null> {
  const { userId, sessionDate } = opts;
  const profile = await hydrateProfile(userId);
  if (!profile) return null;

  // Today's planned theme (read-only; no scaffold lazy-fill here).
  const scheduleRow = await db
    .select()
    .from(programSchedule)
    .where(and(eq(programSchedule.userId, userId), eq(programSchedule.date, sessionDate)));
  const sessionTheme = scheduleRow[0]?.sessionTheme ?? null;

  // Yesterday's feedback + post-session capacity.
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

  // Readiness: today's check-in wins; else the requested value (flagged DEFAULT).
  const checkInRows = await db
    .select()
    .from(dailyCheckIns)
    .where(and(eq(dailyCheckIns.userId, userId), eq(dailyCheckIns.checkInDate, sessionDate)));
  const checkInReadiness = checkInRows[0]?.readiness as "low" | "normal" | "high" | undefined;
  const effectiveReadiness = checkInReadiness ?? opts.readiness;
  const readinessSource: "check_in" | "default" = checkInReadiness != null ? "check_in" : "default";

  const requestedType = opts.sessionType;
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
  const activePlanRows = await db
    .select({ headline: plans.headline, subtitle: plans.subtitle, themes: plans.themes })
    .from(plans)
    .where(and(eq(plans.userId, userId), eq(plans.status, "active")))
    .orderBy(desc(plans.createdAt))
    .limit(1);
  const activePlan = activePlanRows[0] ?? null;

  return {
    sport: profile.primarySport,
    sports: profile.sports,
    readiness: effectiveReadiness,
    readinessSource,
    primarySportConfidence: derivePrimarySportConfidence(
      profile.sports,
      profile.sportTimeBreakdown,
    ),
    trainingVolumeHrs: profile.trainingVolumeHrsPerWeek,
    sessionTheme: requestedType ? null : sessionTheme,
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
}

/**
 * Run one daily-generation call for the playground. A single generateObject
 * call (no catalogue-correction retry / cross-model fallback) so the raw,
 * first-try model output is visible for prompt debugging. Never throws on a
 * model error — the failure is returned in the result.
 */
export async function runDailyGenerationPlayground(
  opts: DailyPlaygroundOptions,
): Promise<DailyPlaygroundResult> {
  const inputs = await assembleDailyInputs(opts);
  if (!inputs) {
    throw new Error("User has not onboarded (no sport profile).");
  }

  const exerciseNames = getExerciseNamesForSportsAndEquipment(
    inputs.sports,
    inputs.equipment ?? [],
  );
  const override = opts.systemPromptOverride?.trim();
  const systemPrompt = override
    ? override
    : buildDailySystemPrompt(inputs, exerciseNames, { lean: opts.lean });

  const model = (opts.lean ? getLeanDailyModels() : getModels())[0]!;

  let captured: RecordedCall | undefined;
  const genFn = instrumentGenerateObject(
    {
      endpoint: "playground",
      userId: opts.userId,
      metadata: { playground: "daily", lean: opts.lean, override: !!override },
      onRecord: (r) => {
        captured = r;
      },
    },
    _generateObject as never,
  );

  const base: Omit<DailyPlaygroundResult, "status" | "output" | "error"> = {
    systemPrompt,
    inputs,
    exerciseNames,
    model: model.name,
    latencyMs: 0,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
  };

  try {
    const result = await genFn({
      model: model.model,
      schema: AISessionSchema,
      system: systemPrompt,
      prompt: "Generate the prehab session now.",
      abortSignal: AbortSignal.timeout(PLAYGROUND_TIMEOUT_MS),
    });
    return {
      ...base,
      latencyMs: captured?.latencyMs ?? 0,
      inputTokens: captured?.inputTokens ?? null,
      outputTokens: captured?.outputTokens ?? null,
      costUsd: captured?.costUsd ?? null,
      status: "ok",
      output: result.object,
      error: null,
    };
  } catch (e) {
    return {
      ...base,
      latencyMs: captured?.latencyMs ?? 0,
      status: "error",
      output: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
