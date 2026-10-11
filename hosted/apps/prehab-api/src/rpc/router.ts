import { implement, ORPCError } from "@orpc/server";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import {
  db,
  user,
  session,
  waitlist,
  capacityLogs,
  dailyCheckIns,
  intakeSummaries,
  llmCallLogs,
  notificationPreferences,
  messages,
  plans,
  profileAnswers,
  programSchedule,
  sessions,
  sessionTemplates,
  sportProfiles,
  subscriptions,
  threads,
} from "../db";
import { auth } from "../auth";
import { env } from "@trainstack/prehab-env/server";
import { contract } from "@trainstack/prehab-contract";
import type { GeneratedSession } from "@trainstack/prehab-contract";
import {
  OnboardingFlow,
  ProfileAnswerSchema,
  QUESTIONS,
  type QuestionId,
} from "@trainstack/prehab-contract/onboarding";
import { fromNodeHeaders } from "better-auth/node";
import { emitEvent } from "../events/emit.js";
import { DomainEvents } from "../events/types.js";

import { generateWeeklyScaffoldWithAI } from "../services/session-generator";
import { instrumentGenerateObject } from "../services/llm/observability";
import { runDailyGenerationPlayground } from "../services/llm/playground";
import { addDays, daysBetween, getActivePlanId } from "../services/session-context";
import type { SessionGenerationRequest } from "../services/session-generation-job";
// runPlanGeneration is no longer called inline — the start endpoint enqueues
// the worker (PRE-153). Keeping the import surface minimal.
import {
  exercises as exerciseCatalogue,
  exerciseVideoKey,
  exerciseThumbnailKey,
  findExerciseById,
  PLACEHOLDER_VIDEO_KEY,
} from "../services/constants/exercises";
import { planTemplates, findPlanTemplateById } from "../services/constants/plan-templates";
import { getMediaPublicUrl } from "../lib/s3";
import type { ScaffoldItem } from "../services/session-generator";
import {
  buildStructuredIntakeProse,
  derivePrimarySport,
  hydrateProfile,
  loadProfileAnswers,
} from "../services/profile-projection";
import {
  extractIntakeSummary,
  getOrCreatePendingIntakeThread,
  getPendingIntakeThread,
  getThreadForUser,
  seedIntakeGreeting,
  transitionThreadCompleted,
  upsertIntakeSummary,
} from "../services/coach";

// ── Context ────────────────────────────────────────────────────────────────

export interface RPCContext {
  headers: IncomingHttpHeaders;
}

type IncomingHttpHeaders = import("node:http").IncomingHttpHeaders;

export async function createContext(headers: IncomingHttpHeaders) {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(headers),
  });
  return {
    auth: null,
    session,
  };
}

type Context = Awaited<ReturnType<typeof createContext>>;

// ── Server instance ────────────────────────────────────────────────────────

const os = implement(contract).$context<Context>();

// ── Middleware ──────────────────────────────────────────────────────────────

const authMiddleware = os.middleware(async ({ context, next }) => {
  if (!context.session?.user) {
    throw new ORPCError("UNAUTHORIZED");
  }
  return next({
    context: {
      session: context.session,
    },
  });
});

// Staff gate (PRE-129). Fails closed: an empty/unset ADMIN_EMAILS means nobody
// is an admin. Email match is case-insensitive. The single source of truth for
// who can reach the internal admin surface + LLM playground.
function adminEmailSet(): Set<string> {
  return new Set(
    (env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

const adminMiddleware = os.middleware(async ({ context, next }) => {
  if (!context.session?.user) {
    throw new ORPCError("UNAUTHORIZED");
  }
  if (!adminEmailSet().has(context.session.user.email.toLowerCase())) {
    throw new ORPCError("FORBIDDEN", { message: "Admin access required." });
  }
  return next({
    context: {
      session: context.session,
    },
  });
});

// ── Helpers ────────────────────────────────────────────────────────────────
// Date + plan-arc helpers (addDays, daysBetween, computeAge, getActivePlanId,
// getActivePlanArc, SCAFFOLD_WINDOW_DAYS) now live in services/session-context
// so the async generation worker shares one source of truth (PRE-138).

// ── Handlers ───────────────────────────────────────────────────────────────

const healthCheck = os.healthCheck.handler(() => "OK" as const);

const privateData = os.privateData.use(authMiddleware).handler(({ context }) => ({
  message: "This is private",
  user: context.session?.user,
}));

const waitlistSubscribe = os.waitlist.subscribe.handler(async ({ input }) => {
  try {
    const inserted = await db
      .insert(waitlist)
      .values({ email: input.email })
      .onConflictDoNothing()
      .returning({ id: waitlist.id });

    // Only queue confirmation for new signups (idempotent)
    if (inserted.length > 0) {
      await emitEvent(DomainEvents.WAITLIST_SIGNUP, { email: input.email });
    }
  } catch {
    throw new ORPCError("INTERNAL_SERVER_ERROR");
  }
  return { ok: true };
});

const getSessionById = os.sessions.getById
  .use(authMiddleware)
  .handler(async ({ input, context }) => {
    const userId = context.session.user.id;

    const rows = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, input.id), eq(sessions.userId, userId)));

    if (rows.length === 0) {
      throw new ORPCError("NOT_FOUND", { message: "Session not found." });
    }

    const row = rows[0]!;
    // A `pending`/`generating`/`failed` row has no exercises yet (the column
    // defaults to []), so read defensively — the client polls until `ready`.
    const exerciseData = (row.exercises ?? {}) as Partial<GeneratedSession>;

    return {
      id: row.id,
      sessionDate: row.sessionDate,
      status: row.status,
      generationError: row.generationError ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      dropOffExerciseIndex: row.dropOffExerciseIndex,
      skippedExercises: (row.skippedExercises as number[]) ?? [],
      title: exerciseData.title ?? "",
      estimatedDurationMin: exerciseData.estimatedDurationMin ?? 0,
      reasoningShort: exerciseData.reasoningShort ?? null,
      reasoningLong: exerciseData.reasoningLong ?? null,
      exercises: resolveVideoUrls(exerciseData.exercises ?? []),
    };
  });

const generateWeeklyScaffold = os.sessions.generateWeeklyScaffold
  .use(authMiddleware)
  .handler(async ({ input, context }) => {
    const userId = context.session.user.id;
    const { startDate, daysAhead } = input;

    const profile = await hydrateProfile(userId);
    if (!profile) {
      throw new ORPCError("NOT_FOUND", {
        message: "Sport profile not found. Complete onboarding first.",
      });
    }

    const intakeSummaryRows = await db
      .select()
      .from(intakeSummaries)
      .where(eq(intakeSummaries.userId, userId));
    const intakeSummary = (intakeSummaryRows[0]?.summary as never) ?? null;

    const schedule: ScaffoldItem[] = await generateWeeklyScaffoldWithAI(
      {
        sport: profile.primarySport,
        trainingVolumeHrs: profile.trainingVolumeHrsPerWeek,
        startDate,
        daysAhead,
        goals: profile.goals,
        focusAreas: profile.focusAreas,
        sportTimeBreakdown: profile.sportTimeBreakdown,
        intakeSummary,
      },
      instrumentGenerateObject({ endpoint: "weekly_scaffold", userId }),
    );

    if (schedule.length > 0) {
      // Attach to the active plan (if any) so the calendar stays owned by the
      // plan that getActive returns. Null when the user has no plan yet (e.g.
      // skipped the Coach intake) — the home plan band shows its invite then.
      const activePlanId = await getActivePlanId(userId);
      await db
        .insert(programSchedule)
        .values(
          schedule.map((item) => ({
            userId,
            planId: activePlanId,
            date: item.date,
            sessionTheme: item.sessionTheme,
            sessionType: item.sessionType,
          })),
        )
        .onConflictDoNothing();
    }

    return { daysScheduled: schedule.length };
  });

// Submit (PRE-138): insert a `pending` session row and enqueue generation on
// the worker, returning a job handle immediately. The slow work — scaffold
// fill, context gathering, and the LLM call — runs in
// services/session-generation-job via the worker. The client polls
// `sessions.getById` / watches the agenda (which carries `status`) until the
// row reaches `ready` / `failed`.
const generateDailySession = os.sessions.generateDailySession
  .use(authMiddleware)
  .handler(async ({ input, context }) => {
    const userId = context.session.user.id;
    const { sessionDate, readiness, sessionType } = input;

    // 1. Idempotent: a live (non-archived) `daily` session for today already
    //    owns the slot — return its handle whatever its status (the client
    //    polls it). Multiple sessions per day are native (PRE-145), so this is
    //    scoped to `daily` + non-archived.
    const existing = await db
      .select({ id: sessions.id, sessionDate: sessions.sessionDate, status: sessions.status })
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, userId),
          eq(sessions.sessionDate, sessionDate),
          eq(sessions.source, "daily"),
          isNull(sessions.archivedAt),
        ),
      );

    if (existing.length > 0) {
      const row = existing[0]!;
      return { id: row.id, sessionDate: row.sessionDate, status: row.status };
    }

    // 2. Fail fast if the user hasn't onboarded — don't enqueue a job that's
    //    guaranteed to fail. (The worker re-hydrates; this is just early UX.)
    const profile = await hydrateProfile(userId);
    if (!profile) {
      throw new ORPCError("NOT_FOUND", {
        message: "Sport profile not found. Complete onboarding first.",
      });
    }

    // 3. Insert the pending row + enqueue generation atomically. The request
    //    params are stashed on generationContext so the worker is self-contained
    //    from just the row id. Daily auto-generate uses the lean tap-through path.
    const request: SessionGenerationRequest = { readiness, sessionType, lean: true };

    const sessionRow = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(sessions)
        .values({
          userId,
          sessionDate,
          status: "pending",
          source: sessionType ? "on_demand" : "daily",
          exercises: [],
          generationContext: { request },
        })
        .returning({ id: sessions.id, sessionDate: sessions.sessionDate, status: sessions.status });

      const row = inserted[0];
      if (!row) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to enqueue session." });
      }

      await emitEvent(
        DomainEvents.SESSION_GENERATION_REQUESTED,
        { sessionId: row.id },
        // A few retries cover transient model/network blips; the lean path has
        // no in-call fallback. After the last one the handler marks the row
        // `failed`. jobKey de-dupes if the request is somehow fired twice.
        { tx, maxAttempts: 3, jobKey: `session-gen:${row.id}` },
      );

      return row;
    });

    return { id: sessionRow.id, sessionDate: sessionRow.sessionDate, status: sessionRow.status };
  });

// Regenerate (PRE-138 async): archive the live daily row and enqueue a fresh
// `pending` one in its place, returning the new handle immediately. Append +
// archive happens up front (PRE-145 lineage) so the timeline swaps the old card
// for the new "generating" one; the worker fills it in. Regenerate keeps the
// full two-model fallback (lean: false) — it's an explicit, quality-sensitive
// redo, not the tap-through path.
const regenerateDailySession = os.sessions.regenerateDailySession
  .use(authMiddleware)
  .handler(async ({ input, context }) => {
    const userId = context.session.user.id;
    const { sessionDate, readiness, sessionType, regenerationNote } = input;

    // 1. Find the live daily session for today (multiple-per-day is native now,
    //    so scope to source='daily' and non-archived rows).
    const existing = await db
      .select({
        id: sessions.id,
        completedAt: sessions.completedAt,
        dropOffExerciseIndex: sessions.dropOffExerciseIndex,
      })
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, userId),
          eq(sessions.sessionDate, sessionDate),
          eq(sessions.source, "daily"),
          isNull(sessions.archivedAt),
        ),
      );

    const previousRow = existing[0] ?? null;

    if (previousRow) {
      if (previousRow.completedAt) {
        throw new ORPCError("PRECONDITION_FAILED", {
          message: "Cannot regenerate a completed session.",
        });
      }

      if (previousRow.dropOffExerciseIndex && previousRow.dropOffExerciseIndex > 0) {
        throw new ORPCError("PRECONDITION_FAILED", {
          message: "Cannot regenerate a session that is in progress. Finish or restart.",
        });
      }
    }

    // 2. Fail fast if not onboarded (the worker re-hydrates).
    const profile = await hydrateProfile(userId);
    if (!profile) {
      throw new ORPCError("NOT_FOUND", {
        message: "Sport profile not found. Complete onboarding first.",
      });
    }

    // 3. Insert the new pending row linked to the one it replaces, archive the
    //    old row, and enqueue — all atomic. The worker reads the request stash
    //    and runs the full-fallback generation.
    const request: SessionGenerationRequest = {
      readiness,
      sessionType,
      regenerationNote,
      lean: false,
    };

    const sessionRow = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(sessions)
        .values({
          userId,
          sessionDate,
          status: "pending",
          source: "daily",
          replacesSessionId: previousRow?.id ?? null,
          exercises: [],
          generationContext: { request },
        })
        .returning({ id: sessions.id, sessionDate: sessions.sessionDate, status: sessions.status });

      const row = inserted[0];
      if (!row) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Failed to enqueue regenerated session.",
        });
      }

      if (previousRow) {
        await tx
          .update(sessions)
          .set({ archivedAt: new Date() })
          .where(eq(sessions.id, previousRow.id));
      }

      await emitEvent(
        DomainEvents.SESSION_GENERATION_REQUESTED,
        { sessionId: row.id },
        { tx, maxAttempts: 3, jobKey: `session-gen:${row.id}` },
      );

      return row;
    });

    return { id: sessionRow.id, sessionDate: sessionRow.sessionDate, status: sessionRow.status };
  });

const updateProgress = os.sessions.updateProgress
  .use(authMiddleware)
  .handler(async ({ input, context }) => {
    const userId = context.session.user.id;
    const { sessionId, dropOffExerciseIndex } = input;

    const existing = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));

    if (existing.length === 0) {
      throw new ORPCError("NOT_FOUND", { message: "Session not found." });
    }

    await db.update(sessions).set({ dropOffExerciseIndex }).where(eq(sessions.id, sessionId));

    return { ok: true };
  });

const skipExercise = os.sessions.skipExercise
  .use(authMiddleware)
  .handler(async ({ input, context }) => {
    const userId = context.session.user.id;
    const { sessionId, exerciseIndex } = input;

    const existing = await db
      .select({ id: sessions.id, skippedExercises: sessions.skippedExercises })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));

    if (existing.length === 0) {
      throw new ORPCError("NOT_FOUND", { message: "Session not found." });
    }

    const currentSkipped = (existing[0]!.skippedExercises as number[]) ?? [];
    if (!currentSkipped.includes(exerciseIndex)) {
      currentSkipped.push(exerciseIndex);
    }

    await db
      .update(sessions)
      .set({ skippedExercises: currentSkipped })
      .where(eq(sessions.id, sessionId));

    return { ok: true };
  });

const completeSession = os.sessions.complete
  .use(authMiddleware)
  .handler(async ({ input, context }) => {
    const userId = context.session.user.id;
    const { sessionId, feedbackRating, feedbackTags, feedbackComment } = input;

    const existing = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));

    if (existing.length === 0) {
      throw new ORPCError("NOT_FOUND", { message: "Session not found." });
    }

    await db
      .update(sessions)
      .set({
        completedAt: new Date(),
        feedbackRating,
        feedbackTags,
        feedbackComment,
      })
      .where(eq(sessions.id, sessionId));

    return { ok: true };
  });

const logCapacity = os.sessions.logCapacity
  .use(authMiddleware)
  .handler(async ({ input, context }) => {
    const userId = context.session.user.id;
    const { sessionId, capacityRatingsAfter } = input;

    const existing = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));

    if (existing.length === 0) {
      throw new ORPCError("NOT_FOUND", { message: "Session not found." });
    }

    // PRE-36 will reshape capacity_logs for v2. For now we record the post-session
    // re-rating as-is; `capacityRatingsBefore` is empty (no initial rating in v2).
    await db.insert(capacityLogs).values({
      userId,
      sessionId,
      capacityRatingsBefore: {},
      capacityRatingsAfter,
    });

    return { ok: true };
  });

const acknowledgeRestDay = os.sessions.acknowledgeRestDay
  .use(authMiddleware)
  .handler(async ({ input, context }) => {
    const userId = context.session.user.id;
    const { sessionDate } = input;

    // Idempotent: return existing rest day session if already created. The rest
    // day occupies the user's daily slot, so scope to source='daily' + live rows.
    const existing = await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, userId),
          eq(sessions.sessionDate, sessionDate),
          eq(sessions.source, "daily"),
          isNull(sessions.archivedAt),
        ),
      );

    if (existing.length > 0) {
      const row = existing[0]!;
      return {
        id: row.id,
        sessionDate: row.sessionDate,
        isRestDay: true as const,
      };
    }

    // Verify capacity ratings actually warrant a rest day
    // Self-declared rest day — user-initiated. No precondition (PRE-36 may add a
    // readiness-based check; v2 doesn't have a per-region capacity signal).

    // Create a rest day session (no exercises, auto-completed)
    const inserted = await db
      .insert(sessions)
      .values({
        userId,
        sessionDate,
        status: "ready",
        source: "daily",
        exercises: {
          title: "Rest Day",
          estimatedDurationMin: 0,
          reasoningShort: null,
          reasoningLong: null,
          exercises: [],
        },
        isRestDay: true,
        completedAt: new Date(),
      })
      .returning();

    const row = inserted[0];

    if (!row) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Failed to persist rest day.",
      });
    }

    return {
      id: row.id,
      sessionDate: row.sessionDate,
      isRestDay: true as const,
    };
  });

const streak = os.sessions.streak.use(authMiddleware).handler(async ({ context }) => {
  const userId = context.session.user.id;

  // Fetch all completed session dates + rest day flag, newest first
  const completedRows = await db
    .select({
      sessionDate: sessions.sessionDate,
      isRestDay: sessions.isRestDay,
    })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNotNull(sessions.completedAt)))
    .orderBy(desc(sessions.sessionDate));

  if (completedRows.length === 0) return { currentStreak: 0 };

  const completedDates = new Set(completedRows.map((r) => r.sessionDate));
  const restDayDates = new Set(completedRows.filter((r) => r.isRestDay).map((r) => r.sessionDate));

  // Count consecutive days backwards from the most recent completed date.
  // Rest days don't count toward the streak number but don't break it either.
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0] as string;

  let checkDate = completedDates.has(todayStr) ? today : new Date(today.getTime() - 86400000);

  let currentStreak = 0;
  while (true) {
    const dateStr = checkDate.toISOString().split("T")[0] as string;
    if (!completedDates.has(dateStr)) break;
    // Rest days preserve the streak but don't increment the count
    if (!restDayDates.has(dateStr)) {
      currentStreak++;
    }
    checkDate = new Date(checkDate.getTime() - 86400000);
  }

  return { currentStreak };
});

const getAgenda = os.sessions.getAgenda.use(authMiddleware).handler(async ({ input, context }) => {
  const userId = context.session.user.id;
  const { startDate, endDate } = input;

  const sessionRows = await db
    .select({
      id: sessions.id,
      sessionDate: sessions.sessionDate,
      status: sessions.status,
      source: sessions.source,
      completedAt: sessions.completedAt,
      isRestDay: sessions.isRestDay,
      exercises: sessions.exercises,
      dropOffExerciseIndex: sessions.dropOffExerciseIndex,
      createdAt: sessions.createdAt,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        gte(sessions.sessionDate, startDate),
        lt(sessions.sessionDate, endDate),
        // Archived rows (superseded by regeneration) are kept for lineage but
        // never shown on the day view.
        isNull(sessions.archivedAt),
      ),
    )
    .orderBy(asc(sessions.createdAt));

  const scheduleRows = await db
    .select({
      date: programSchedule.date,
      sessionTheme: programSchedule.sessionTheme,
      sessionType: programSchedule.sessionType,
      title: programSchedule.title,
      estimatedDurationMin: programSchedule.estimatedDurationMin,
    })
    .from(programSchedule)
    .where(
      and(
        eq(programSchedule.userId, userId),
        gte(programSchedule.date, startDate),
        lt(programSchedule.date, endDate),
      ),
    );

  // Fetch check-ins for the date range to get readiness
  const checkInRows = await db
    .select({
      checkInDate: dailyCheckIns.checkInDate,
      readiness: dailyCheckIns.readiness,
    })
    .from(dailyCheckIns)
    .where(
      and(
        eq(dailyCheckIns.userId, userId),
        gte(dailyCheckIns.checkInDate, startDate),
        lt(dailyCheckIns.checkInDate, endDate),
      ),
    );
  const checkInByDate = new Map(checkInRows.map((r) => [r.checkInDate, r.readiness]));

  return {
    sessions: sessionRows.map((row) => {
      const exerciseData = row.exercises as GeneratedSession | null;
      return {
        id: row.id,
        sessionDate: row.sessionDate,
        status: row.status,
        completedAt: row.completedAt?.toISOString() ?? null,
        isRestDay: row.isRestDay,
        title: exerciseData?.title ?? "Session",
        estimatedDurationMin: exerciseData?.estimatedDurationMin ?? 0,
        exerciseCount: exerciseData?.exercises?.length ?? 0,
        sessionType:
          (scheduleRows.find((s) => s.date === row.sessionDate)?.sessionType as
            | "prehab"
            | "recovery"
            | "mobility"
            | "activation"
            | null) ?? null,
        readiness: (checkInByDate.get(row.sessionDate) as "low" | "normal" | "high" | null) ?? null,
        source: row.source,
        completedAtTime: row.completedAt
          ? `${String(row.completedAt.getHours()).padStart(2, "0")}:${String(row.completedAt.getMinutes()).padStart(2, "0")}`
          : null,
        exercisesCompleted: row.dropOffExerciseIndex != null ? row.dropOffExerciseIndex + 1 : 0,
      };
    }),
    schedule: scheduleRows.map((row) => ({
      date: row.date,
      sessionTheme: row.sessionTheme,
      sessionType: row.sessionType,
      // Pre-generation fields (PRE-145): render a day's title/length before any
      // exercises exist. Null on AI-scaffolded days that predate plan templates.
      title: row.title,
      estimatedDurationMin: row.estimatedDurationMin,
    })),
  };
});

// ── Sport profile ─────────────────────────────────────────────────────────

const sportProfileGet = os.sportProfile.get.use(authMiddleware).handler(async ({ context }) => {
  const userId = context.session.user.id;
  const rows = await db.select().from(sportProfiles).where(eq(sportProfiles.userId, userId));

  const row = rows[0];
  if (!row) return { profile: null };

  return {
    profile: {
      primarySport: row.primarySport,
      preferredSessionTime: row.preferredSessionTime,
      onboardingCompletedAt: row.onboardingCompletedAt?.toISOString() ?? null,
      planRevealSeenAt: row.planRevealSeenAt?.toISOString() ?? null,
    },
  };
});

/**
 * Ensures a slim `sport_profiles` row exists for the user. Creates one with
 * defaults on first call so downstream upserts to `primarySport` /
 * `preferredSessionTime` / `onboardingCompletedAt` can use a plain UPDATE.
 */
async function ensureSportProfileRow(userId: string): Promise<void> {
  await db.insert(sportProfiles).values({ userId }).onConflictDoNothing();
}

async function regenerateIntakeSummaryProse(userId: string): Promise<void> {
  const answers = await loadProfileAnswers(userId);
  const prose = buildStructuredIntakeProse(answers);
  if (prose.length === 0) return;
  await db
    .insert(intakeSummaries)
    .values({
      userId,
      threadId: null,
      summary: { structuredIntakeProse: prose },
    })
    .onConflictDoUpdate({
      target: intakeSummaries.userId,
      set: {
        // Keep an existing thread link if the Coach has already extracted a
        // richer summary — only overwrite the prose half here.
        summary: { structuredIntakeProse: prose },
        extractedAt: new Date(),
      },
    });
}

const sportProfileSavePartial = os.sportProfile.savePartial
  .use(authMiddleware)
  .handler(async ({ input, context }) => {
    const userId = context.session.user.id;
    const { questionId } = input;

    const meta = (QUESTIONS as Record<string, (typeof QUESTIONS)[QuestionId]>)[questionId];
    if (!meta || meta.version !== input.version) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Unknown or stale (questionId, version): ${questionId}@${input.version}`,
      });
    }

    if (input.status === "skipped") {
      if (!meta.skippable) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Question ${questionId} is not skippable.`,
        });
      }
    } else {
      const parsed = ProfileAnswerSchema.safeParse({
        questionId,
        value: input.value,
      });
      if (!parsed.success) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Invalid answer for ${questionId}: ${parsed.error.message}`,
        });
      }
    }

    await ensureSportProfileRow(userId);

    await db
      .insert(profileAnswers)
      .values({
        userId,
        questionId,
        version: input.version,
        status: input.status,
        value: input.status === "answered" ? (input.value as object) : null,
        recordedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [profileAnswers.userId, profileAnswers.questionId],
        set: {
          version: input.version,
          status: input.status,
          value: input.status === "answered" ? (input.value as object) : null,
          recordedAt: new Date(),
        },
      });

    // ── Slim projection updates ─────────────────────────────────────────
    if (input.status === "answered") {
      if (questionId === "sports" || questionId === "sport-time") {
        const answers = await loadProfileAnswers(userId);
        const sports =
          (answers.sports?.status === "answered" ? (answers.sports.value as string[]) : []) ?? [];
        const breakdown =
          (answers["sport-time"]?.status === "answered"
            ? (answers["sport-time"].value as Record<string, string>)
            : {}) ?? {};
        const primary = derivePrimarySport(sports, breakdown);
        await db
          .update(sportProfiles)
          .set({ primarySport: primary })
          .where(eq(sportProfiles.userId, userId));
      } else if (questionId === "preferred-time") {
        await db
          .update(sportProfiles)
          .set({ preferredSessionTime: input.value as string })
          .where(eq(sportProfiles.userId, userId));
      } else if (questionId === "disclaimer") {
        await db
          .update(sportProfiles)
          .set({ onboardingCompletedAt: new Date() })
          .where(eq(sportProfiles.userId, userId));

        // Canonical end-of-onboarding moment (PRE-152): sport_profiles row
        // exists, all structured answers are in, intake_summaries is populated.
        // Enqueue async plan generation; the worker handles retries. jobKey
        // de-dupes repeat enqueues (e.g. user re-answers disclaimer).
        await emitEvent(
          DomainEvents.PLAN_GENERATION_REQUESTED,
          { userId, today: serverToday() },
          { maxAttempts: 5, jobKey: `plan-gen:${userId}` },
        );
      }
    } else if (questionId === "preferred-time") {
      // Skipping the preferred-time question clears any prior value.
      await db
        .update(sportProfiles)
        .set({ preferredSessionTime: null })
        .where(eq(sportProfiles.userId, userId));
    }

    // ── Intake-summary regeneration ─────────────────────────────────────
    // The Coach reads a natural-language projection of structured intake
    // instead of a typed bag, so we refresh it on every relevant change.
    if (questionId !== "welcome" && questionId !== "notifications") {
      await regenerateIntakeSummaryProse(userId);
    }

    const slimRows = await db
      .select({ onboardingCompletedAt: sportProfiles.onboardingCompletedAt })
      .from(sportProfiles)
      .where(eq(sportProfiles.userId, userId));
    const completedAt = slimRows[0]?.onboardingCompletedAt ?? null;

    return { ok: true, onboardingCompletedAt: completedAt?.toISOString() ?? null };
  });

const sportProfileResumePoint = os.sportProfile.resumePoint
  .use(authMiddleware)
  .handler(async ({ context }) => {
    const userId = context.session.user.id;
    const answers = await loadProfileAnswers(userId);

    let next: string | null = null;
    for (const id of OnboardingFlow) {
      if (!answers[id]) {
        next = id;
        break;
      }
    }

    // Map answers → questionId: value (status "answered" only — skipped
    // restoration is handled by re-asking and the user re-skipping if they
    // want).
    const answeredValues: Record<string, unknown> = {};
    for (const [id, rec] of Object.entries(answers)) {
      if (rec.status === "answered") answeredValues[id] = rec.value;
    }

    return { questionId: next, flowVersion: 1, answers: answeredValues };
  });

const sportProfileSetPreferredTime = os.sportProfile.setPreferredTime
  .use(authMiddleware)
  .handler(async ({ input, context }) => {
    const userId = context.session.user.id;
    const updated = await db
      .update(sportProfiles)
      .set({ preferredSessionTime: input.preferredSessionTime })
      .where(eq(sportProfiles.userId, userId))
      .returning({ id: sportProfiles.id });

    if (updated.length === 0) {
      throw new ORPCError("NOT_FOUND", {
        message: "Sport profile not found. Complete onboarding first.",
      });
    }

    return { ok: true };
  });

// ── Check-ins ─────────────────────────────────────────────────────────────

const checkInSave = os.checkIn.save.use(authMiddleware).handler(async ({ input, context }) => {
  const userId = context.session.user.id;
  const { date: checkInDate, readiness, note } = input;

  const inserted = await db
    .insert(dailyCheckIns)
    .values({
      userId,
      checkInDate,
      readiness,
      note: note ?? null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [dailyCheckIns.userId, dailyCheckIns.checkInDate],
      set: {
        readiness,
        note: note ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();

  const row = inserted[0]!;
  return {
    id: row.id,
    checkInDate: row.checkInDate,
    readiness: row.readiness as "low" | "normal" | "high",
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
});

const checkInGet = os.checkIn.get.use(authMiddleware).handler(async ({ input, context }) => {
  const userId = context.session.user.id;

  const rows = await db
    .select()
    .from(dailyCheckIns)
    .where(and(eq(dailyCheckIns.userId, userId), eq(dailyCheckIns.checkInDate, input.date)));

  const row = rows[0];
  if (!row) return { checkIn: null };

  return {
    checkIn: {
      id: row.id,
      checkInDate: row.checkInDate,
      readiness: row.readiness as "low" | "normal" | "high",
      note: row.note,
      createdAt: row.createdAt.toISOString(),
    },
  };
});

const checkInList = os.checkIn.list.use(authMiddleware).handler(async ({ input, context }) => {
  const userId = context.session.user.id;
  const { startDate, endDate } = input;

  const rows = await db
    .select()
    .from(dailyCheckIns)
    .where(
      and(
        eq(dailyCheckIns.userId, userId),
        gte(dailyCheckIns.checkInDate, startDate),
        lt(dailyCheckIns.checkInDate, endDate),
      ),
    );

  return {
    checkIns: rows.map((row) => ({
      id: row.id,
      checkInDate: row.checkInDate,
      readiness: row.readiness as "low" | "normal" | "high",
      note: row.note,
      createdAt: row.createdAt.toISOString(),
    })),
  };
});

// ── Session templates ─────────────────────────────────────────────────────

const listSessionTemplates = os.sessionTemplates.list.handler(async () => {
  const rows = await db
    .select({
      id: sessionTemplates.id,
      title: sessionTemplates.title,
      description: sessionTemplates.description,
      category: sessionTemplates.category,
      sportTags: sessionTemplates.sportTags,
      estimatedDurationMin: sessionTemplates.estimatedDurationMin,
      exerciseCount: sessionTemplates.exerciseCount,
    })
    .from(sessionTemplates)
    .orderBy(asc(sessionTemplates.sortOrder));

  return {
    templates: rows.map((r) => ({
      ...r,
      sportTags: r.sportTags as string[],
    })),
  };
});

const getSessionTemplate = os.sessionTemplates.get.handler(async ({ input }) => {
  const rows = await db.select().from(sessionTemplates).where(eq(sessionTemplates.id, input.id));

  if (rows.length === 0) {
    throw new ORPCError("NOT_FOUND", { message: "Session template not found." });
  }

  const row = rows[0]!;
  const exerciseData = row.exercises as GeneratedSession;

  return {
    id: row.id,
    title: exerciseData.title,
    description: row.description,
    category: row.category,
    sportTags: row.sportTags as string[],
    estimatedDurationMin: exerciseData.estimatedDurationMin,
    exercises: resolveVideoUrls(exerciseData.exercises),
  };
});

const startSessionTemplate = os.sessionTemplates.start
  .use(authMiddleware)
  .handler(async ({ input, context }) => {
    const userId = context.session.user.id;
    const { templateId, sessionDate } = input;

    // Fetch template
    const templateRows = await db
      .select()
      .from(sessionTemplates)
      .where(eq(sessionTemplates.id, templateId));

    if (templateRows.length === 0) {
      throw new ORPCError("NOT_FOUND", { message: "Session template not found." });
    }

    const template = templateRows[0]!;
    const exerciseData = template.exercises as GeneratedSession;

    // Insert a user session from the template (multiple sessions per day are allowed)
    const inserted = await db
      .insert(sessions)
      .values({
        userId,
        sessionDate,
        status: "ready",
        source: "template",
        exercises: exerciseData,
        generationContext: { source: "template", templateId },
      })
      .returning();

    const sessionRow = inserted[0];

    if (!sessionRow) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Failed to create session from template.",
      });
    }

    const session = sessionRow.exercises as GeneratedSession;

    return {
      id: sessionRow.id,
      sessionDate: sessionRow.sessionDate,
      completedAt: sessionRow.completedAt?.toISOString() ?? null,
      dropOffExerciseIndex: sessionRow.dropOffExerciseIndex,
      title: session.title,
      estimatedDurationMin: session.estimatedDurationMin,
      reasoningShort: session.reasoningShort ?? null,
      reasoningLong: session.reasoningLong ?? null,
      exercises: resolveVideoUrls(session.exercises),
    };
  });

// ── Video URL resolution ─────────────────────────────────────────────────
// Sessions store videoUrl in JSONB at generation time. Re-resolve at read time
// so old sessions don't serve stale CDN URLs.

function resolveVideoUrls(exercises: GeneratedSession["exercises"]): GeneratedSession["exercises"] {
  return exercises.map((ex) => {
    const catalogueEx = findExerciseById(ex.id);
    const videoKey = catalogueEx ? exerciseVideoKey(catalogueEx) : PLACEHOLDER_VIDEO_KEY;
    return { ...ex, videoUrl: getMediaPublicUrl(videoKey) };
  });
}

// ── Exercise catalogue ───────────────────────────────────────────────────

function withVideoAssets(ex: (typeof exerciseCatalogue)[number]) {
  const demoUrl = getMediaPublicUrl(exerciseVideoKey(ex));
  const thumbnailUrl = getMediaPublicUrl(exerciseThumbnailKey(ex.id));
  return { ...ex, demoUrl, thumbnailUrl };
}

const listExercises = os.exercises.list.handler(async ({ input }) => {
  let filtered = exerciseCatalogue;

  if (input?.muscleGroup) {
    filtered = filtered.filter((ex) => ex.muscleGroup === input.muscleGroup);
  }
  if (input?.sportTag) {
    filtered = filtered.filter((ex) => ex.sportTags.includes(input.sportTag!));
  }

  return { exercises: filtered.map(withVideoAssets) };
});

const getExercise = os.exercises.get.handler(async ({ input }) => {
  const exercise = exerciseCatalogue.find((ex) => ex.id === input.id);
  if (!exercise) {
    throw new ORPCError("NOT_FOUND", { message: "Exercise not found." });
  }
  return withVideoAssets(exercise);
});

// ── Coach (intake chat) ───────────────────────────────────────────────────

function serializeThread(thread: {
  id: string;
  type: string;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  flaggedForReviewAt: Date | null;
}) {
  return {
    id: thread.id,
    type: thread.type as "intake",
    status: thread.status as "pending" | "completed" | "skipped",
    startedAt: thread.startedAt.toISOString(),
    completedAt: thread.completedAt?.toISOString() ?? null,
    flaggedForReviewAt: thread.flaggedForReviewAt?.toISOString() ?? null,
  };
}

const coachStartThread = os.coach.startThread.use(authMiddleware).handler(async ({ context }) => {
  const userId = context.session.user.id;
  const thread = await getOrCreatePendingIntakeThread(userId);
  // Seed the Coach's opening turn on a brand-new thread so the agent greets
  // first instead of waiting for the user (PRE-109). No-op on resume.
  await seedIntakeGreeting(userId, thread.id);
  return { thread: serializeThread(thread) };
});

const coachCurrentIntakeThread = os.coach.currentIntakeThread
  .use(authMiddleware)
  .handler(async ({ context }) => {
    const userId = context.session.user.id;
    const thread = await getPendingIntakeThread(userId);
    return { thread: thread ? serializeThread(thread) : null };
  });

const coachGetThread = os.coach.getThread
  .use(authMiddleware)
  .handler(async ({ input, context }) => {
    const userId = context.session.user.id;
    const record = await getThreadForUser(userId, input.threadId);
    if (!record) {
      throw new ORPCError("NOT_FOUND", { message: "Thread not found." });
    }
    return {
      thread: serializeThread(record.thread),
      messages: record.messages.map((m) => ({
        id: m.id,
        role: m.role as "system" | "user" | "assistant",
        parts: m.parts,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  });

const coachEndThread = os.coach.endThread
  .use(authMiddleware)
  .handler(async ({ input, context }) => {
    const userId = context.session.user.id;
    const record = await getThreadForUser(userId, input.threadId);
    if (!record) {
      throw new ORPCError("NOT_FOUND", { message: "Thread not found." });
    }
    if (record.thread.status === "completed") return { ok: true as const };

    await transitionThreadCompleted(input.threadId);

    // User-initiated end (e.g. "Generate my first session" button) — run the
    // extraction pass so downstream session generation has the intake summary.
    const answers = await loadProfileAnswers(userId);
    const intakeProse = buildStructuredIntakeProse(answers);
    if (intakeProse.length > 0) {
      try {
        const summary = await extractIntakeSummary(
          {
            structuredIntakeProse: intakeProse,
            messages: record.messages.map((m) => ({
              role: m.role as "user" | "assistant" | "system",
              parts: m.parts,
            })),
          },
          instrumentGenerateObject({ endpoint: "intake_extraction", userId }),
        );
        await upsertIntakeSummary(userId, input.threadId, summary);
      } catch {
        // Extraction is best-effort. Session generation falls back to
        // structured intake only when no summary exists.
      }
    }

    // Completing the Coach intake (first onboarding pass or a re-eval) used to
    // run plan generation inline here (PRE-149), which silently swallowed any
    // error — including the race where sport_profiles didn't exist yet (PRE-152).
    // The canonical trigger now lives on the disclaimer-question completion in
    // sportProfile.savePartial; this enqueue is a defensive duplicate for the
    // re-eval path (intake-only flow where the disclaimer isn't re-answered).
    // jobKey de-dupes against the disclaimer enqueue.
    await emitEvent(
      DomainEvents.PLAN_GENERATION_REQUESTED,
      { userId, today: serverToday() },
      { maxAttempts: 5, jobKey: `plan-gen:${userId}` },
    );

    return { ok: true as const };
  });

const coachSkipThread = os.coach.skipThread
  .use(authMiddleware)
  .handler(async ({ input, context }) => {
    const userId = context.session.user.id;
    const record = await getThreadForUser(userId, input.threadId);
    if (!record) {
      throw new ORPCError("NOT_FOUND", { message: "Thread not found." });
    }
    // Skip leaves the thread `pending` so the resume entry is meaningful.
    // `skipped` is reserved for explicit "never want this" — out of scope here.
    return { ok: true as const };
  });

// ── Account ──────────────────────────────────────────────────────────────────

// Days a soft-deleted account stays recoverable. Matches the 30-day window in
// the terms; signing back in within it cancels the deletion (see auth hook).
const GRACE_PERIOD_DAYS = 30;

// Soft-delete: mark the account for deletion and sign the user out everywhere.
// We intentionally do NOT purge any rows here — the user has GRACE_PERIOD_DAYS
// to reactivate by signing back in. The eventual cross-system purge after the
// window is a separate, deferred process (tracked in its own ticket).
const accountDelete = os.account.delete.use(authMiddleware).handler(async ({ context }) => {
  const { id: userId, email, name } = context.session.user;
  const now = new Date();
  const deletionDate = new Date(now.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);

  await db.transaction(async (tx) => {
    await tx.update(user).set({ deletionScheduledAt: now }).where(eq(user.id, userId));
    // Drop every session so the user is signed out on all devices at once.
    await tx.delete(session).where(eq(session.userId, userId));
    await emitEvent(
      DomainEvents.ACCOUNT_DELETION_SCHEDULED,
      { email, name, deletionDate: deletionDate.toISOString() },
      { tx },
    );
  });

  return { ok: true as const, deletionDate: deletionDate.toISOString() };
});

// ── Plans ────────────────────────────────────────────────────────────────

interface PlanRow {
  id: string;
  source: "generated" | "template";
  status: "active" | "completed" | "superseded";
  generationStatus: "pending" | "ready" | "failed";
  startDate: string;
  endDate: string;
  planTemplateId: string | null;
  headline: string | null;
  subtitle: string | null;
  themes: unknown;
  createdAt: Date;
}

// Shape a plan row for the contract, deriving week position from `today`.
function serializePlan(row: PlanRow, today: string) {
  const span = daysBetween(row.startDate, row.endDate);
  const totalWeeks = Math.max(1, Math.ceil(span / 7));
  const elapsed = daysBetween(row.startDate, today);
  const currentWeek = Math.min(Math.max(Math.floor(elapsed / 7) + 1, 1), totalWeeks);
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    generationStatus: row.generationStatus,
    startDate: row.startDate,
    endDate: row.endDate,
    planTemplateId: row.planTemplateId,
    headline: row.headline,
    subtitle: row.subtitle,
    themes: Array.isArray(row.themes) ? (row.themes as string[]) : null,
    createdAt: row.createdAt.toISOString(),
    currentWeek,
    totalWeeks,
  };
}

function serverToday(): string {
  return new Date().toISOString().split("T")[0] as string;
}

const plansGetActive = os.plans.getActive
  .use(authMiddleware)
  .handler(async ({ input, context }) => {
    const userId = context.session.user.id;
    const today = input?.today ?? serverToday();

    const rows = await db
      .select()
      .from(plans)
      .where(and(eq(plans.userId, userId), eq(plans.status, "active")))
      .orderBy(desc(plans.createdAt))
      .limit(1);

    const row = rows[0];
    return { plan: row ? serializePlan(row, today) : null };
  });

const plansList = os.plans.list.use(authMiddleware).handler(async ({ context }) => {
  const userId = context.session.user.id;
  const today = serverToday();

  const rows = await db
    .select()
    .from(plans)
    .where(eq(plans.userId, userId))
    .orderBy(desc(plans.createdAt));

  return { plans: rows.map((row) => serializePlan(row, today)) };
});

// Curated plan templates for Explore › Plans (PRE-144). Served from the code
// catalogue (`constants/plan-templates.ts`) — same code-as-CMS model as the
// exercise catalogue. Public — no auth.
const plansListTemplates = os.plans.listTemplates.handler(async () => {
  return {
    templates: [...planTemplates]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        durationWeeks: t.durationWeeks,
        sessionsPerWeek: t.sessionsPerWeek,
        level: t.level,
        sportTags: t.sportTags,
      })),
  };
});

// Instantiate an active plan from a template (PRE-144): supersede the current
// active plan, then materialize program_schedule rows from the template's weekly
// scaffold under the new plan. All-or-nothing in one transaction.
const plansStartFromTemplate = os.plans.startFromTemplate
  .use(authMiddleware)
  .handler(async ({ input, context }) => {
    const userId = context.session.user.id;
    const today = input.today ?? serverToday();

    const template = findPlanTemplateById(input.templateId);
    if (!template) {
      throw new ORPCError("NOT_FOUND", { message: "Plan template not found." });
    }

    const scaffold = template.scaffold;
    const startDate = today;
    const endDate = addDays(startDate, template.durationWeeks * 7 - 1);

    const planRow = await db.transaction(async (tx) => {
      // Snapshot the currently-active plan(s) before inserting the new one (at
      // most one — app invariant, but handle many defensively).
      const priorActive = await tx
        .select({ id: plans.id })
        .from(plans)
        .where(and(eq(plans.userId, userId), eq(plans.status, "active")));
      const priorActiveIds = priorActive.map((p) => p.id);

      // Insert the new active plan first so superseded plans can point at it.
      const insertedPlans = await tx
        .insert(plans)
        .values({
          userId,
          source: "template",
          status: "active",
          startDate,
          endDate,
          planTemplateId: template.id,
        })
        .returning();
      const newPlan = insertedPlans[0]!;

      if (priorActiveIds.length > 0) {
        // Supersede the prior active plan(s)…
        await tx
          .update(plans)
          .set({ status: "superseded", supersededByPlanId: newPlan.id })
          .where(and(eq(plans.userId, userId), inArray(plans.id, priorActiveIds)));

        // …and clear their *future* schedule so the new plan owns the calendar
        // from its start. Past rows (date < startDate) stay as history.
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

      // Materialize the schedule: one row per (week × scaffold day). The
      // (user, date) unique on program_schedule means a new plan takes over the
      // calendar from its start — upsert rather than collide.
      const scheduleValues = [];
      for (let week = 0; week < template.durationWeeks; week++) {
        for (const day of scaffold.days) {
          scheduleValues.push({
            userId,
            planId: newPlan.id,
            date: addDays(startDate, week * 7 + day.dayOffset),
            sessionTheme: day.sessionTheme,
            sessionType: day.sessionType,
            title: day.title,
            estimatedDurationMin: day.estimatedDurationMin,
          });
        }
      }

      if (scheduleValues.length > 0) {
        await tx
          .insert(programSchedule)
          .values(scheduleValues)
          .onConflictDoUpdate({
            target: [programSchedule.userId, programSchedule.date],
            set: {
              planId: newPlan.id,
              sessionTheme: sql`excluded.session_theme`,
              sessionType: sql`excluded.session_type`,
              title: sql`excluded.title`,
              estimatedDurationMin: sql`excluded.estimated_duration_min`,
            },
          });
      }

      return newPlan;
    });

    return { plan: serializePlan(planRow, today) };
  });

// Explicit retry endpoint (PRE-149/PRE-152/PRE-153). The async worker job is
// the happy path; this RPC enqueues a fresh worker run so the reveal/loading
// screen's "Try again" CTA can re-trigger after a terminal failure. Returns
// the (possibly still-pending) plan row so the screen keeps polling.
const plansStartGenerated = os.plans.startGenerated
  .use(authMiddleware)
  .handler(async ({ input, context }) => {
    const userId = context.session.user.id;
    const today = input?.today ?? serverToday();

    // Reset any prior `failed` row back to `pending` so the worker has a clean
    // slate to write into and the client polls don't briefly read `failed`
    // before the worker picks up.
    await db
      .update(plans)
      .set({ generationStatus: "pending", generationError: null })
      .where(
        and(
          eq(plans.userId, userId),
          eq(plans.status, "active"),
          eq(plans.generationStatus, "failed"),
        ),
      );

    await emitEvent(
      DomainEvents.PLAN_GENERATION_REQUESTED,
      { userId, today },
      { maxAttempts: 5, jobKey: `plan-gen:${userId}` },
    );

    const rows = await db
      .select()
      .from(plans)
      .where(and(eq(plans.userId, userId), eq(plans.status, "active")))
      .orderBy(desc(plans.createdAt))
      .limit(1);
    const row = rows[0];

    if (!row) {
      // No row yet — the worker will insert it. Give the client a synthetic
      // pending shape so it can start polling immediately.
      throw new ORPCError("NOT_FOUND", {
        message: "Plan generation enqueued; poll plans.getRevealState.",
      });
    }
    return { plan: serializePlan(row, today) };
  });

// Polling endpoint for the post-Coach reveal flow (PRE-153). One round-trip
// covers everything the loading/reveal screens need to advance: the plan's
// generation status (so the "Building your plan…" screen can hand off to the
// reveal), and the first daily session's status (so the sneak-peek card can
// fill in and the CTA can enable).
const plansGetRevealState = os.plans.getRevealState
  .use(authMiddleware)
  .handler(async ({ input, context }) => {
    const userId = context.session.user.id;
    const today = input?.today ?? serverToday();

    const planRows = await db
      .select()
      .from(plans)
      .where(and(eq(plans.userId, userId), eq(plans.status, "active")))
      .orderBy(desc(plans.createdAt))
      .limit(1);
    const planRow = planRows[0] ?? null;

    let firstSession: {
      id: string;
      status: "pending" | "generating" | "ready" | "failed";
      sessionDate: string;
      title: string | null;
      estimatedDurationMin: number | null;
      exerciseCount: number;
      sessionTheme: string | null;
      sessionType: "prehab" | "recovery" | "mobility" | "activation" | null;
    } | null = null;

    if (planRow) {
      const sessionRows = await db
        .select({
          id: sessions.id,
          status: sessions.status,
          sessionDate: sessions.sessionDate,
          exercises: sessions.exercises,
        })
        .from(sessions)
        .where(
          and(
            eq(sessions.userId, userId),
            eq(sessions.sessionDate, today),
            eq(sessions.source, "daily"),
            isNull(sessions.archivedAt),
          ),
        )
        .orderBy(desc(sessions.createdAt))
        .limit(1);
      let sessionRow = sessionRows[0];

      // Self-heal the reveal funnel. The CTA is gated on today's daily session,
      // but the only thing that normally creates it is the plan-generation job,
      // which runs once — on the day the plan is generated. A user who reaches
      // this screen on any later day (plan already `ready`, reveal never marked
      // seen) would otherwise have no session for `today`, so `firstSession`
      // stays null and the spinner never resolves. If the plan is ready and no
      // live daily row exists for today, enqueue one here. Idempotent: the
      // select above guards repeat inserts within a poll, and the session-gen
      // jobKey de-dupes the generation job.
      if (!sessionRow && planRow.generationStatus === "ready") {
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
          .returning({
            id: sessions.id,
            status: sessions.status,
            sessionDate: sessions.sessionDate,
            exercises: sessions.exercises,
          });
        const row = inserted[0];
        if (row) {
          await emitEvent(
            DomainEvents.SESSION_GENERATION_REQUESTED,
            { sessionId: row.id },
            { maxAttempts: 3, jobKey: `session-gen:${row.id}` },
          );
          sessionRow = row;
        }
      }

      const scheduleRows = await db
        .select({
          sessionTheme: programSchedule.sessionTheme,
          sessionType: programSchedule.sessionType,
        })
        .from(programSchedule)
        .where(and(eq(programSchedule.userId, userId), eq(programSchedule.date, today)))
        .limit(1);
      const scheduleRow = scheduleRows[0];

      if (sessionRow) {
        const exerciseData = sessionRow.exercises as GeneratedSession | null;
        firstSession = {
          id: sessionRow.id,
          status: sessionRow.status as "pending" | "generating" | "ready" | "failed",
          sessionDate: sessionRow.sessionDate,
          title: exerciseData?.title ?? scheduleRow?.sessionTheme ?? null,
          estimatedDurationMin: exerciseData?.estimatedDurationMin ?? null,
          exerciseCount: exerciseData?.exercises?.length ?? 0,
          sessionTheme: scheduleRow?.sessionTheme ?? null,
          sessionType:
            (scheduleRow?.sessionType as
              | "prehab"
              | "recovery"
              | "mobility"
              | "activation"
              | null) ?? null,
        };
      }
    }

    return {
      plan: planRow ? serializePlan(planRow, today) : null,
      firstSession,
    };
  });

// "What you told us" recap for the reveal screen (PRE-153). Structured user
// answers only — no LLM. Fetched once; getRevealState polls the changing bits.
const plansGetRevealRecap = os.plans.getRevealRecap
  .use(authMiddleware)
  .handler(async ({ context }) => {
    const userId = context.session.user.id;

    const profile = await hydrateProfile(userId);
    const intakeRows = await db
      .select()
      .from(intakeSummaries)
      .where(eq(intakeSummaries.userId, userId));
    const intakeSummary = intakeRows[0]?.summary as {
      currentInjuries?: Array<{ area: string; diagnosis: string | null }>;
    } | null;

    const weeklyHours = profile?.trainingVolumeHrsPerWeek ?? 0;
    const weeklyHoursLabel = weeklyHours > 0 ? `~${Math.round(weeklyHours)} hours` : null;

    return {
      greetingName: profile?.name ?? null,
      sports: profile?.sports ?? [],
      weeklyHoursLabel,
      focusAreas: profile?.focusAreas ?? [],
      injuries: (intakeSummary?.currentInjuries ?? []).map((i) => ({
        area: i.area,
        diagnosis: i.diagnosis,
      })),
    };
  });

// One-shot: stamps `planRevealSeenAt` so the navigation gate stops routing the
// user back to /plan-reveal on subsequent app opens.
const plansMarkRevealSeen = os.plans.markRevealSeen
  .use(authMiddleware)
  .handler(async ({ context }) => {
    const userId = context.session.user.id;
    await db
      .update(sportProfiles)
      .set({ planRevealSeenAt: new Date() })
      .where(eq(sportProfiles.userId, userId));
    return { ok: true as const };
  });

// ── Admin / ops (PRE-129 / 130 / 131) ──────────────────────────────────────
// Staff-only. Every handler is gated by adminMiddleware (ADMIN_EMAILS allowlist).

// Aggregate LLM spend for a single user (powers the per-user inspection view).
async function llmTotalsForUser(userId: string) {
  const rows = await db
    .select({
      calls: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${llmCallLogs.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${llmCallLogs.outputTokens}), 0)::int`,
      costUsd: sql<string>`coalesce(sum(${llmCallLogs.costUsd}), 0)`,
    })
    .from(llmCallLogs)
    .where(eq(llmCallLogs.userId, userId));
  const r = rows[0];
  return {
    totalCalls: r?.calls ?? 0,
    totalInputTokens: r?.inputTokens ?? 0,
    totalOutputTokens: r?.outputTokens ?? 0,
    totalCostUsd: r ? Number(r.costUsd) : 0,
  };
}

const adminMe = os.admin.me.use(adminMiddleware).handler(({ context }) => ({
  userId: context.session.user.id,
  email: context.session.user.email,
  name: context.session.user.name,
}));

const adminListUsers = os.admin.listUsers.use(adminMiddleware).handler(async ({ input }) => {
  const { limit, offset } = input;
  const q = input.query?.trim();
  const where = q
    ? or(ilike(user.email, `%${q}%`), ilike(user.name, `%${q}%`), eq(user.id, q))
    : undefined;

  const totalRows = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(user)
    .where(where);
  const total = totalRows[0]?.c ?? 0;

  const rows = await db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
      deletionScheduledAt: user.deletionScheduledAt,
    })
    .from(user)
    .where(where)
    .orderBy(desc(user.createdAt))
    .limit(limit)
    .offset(offset);

  const ids = rows.map((r) => r.id);
  const [profileRows, subRows, flaggedRows] = await Promise.all([
    ids.length
      ? db
          .select({
            userId: sportProfiles.userId,
            primarySport: sportProfiles.primarySport,
            onboardingCompletedAt: sportProfiles.onboardingCompletedAt,
          })
          .from(sportProfiles)
          .where(inArray(sportProfiles.userId, ids))
      : Promise.resolve([]),
    ids.length
      ? db
          .select({ userId: subscriptions.userId, subscribedAt: subscriptions.subscribedAt })
          .from(subscriptions)
          .where(inArray(subscriptions.userId, ids))
      : Promise.resolve([]),
    ids.length
      ? db
          .select({ userId: threads.userId, c: sql<number>`count(*)::int` })
          .from(threads)
          .where(and(inArray(threads.userId, ids), isNotNull(threads.flaggedForReviewAt)))
          .groupBy(threads.userId)
      : Promise.resolve([]),
  ]);

  const profileById = new Map(profileRows.map((p) => [p.userId, p]));
  const subById = new Map(subRows.map((s) => [s.userId, s]));
  const flaggedById = new Map(flaggedRows.map((f) => [f.userId, f.c]));

  return {
    total,
    users: rows.map((r) => {
      const p = profileById.get(r.id);
      return {
        id: r.id,
        email: r.email,
        name: r.name,
        createdAt: r.createdAt.toISOString(),
        onboardingCompletedAt: p?.onboardingCompletedAt?.toISOString() ?? null,
        primarySport: p?.primarySport && p.primarySport.length > 0 ? p.primarySport : null,
        deletionScheduledAt: r.deletionScheduledAt?.toISOString() ?? null,
        subscribed: subById.get(r.id)?.subscribedAt != null,
        flaggedThreadCount: flaggedById.get(r.id) ?? 0,
      };
    }),
  };
});

const adminGetUser = os.admin.getUser.use(adminMiddleware).handler(async ({ input }) => {
  const { userId } = input;
  const userRows = await db.select().from(user).where(eq(user.id, userId));
  const u = userRows[0];
  if (!u) {
    throw new ORPCError("NOT_FOUND", { message: "User not found." });
  }

  const [
    profileRows,
    answerRows,
    intakeRows,
    threadRows,
    subRows,
    notifRows,
    planRows,
    sessionRows,
    checkInRows,
    llm,
  ] = await Promise.all([
    db.select().from(sportProfiles).where(eq(sportProfiles.userId, userId)),
    db
      .select()
      .from(profileAnswers)
      .where(eq(profileAnswers.userId, userId))
      .orderBy(asc(profileAnswers.recordedAt)),
    db.select().from(intakeSummaries).where(eq(intakeSummaries.userId, userId)),
    db.select().from(threads).where(eq(threads.userId, userId)).orderBy(desc(threads.startedAt)),
    db.select().from(subscriptions).where(eq(subscriptions.userId, userId)),
    db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId)),
    db.select().from(plans).where(eq(plans.userId, userId)).orderBy(desc(plans.createdAt)),
    db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, userId))
      .orderBy(desc(sessions.createdAt))
      .limit(50),
    db
      .select()
      .from(dailyCheckIns)
      .where(eq(dailyCheckIns.userId, userId))
      .orderBy(desc(dailyCheckIns.checkInDate))
      .limit(30),
    llmTotalsForUser(userId),
  ]);

  const threadIds = threadRows.map((t) => t.id);
  const msgCounts = threadIds.length
    ? await db
        .select({ threadId: messages.threadId, c: sql<number>`count(*)::int` })
        .from(messages)
        .where(inArray(messages.threadId, threadIds))
        .groupBy(messages.threadId)
    : [];
  const msgCountById = new Map(msgCounts.map((m) => [m.threadId, m.c]));

  const profile = profileRows[0] ?? null;
  const intake = intakeRows[0] ?? null;
  const sub = subRows[0] ?? null;
  const notif = notifRows[0] ?? null;

  return {
    user: {
      id: u.id,
      email: u.email,
      name: u.name,
      emailVerified: u.emailVerified,
      image: u.image ?? null,
      deletionScheduledAt: u.deletionScheduledAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
    },
    sportProfile: profile
      ? {
          primarySport: profile.primarySport,
          preferredSessionTime: profile.preferredSessionTime ?? null,
          onboardingCompletedAt: profile.onboardingCompletedAt?.toISOString() ?? null,
          planRevealSeenAt: profile.planRevealSeenAt?.toISOString() ?? null,
        }
      : null,
    profileAnswers: answerRows.map((a) => ({
      questionId: a.questionId,
      version: a.version,
      status: a.status,
      value: a.value,
      recordedAt: a.recordedAt.toISOString(),
    })),
    intakeSummary: intake
      ? {
          threadId: intake.threadId ?? null,
          version: intake.version,
          extractedAt: intake.extractedAt.toISOString(),
          summary: intake.summary,
        }
      : null,
    threads: threadRows.map((t) => ({
      id: t.id,
      type: t.type,
      status: t.status,
      startedAt: t.startedAt.toISOString(),
      completedAt: t.completedAt?.toISOString() ?? null,
      flaggedForReviewAt: t.flaggedForReviewAt?.toISOString() ?? null,
      flagReason: t.flagReason ?? null,
      messageCount: msgCountById.get(t.id) ?? 0,
    })),
    subscription: sub
      ? {
          trialStartedAt: sub.trialStartedAt?.toISOString() ?? null,
          subscribedAt: sub.subscribedAt?.toISOString() ?? null,
          revenueCatCustomerId: sub.revenueCatCustomerId ?? null,
        }
      : null,
    notificationPreferences: notif
      ? {
          preferredTime: notif.preferredTime ?? null,
          timezone: notif.timezone,
          enabled: notif.enabled,
        }
      : null,
    plans: planRows.map((p) => ({
      id: p.id,
      source: p.source,
      status: p.status,
      generationStatus: p.generationStatus,
      startDate: p.startDate,
      endDate: p.endDate,
      headline: p.headline ?? null,
      createdAt: p.createdAt.toISOString(),
    })),
    sessions: sessionRows.map((s) => {
      const ex = s.exercises as GeneratedSession | null;
      return {
        id: s.id,
        sessionDate: s.sessionDate,
        status: s.status,
        source: s.source,
        isRestDay: s.isRestDay,
        title: ex?.title ?? (s.isRestDay ? "Rest Day" : "Session"),
        generationError: s.generationError ?? null,
        completedAt: s.completedAt?.toISOString() ?? null,
        archivedAt: s.archivedAt?.toISOString() ?? null,
        createdAt: s.createdAt.toISOString(),
      };
    }),
    checkIns: checkInRows.map((c) => ({
      checkInDate: c.checkInDate,
      readiness: c.readiness as "low" | "normal" | "high",
      note: c.note ?? null,
    })),
    llm,
  };
});

const adminListFlaggedThreads = os.admin.listFlaggedThreads
  .use(adminMiddleware)
  .handler(async () => {
    const rows = await db
      .select({
        threadId: threads.id,
        userId: threads.userId,
        status: threads.status,
        flaggedForReviewAt: threads.flaggedForReviewAt,
        flagReason: threads.flagReason,
        userEmail: user.email,
        userName: user.name,
      })
      .from(threads)
      .innerJoin(user, eq(threads.userId, user.id))
      .where(isNotNull(threads.flaggedForReviewAt))
      .orderBy(desc(threads.flaggedForReviewAt));

    return {
      threads: rows.map((r) => ({
        threadId: r.threadId,
        userId: r.userId,
        userEmail: r.userEmail,
        userName: r.userName,
        status: r.status,
        flaggedForReviewAt: r.flaggedForReviewAt!.toISOString(),
        flagReason: r.flagReason ?? null,
      })),
    };
  });

const adminRegenerateUserSession = os.admin.regenerateUserSession
  .use(adminMiddleware)
  .handler(async ({ input }) => {
    const { userId, sessionDate, readiness, sessionType } = input;

    // Fail fast if the user hasn't onboarded (the worker re-hydrates anyway).
    const profile = await hydrateProfile(userId);
    if (!profile) {
      throw new ORPCError("PRECONDITION_FAILED", {
        message: "User has no sport profile yet.",
      });
    }

    // Insert a fresh pending session and enqueue the worker — same path as the
    // user-facing RPC, but for an arbitrary user. Marked admin-initiated in the
    // generation context for traceability. Full fallback (lean: false).
    const request = { readiness, sessionType, lean: false as const };
    const row = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(sessions)
        .values({
          userId,
          sessionDate,
          status: "pending",
          source: sessionType ? "on_demand" : "daily",
          exercises: [],
          generationContext: { request, adminInitiated: true },
        })
        .returning({ id: sessions.id, status: sessions.status });

      const r = inserted[0];
      if (!r) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to enqueue session." });
      }

      await emitEvent(
        DomainEvents.SESSION_GENERATION_REQUESTED,
        { sessionId: r.id },
        { tx, maxAttempts: 3, jobKey: `session-gen:${r.id}` },
      );

      return r;
    });

    return { id: row.id, status: row.status };
  });

const adminLlmStats = os.admin.llmStats.use(adminMiddleware).handler(async ({ input }) => {
  const sinceDays = input?.sinceDays ?? 7;
  const userId = input?.userId;
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

  const conds = [gte(llmCallLogs.createdAt, since)];
  if (userId) conds.push(eq(llmCallLogs.userId, userId));
  const where = and(...conds);

  const totalsRows = await db
    .select({
      calls: sql<number>`count(*)::int`,
      errors: sql<number>`(count(*) filter (where ${llmCallLogs.status} = 'error'))::int`,
      inputTokens: sql<number>`coalesce(sum(${llmCallLogs.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${llmCallLogs.outputTokens}), 0)::int`,
      costUsd: sql<string>`coalesce(sum(${llmCallLogs.costUsd}), 0)`,
    })
    .from(llmCallLogs)
    .where(where);
  const t = totalsRows[0];

  const byEndpointRows = await db
    .select({
      endpoint: llmCallLogs.endpoint,
      calls: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${llmCallLogs.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${llmCallLogs.outputTokens}), 0)::int`,
      costUsd: sql<string>`coalesce(sum(${llmCallLogs.costUsd}), 0)`,
      avgLatencyMs: sql<number>`coalesce(avg(${llmCallLogs.latencyMs}), 0)::float`,
    })
    .from(llmCallLogs)
    .where(where)
    .groupBy(llmCallLogs.endpoint)
    .orderBy(desc(sql`coalesce(sum(${llmCallLogs.costUsd}), 0)`));

  return {
    sinceDays,
    totals: {
      calls: t?.calls ?? 0,
      errors: t?.errors ?? 0,
      inputTokens: t?.inputTokens ?? 0,
      outputTokens: t?.outputTokens ?? 0,
      costUsd: t ? Number(t.costUsd) : 0,
    },
    byEndpoint: byEndpointRows.map((r) => ({
      endpoint: r.endpoint,
      calls: r.calls,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      costUsd: Number(r.costUsd),
      avgLatencyMs: Math.round(r.avgLatencyMs),
    })),
  };
});

const adminListLlmCalls = os.admin.listLlmCalls.use(adminMiddleware).handler(async ({ input }) => {
  const limit = input?.limit ?? 50;
  const userId = input?.userId;
  const where = userId ? eq(llmCallLogs.userId, userId) : undefined;

  const rows = await db
    .select()
    .from(llmCallLogs)
    .where(where)
    .orderBy(desc(llmCallLogs.createdAt))
    .limit(limit);

  return {
    calls: rows.map((r) => ({
      id: r.id,
      userId: r.userId ?? null,
      endpoint: r.endpoint,
      provider: r.provider,
      model: r.model,
      status: r.status,
      inputTokens: r.inputTokens ?? null,
      outputTokens: r.outputTokens ?? null,
      costUsd: r.costUsd != null ? Number(r.costUsd) : null,
      latencyMs: r.latencyMs,
      errorMessage: r.errorMessage ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
  };
});

const adminPlaygroundRunDaily = os.admin.playground.runDailyGeneration
  .use(adminMiddleware)
  .handler(async ({ input }) => {
    const result = await runDailyGenerationPlayground({
      userId: input.userId,
      sessionDate: input.sessionDate ?? serverToday(),
      readiness: input.readiness,
      sessionType: input.sessionType,
      lean: input.lean,
      systemPromptOverride: input.systemPromptOverride,
    });
    return result;
  });

// ── Router ─────────────────────────────────────────────────────────────────

export const router = os.router({
  healthCheck,
  privateData,
  waitlist: {
    subscribe: waitlistSubscribe,
  },
  sportProfile: {
    get: sportProfileGet,
    savePartial: sportProfileSavePartial,
    resumePoint: sportProfileResumePoint,
    setPreferredTime: sportProfileSetPreferredTime,
  },
  sessions: {
    getById: getSessionById,
    generateWeeklyScaffold,
    generateDailySession,
    regenerateDailySession,
    getAgenda,
    updateProgress,
    skipExercise,
    complete: completeSession,
    logCapacity,
    acknowledgeRestDay,
    streak,
  },
  checkIn: {
    save: checkInSave,
    get: checkInGet,
    list: checkInList,
  },
  plans: {
    getActive: plansGetActive,
    getRevealState: plansGetRevealState,
    getRevealRecap: plansGetRevealRecap,
    markRevealSeen: plansMarkRevealSeen,
    list: plansList,
    listTemplates: plansListTemplates,
    startFromTemplate: plansStartFromTemplate,
    startGenerated: plansStartGenerated,
  },
  sessionTemplates: {
    list: listSessionTemplates,
    get: getSessionTemplate,
    start: startSessionTemplate,
  },
  exercises: {
    list: listExercises,
    get: getExercise,
  },
  coach: {
    startThread: coachStartThread,
    currentIntakeThread: coachCurrentIntakeThread,
    getThread: coachGetThread,
    endThread: coachEndThread,
    skipThread: coachSkipThread,
  },
  account: {
    delete: accountDelete,
  },
  admin: {
    me: adminMe,
    listUsers: adminListUsers,
    getUser: adminGetUser,
    listFlaggedThreads: adminListFlaggedThreads,
    regenerateUserSession: adminRegenerateUserSession,
    llmStats: adminLlmStats,
    listLlmCalls: adminListLlmCalls,
    playground: {
      runDailyGeneration: adminPlaygroundRunDaily,
    },
  },
});
