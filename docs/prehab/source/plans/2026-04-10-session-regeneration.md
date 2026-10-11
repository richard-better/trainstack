# Session Regeneration (PRE-46) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Regenerate session" option on the home screen when a session has been generated but not yet started, allowing users to get a fresh AI-generated session.

**Architecture:** New `regenerateDailySession` endpoint that deletes the existing un-started session row and re-generates via the existing AI pipeline. The home screen adds a "Regenerate" button visible only when a session exists and `completedAt` is null and `dropOffExerciseIndex` is null/0. Regeneration does not affect streak.

**Tech Stack:** oRPC contract + Fastify handler, Drizzle ORM, React Native (Expo), TanStack Query

---

### Task 1: Add `regenerateDailySession` to the oRPC contract

**Files:**

- Modify: `packages/contract/src/index.ts`

**Step 1: Add the contract definition**

After the existing `generateDailySession` contract (line ~91), add:

```typescript
const regenerateDailySession = oc
  .input(
    z.object({
      sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      readiness: z.enum(["low", "normal", "high"]).default("normal"),
    }),
  )
  .output(
    z.object({
      id: z.string(),
      sessionDate: z.string(),
      isFallback: z.boolean(),
      completedAt: z.string().nullable(),
      dropOffExerciseIndex: z.number().int().nullable(),
      title: z.string(),
      estimatedDurationMin: z.number(),
      exercises: z.array(GeneratedExerciseSchema),
    }),
  );
```

**Step 2: Add to the contract router**

In the `sessions` object of the contract router (line ~184), add `regenerateDailySession`:

```typescript
sessions: {
  generateWeeklyScaffold,
  generateDailySession,
  regenerateDailySession,  // ← add
  updateProgress,
  skipExercise,
  complete: completeSession,
  logCapacity,
  streak,
},
```

**Step 3: Verify types compile**

Run: `cd /Users/richard/dev/gh/trainstackhq/prehab-app && bun run check-types`
Expected: PASS (contract is just types, no implementation yet needed)

**Step 4: Commit**

```bash
git add packages/contract/src/index.ts
git commit -m "feat(contract): add regenerateDailySession endpoint (PRE-46)"
```

---

### Task 2: Implement server handler for `regenerateDailySession`

**Files:**

- Modify: `apps/server/src/rpc/router.ts`

**Step 1: Add the handler**

After the `generateDailySession` handler (after line ~329), add:

```typescript
const regenerateDailySession = os.sessions.regenerateDailySession
  .use(authMiddleware)
  .handler(async ({ input, context }) => {
    const userId = context.session.user.id;
    const { sessionDate, readiness } = input;

    // 1. Check if a session exists for today
    const existing = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, userId), eq(sessions.sessionDate, sessionDate)));

    if (existing.length > 0) {
      const row = existing[0]!;

      // Block regeneration if session is already completed
      if (row.completedAt) {
        throw new ORPCError("PRECONDITION_FAILED", {
          message: "Cannot regenerate a completed session.",
        });
      }

      // Block regeneration if session is in progress (user started exercises)
      if (row.dropOffExerciseIndex && row.dropOffExerciseIndex > 0) {
        throw new ORPCError("PRECONDITION_FAILED", {
          message: "Cannot regenerate a session that is in progress. Finish or restart.",
        });
      }

      // Delete the existing un-started session
      await db
        .delete(sessions)
        .where(and(eq(sessions.userId, userId), eq(sessions.sessionDate, sessionDate)));
    }

    // 2. Get sport profile
    const profileRows = await db
      .select()
      .from(sportProfiles)
      .where(eq(sportProfiles.userId, userId));

    if (profileRows.length === 0) {
      throw new ORPCError("NOT_FOUND", {
        message: "Sport profile not found. Complete onboarding first.",
      });
    }
    const profile = profileRows[0]!;

    // 3. Get schedule theme for today (already exists from prior generation)
    const scheduleRow = await db
      .select()
      .from(programSchedule)
      .where(and(eq(programSchedule.userId, userId), eq(programSchedule.date, sessionDate)));
    const sessionTheme = scheduleRow[0]?.sessionTheme ?? null;

    // 3b. Safety check
    const capacityRatings = profile.capacityRatings as Record<string, number>;
    if (isSeriouslyInjured(capacityRatings)) {
      throw new ORPCError("PRECONDITION_FAILED", {
        message:
          "Your capacity ratings indicate a possible acute injury. " +
          "Please consult a healthcare provider before using Pre. " +
          "You can update your capacity ratings in Settings once you're cleared to exercise.",
      });
    }

    // 4. Get yesterday's context
    const yesterday = addDays(sessionDate, -1);
    const yesterdaySessions = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, userId), eq(sessions.sessionDate, yesterday)));

    const yesterdayRow = yesterdaySessions[0] ?? null;
    const yesterdayFeedback = yesterdayRow?.feedbackRating ?? null;

    let yesterdayCapacityAfter: Record<string, number> | null = null;
    if (yesterdayRow?.id) {
      const capacityRows = await db
        .select()
        .from(capacityLogs)
        .where(eq(capacityLogs.sessionId, yesterdayRow.id));
      yesterdayCapacityAfter =
        (capacityRows[0]?.capacityRatingsAfter as Record<string, number> | null) ?? null;
    }

    // 5. Generate new session
    const generationResult = await generateDailySessionWithAI({
      sport: profile.primarySport,
      sports: profile.sports,
      readiness,
      capacityRatings: profile.capacityRatings as Record<string, number>,
      trainingVolumeHrs: profile.trainingVolumeHrsPerWeek,
      sessionTheme,
      yesterdayFeedback,
      yesterdayCapacityAfter,
    });

    // 6. Persist
    const inserted = await db
      .insert(sessions)
      .values({
        userId,
        sessionDate,
        exercises: generationResult.session,
        isFallback: generationResult.isFallback,
        generationContext: generationResult.generationContext,
      })
      .onConflictDoNothing()
      .returning();

    const sessionRow =
      inserted[0] ??
      (await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.userId, userId), eq(sessions.sessionDate, sessionDate)))
        .then((rows) => rows[0]));

    if (!sessionRow) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Failed to persist regenerated session.",
      });
    }

    return {
      id: sessionRow.id,
      sessionDate: sessionRow.sessionDate,
      isFallback: sessionRow.isFallback,
      completedAt: sessionRow.completedAt?.toISOString() ?? null,
      dropOffExerciseIndex: sessionRow.dropOffExerciseIndex,
      ...(sessionRow.exercises as GeneratedSession),
    };
  });
```

**Step 2: Register in the router**

Add `regenerateDailySession` to the sessions router object (line ~549):

```typescript
sessions: {
  generateWeeklyScaffold,
  generateDailySession,
  regenerateDailySession,  // ← add
  updateProgress,
  skipExercise,
  complete: completeSession,
  logCapacity,
  streak,
},
```

**Step 3: Verify types compile**

Run: `cd /Users/richard/dev/gh/trainstackhq/prehab-app && bun run check-types`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/server/src/rpc/router.ts
git commit -m "feat(server): add regenerateDailySession endpoint (PRE-46)"
```

---

### Task 3: Add `useRegenerateSession` hook on native

**Files:**

- Modify: `apps/native/hooks/use-session.ts`

**Step 1: Add the mutation hook**

After `useCompleteSession()` (after line ~98), add:

```typescript
/**
 * Regenerate today's session. Deletes the existing un-started session
 * and generates a fresh one with the given readiness.
 */
export function useRegenerateSession() {
  return useMutation({
    mutationFn: (input: { sessionDate: string; readiness: "low" | "normal" | "high" }) =>
      client.sessions.regenerateDailySession(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}
```

**Step 2: Verify types compile**

Run: `cd /Users/richard/dev/gh/trainstackhq/prehab-app && bun run check-types`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/native/hooks/use-session.ts
git commit -m "feat(native): add useRegenerateSession hook (PRE-46)"
```

---

### Task 4: Add "Regenerate" button to home screen

**Files:**

- Modify: `apps/native/app/(drawer)/index.tsx`

**Step 1: Import the hook and add state**

Add `useRegenerateSession` to the imports from `@/hooks/use-session` (line 17):

```typescript
import { useDailySession, useStreak, useRegenerateSession } from "@/hooks/use-session";
```

**Step 2: Wire up the mutation inside the `Home` component**

After the `isResuming` variable (line ~54), add:

```typescript
const regenerate = useRegenerateSession();

// Show regenerate button when session exists, not completed, not started
const canRegenerate = !!session && !isCompleted && !isResuming && !regenerate.isPending;
```

**Step 3: Add the Regenerate button to the UI**

Inside the `{session && (...)}` block, after the "Start session" `Pressable` (after line ~316) and before the completed banner, add:

```tsx
{
  /* Regenerate button — only when session not started */
}
{
  canRegenerate && (
    <Pressable
      onPress={() => {
        regenerate.mutate({
          sessionDate: session.sessionDate,
          readiness: readiness ?? "normal",
        });
      }}
      style={({ pressed }) => ({
        borderWidth: 1.5,
        borderColor: pressed ? "#C8BCA8" : "#D4C5A9",
        borderRadius: 9999,
        paddingVertical: 14,
        alignItems: "center",
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Text
        style={{
          fontSize: 14,
          fontWeight: "600",
          color: "#8B7D6B",
        }}
      >
        Regenerate session
      </Text>
    </Pressable>
  );
}

{
  /* Regenerating state */
}
{
  regenerate.isPending && (
    <View style={{ alignItems: "center", paddingTop: 12, gap: 8 }}>
      <ActivityIndicator size="small" color="#D4603A" />
      <Text
        style={{
          fontFamily: "DM Sans",
          fontSize: 14,
          color: "#8B7D6B",
        }}
      >
        Regenerating...
      </Text>
    </View>
  );
}

{
  /* Regeneration error */
}
{
  regenerate.isError && (
    <Text style={{ color: "#C04040", fontSize: 13, textAlign: "center" }}>
      {regenerate.error.message}
    </Text>
  );
}
```

**Step 4: Verify types compile**

Run: `cd /Users/richard/dev/gh/trainstackhq/prehab-app && bun run check-types`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/native/app/\(drawer\)/index.tsx
git commit -m "feat(native): add regenerate session button to home screen (PRE-46)"
```

---

### Task 5: Verify end-to-end

**Step 1: Run full type check**

Run: `cd /Users/richard/dev/gh/trainstackhq/prehab-app && bun run check-types`
Expected: PASS

**Step 2: Run lint/format**

Run: `cd /Users/richard/dev/gh/trainstackhq/prehab-app && bun run check`
Expected: PASS (fix any lint issues)

**Step 3: Run existing tests**

Run: `cd /Users/richard/dev/gh/trainstackhq/prehab-app && bun run test`
Expected: All existing tests pass (regeneration doesn't change session-generator.ts)

**Step 4: Manual verification**

Start the dev server and confirm:

1. Home screen shows "Regenerate session" button after a session is generated but before it's started
2. Tapping "Regenerate session" shows the loading state, then a new session replaces the old one
3. Button disappears after session is completed
4. Button disappears after session is in progress (dropOffExerciseIndex > 0)

**Step 5: Post a comment on PRE-46 in Linear summarizing the changes**

Files changed:

- `packages/contract/src/index.ts` — added `regenerateDailySession` contract
- `apps/server/src/rpc/router.ts` — added `regenerateDailySession` handler (delete + re-generate)
- `apps/native/hooks/use-session.ts` — added `useRegenerateSession` mutation hook
- `apps/native/app/(drawer)/index.tsx` — added regenerate button with loading/error states

Key decisions:

- Regeneration blocked if session is completed or in progress (safety guard)
- Existing session row is deleted before re-generation (soft replace per ticket spec)
- UNIQUE constraint preserved — delete then insert, not upsert
- Streak unaffected (regeneration only touches un-completed sessions)
- Uses same AI generation pipeline — no changes to session-generator.ts
