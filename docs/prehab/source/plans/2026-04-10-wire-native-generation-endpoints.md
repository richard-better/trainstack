# Wire Native Client to Generation Endpoints (PRE-14)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Connect the Expo native app to oRPC session generation endpoints so the app can generate and display prehab sessions.

**Architecture:** Create React hooks wrapping the three `sessions.*` oRPC endpoints (`generateDailySession`, `generateWeeklyScaffold`, `updateProgress`) using `@orpc/tanstack-query`. Replace the template home screen with a functional session display. Add a fallback banner component shown when `isFallback: true`. All queries use `staleTime: 0` per ticket spec.

**Tech Stack:** `@orpc/tanstack-query`, `@tanstack/react-query` (useQuery, useMutation), Expo Router, React Native

---

### Task 1: Create session hooks

**Files:**

- Create: `apps/native/hooks/use-session.ts`

**Step 1: Create the hooks file**

```typescript
import { useMutation, useQuery } from "@tanstack/react-query";

import { client, orpc, queryClient } from "@/utils/orpc";

/**
 * Get today's date as YYYY-MM-DD in the user's local timezone.
 */
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Fetch (or generate) today's daily session.
 * The server is idempotent — calling this twice returns the same session.
 */
export function useDailySession(readiness: "low" | "normal" | "high" = "normal") {
  const sessionDate = todayLocal();

  return useQuery({
    ...orpc.sessions.generateDailySession.queryOptions({
      input: { sessionDate, readiness },
    }),
    queryKey: ["sessions", "daily", sessionDate, readiness],
    staleTime: 0,
  });
}

/**
 * Generate/fill the weekly scaffold starting from today.
 * Called once on app open to ensure the schedule is populated.
 */
export function useWeeklyScaffold() {
  return useMutation({
    mutationFn: (opts?: { startDate?: string; daysAhead?: number }) =>
      client.sessions.generateWeeklyScaffold({
        startDate: opts?.startDate ?? todayLocal(),
        daysAhead: opts?.daysAhead ?? 14,
      }),
  });
}

/**
 * Update session progress (drop-off index) for resume support.
 * Fire-and-forget from the session runner.
 */
export function useUpdateProgress() {
  return useMutation({
    mutationFn: (input: { sessionId: string; dropOffExerciseIndex: number }) =>
      client.sessions.updateProgress(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd /Users/richard/dev/gh/trainstackhq/prehab-app && bun run check-types`
Expected: PASS (no type errors in new file)

**Step 3: Commit**

```bash
git add apps/native/hooks/use-session.ts
git commit -m "feat(native): add session generation hooks (PRE-14)"
```

---

### Task 2: Create fallback banner component

**Files:**

- Create: `apps/native/components/fallback-banner.tsx`

**Step 1: Create the component**

The banner should match DESIGN.md: warning color `#C8893A`, surface background, DM Sans body text, dismiss button.

```typescript
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

/**
 * Shown when a session was generated from fallback (AI unavailable).
 * Dismissible — shown once per session view.
 */
export function FallbackBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <View
      style={{
        backgroundColor: "rgba(200,137,58,0.12)",
        borderRadius: 10,
        padding: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
      }}
    >
      <Ionicons name="alert-circle" size={20} color="#C8893A" />
      <Text style={{ flex: 1, color: "#8B7D6B", fontSize: 13, lineHeight: 18 }}>
        Using a baseline session today
      </Text>
      <Pressable onPress={() => setDismissed(true)} hitSlop={8}>
        <Ionicons name="close" size={18} color="#8B7D6B" />
      </Pressable>
    </View>
  );
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd /Users/richard/dev/gh/trainstackhq/prehab-app && bun run check-types`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/native/components/fallback-banner.tsx
git commit -m "feat(native): add fallback session banner component (PRE-14)"
```

---

### Task 3: Wire home screen to generation endpoints

**Files:**

- Modify: `apps/native/app/(drawer)/index.tsx`

**Step 1: Replace the template home screen**

Replace the entire file content. The new home screen:

- Calls `useDailySession()` to fetch/generate today's session
- Shows session title, exercise count, estimated duration
- Shows the fallback banner when `isFallback: true`
- Shows loading skeleton while generating
- Shows error state (including the PRECONDITION_FAILED safety error)
- Retains auth state display and sign-out

```typescript
import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View, ActivityIndicator, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FallbackBanner } from "@/components/fallback-banner";
import { SignIn } from "@/components/sign-in";
import { SignUp } from "@/components/sign-up";
import { useDailySession } from "@/hooks/use-session";
import { authClient } from "@/lib/auth-client";
import { queryClient } from "@/utils/orpc";

export default function Home() {
  const insets = useSafeAreaInsets();
  const { data: authSession } = authClient.useSession();
  const isAuthenticated = !!authSession?.user;

  const {
    data: session,
    isLoading,
    error,
  } = useDailySession("normal");

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ padding: 24, paddingBottom: insets.bottom + 24 }}
    >
      {/* Auth header */}
      {isAuthenticated && (
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <Text style={{ color: "#1A2530", fontSize: 13, fontWeight: "500" }}>
            {authSession.user.name ?? authSession.user.email}
          </Text>
          <Pressable
            onPress={() => {
              authClient.signOut();
              queryClient.invalidateQueries();
            }}
            hitSlop={8}
          >
            <Ionicons name="log-out-outline" size={20} color="#8B7D6B" />
          </Pressable>
        </View>
      )}

      {!isAuthenticated && (
        <>
          <SignIn />
          <SignUp />
        </>
      )}

      {/* Session content — only when authenticated */}
      {isAuthenticated && isLoading && (
        <View style={{ alignItems: "center", paddingTop: 80, gap: 16 }}>
          <ActivityIndicator size="large" color="#D4603A" />
          <Text style={{ color: "#8B7D6B", fontSize: 16 }}>
            Building your prehab plan...
          </Text>
        </View>
      )}

      {isAuthenticated && error && (
        <View
          style={{
            backgroundColor: "rgba(192,64,64,0.08)",
            borderRadius: 10,
            padding: 20,
            gap: 8,
          }}
        >
          <Text style={{ color: "#C04040", fontSize: 16, fontWeight: "700" }}>
            Could not generate session
          </Text>
          <Text style={{ color: "#8B7D6B", fontSize: 14, lineHeight: 20 }}>
            {error.message}
          </Text>
        </View>
      )}

      {isAuthenticated && session && (
        <View style={{ gap: 16 }}>
          {session.isFallback && <FallbackBanner />}

          {/* Session card */}
          <View
            style={{
              backgroundColor: "#EDE4CF",
              borderRadius: 16,
              padding: 24,
              gap: 12,
            }}
          >
            <Text
              style={{
                fontSize: 28,
                fontWeight: "900",
                fontStyle: "italic",
                color: "#1A2530",
              }}
            >
              {session.title}
            </Text>

            <Text style={{ fontFamily: "JetBrains Mono", fontSize: 11, color: "#D4603A" }}>
              {session.exercises.length} exercises &middot; {session.estimatedDurationMin} min
            </Text>
          </View>

          {/* Exercise list */}
          {session.exercises.map((exercise, index) => (
            <View
              key={exercise.id}
              style={{
                backgroundColor: "#EDE4CF",
                borderRadius: 10,
                padding: 16,
                gap: 6,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={{ fontFamily: "JetBrains Mono", fontSize: 11, color: "#D4603A" }}>
                  {index + 1}
                </Text>
                <Text style={{ fontSize: 16, fontWeight: "700", color: "#1A2530", flex: 1 }}>
                  {exercise.name}
                </Text>
              </View>
              <Text style={{ fontFamily: "JetBrains Mono", fontSize: 11, color: "#8B7D6B" }}>
                {exercise.sets}x{exercise.reps ?? `${exercise.durationSec}s`}
                {exercise.side === "left_right" ? " each side" : ""}
                {" · "}
                {exercise.restSec}s rest
              </Text>
              {exercise.formCues.length > 0 && (
                <Text style={{ fontSize: 13, color: "#8B7D6B", lineHeight: 18 }}>
                  {exercise.formCues.join(" · ")}
                </Text>
              )}
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd /Users/richard/dev/gh/trainstackhq/prehab-app && bun run check-types`
Expected: PASS

**Step 3: Start dev and verify**

Run: `cd /Users/richard/dev/gh/trainstackhq/prehab-app && bun run dev`

Verify:

- Unauthenticated → shows sign-in/sign-up
- Authenticated without sport profile → redirected to onboarding (existing \_layout.tsx logic)
- Authenticated with sport profile → shows loading spinner → session card with exercises
- If server returns `isFallback: true` → fallback banner appears above session card

**Step 4: Commit**

```bash
git add apps/native/app/\(drawer\)/index.tsx
git commit -m "feat(native): wire home screen to daily session generation (PRE-14)"
```

---

### Task 4: Final check and cleanup

**Step 1: Run full check suite**

Run: `cd /Users/richard/dev/gh/trainstackhq/prehab-app && bun run check && bun run check-types`
Expected: PASS

**Step 2: Fix any lint/format issues**

Run: `cd /Users/richard/dev/gh/trainstackhq/prehab-app && bun run check --fix` (if needed)

**Step 3: Commit fixes if any**

```bash
git add -A
git commit -m "chore: fix lint issues (PRE-14)"
```
