# PRE-61: Agenda/Calendar UI for Home Tab

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the single-day Home tab with a calendar agenda that shows past completed sessions, today's session with start CTA, and future planned sessions from the 14-day scaffold.

**Architecture:** New `sessions.getAgenda` API endpoint returns both sessions and program_schedule entries for a date range. Calendar components adapted from the modern-agenda reference (in `/Users/richard/Downloads/modern-agenda-calendar/`) are themed to DESIGN.md. The Home tab becomes a `CalendarAgenda` wrapper that delegates each day's content to either a completed session card, today's readiness-picker + session CTA, or a future planned session placeholder.

**Tech Stack:** oRPC contract + Drizzle queries (server), react-native-calendars WeekCalendar + Reanimated (native), Pre design system (Satoshi/DM Sans/JetBrains Mono, terracotta accent, parchment backgrounds)

---

## Task 1: Add `sessions.getAgenda` to the contract

**Files:**

- Modify: `packages/contract/src/index.ts:203-228`

**Step 1: Add the contract definition**

After the `streak` definition (line 203) and before the contract router (line 207), add:

```typescript
const getAgenda = oc
  .input(
    z.object({
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }),
  )
  .output(
    z.object({
      sessions: z.array(
        z.object({
          id: z.string(),
          sessionDate: z.string(),
          completedAt: z.string().nullable(),
          isRestDay: z.boolean(),
          title: z.string(),
          estimatedDurationMin: z.number(),
          exerciseCount: z.number().int(),
          sessionType: SessionTypeEnum.nullable(),
        }),
      ),
      schedule: z.array(
        z.object({
          date: z.string(),
          sessionTheme: z.string(),
          sessionType: SessionTypeEnum,
        }),
      ),
    }),
  );
```

Then add `getAgenda` to the sessions section of the contract router:

```typescript
sessions: {
    generateWeeklyScaffold,
    generateDailySession,
    regenerateDailySession,
    getAgenda,        // <-- add this
    updateProgress,
    // ... rest unchanged
},
```

**Step 2: Run type check**

```bash
cd /Users/richard/dev/gh/trainstackhq/prehab-app && bun run check-types
```

Expected: May show errors in `router.ts` (handler not yet implemented) — that's fine, we'll fix it next.

**Step 3: Commit**

```bash
git add packages/contract/src/index.ts
git commit -m "feat(contract): add sessions.getAgenda endpoint for agenda view (PRE-61)"
```

---

## Task 2: Implement `getAgenda` server handler

**Files:**

- Modify: `apps/server/src/rpc/router.ts`

**Step 1: Add the handler**

After the `streak` handler (~line 660) and before the sport profile section (~line 662), add:

```typescript
const getAgenda = os.sessions.getAgenda.use(authMiddleware).handler(async ({ input, context }) => {
  const userId = context.session.user.id;
  const { startDate, endDate } = input;

  // Fetch all sessions in range
  const sessionRows = await db
    .select({
      id: sessions.id,
      sessionDate: sessions.sessionDate,
      completedAt: sessions.completedAt,
      isRestDay: sessions.isRestDay,
      exercises: sessions.exercises,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        gte(sessions.sessionDate, startDate),
        lt(sessions.sessionDate, endDate),
      ),
    );

  // Fetch program schedule in range
  const scheduleRows = await db
    .select({
      date: programSchedule.date,
      sessionTheme: programSchedule.sessionTheme,
      sessionType: programSchedule.sessionType,
    })
    .from(programSchedule)
    .where(
      and(
        eq(programSchedule.userId, userId),
        gte(programSchedule.date, startDate),
        lt(programSchedule.date, endDate),
      ),
    );

  return {
    sessions: sessionRows.map((row) => {
      const exerciseData = row.exercises as GeneratedSession | null;
      return {
        id: row.id,
        sessionDate: row.sessionDate,
        completedAt: row.completedAt?.toISOString() ?? null,
        isRestDay: row.isRestDay,
        title: exerciseData?.title ?? "Session",
        estimatedDurationMin: exerciseData?.estimatedDurationMin ?? 0,
        exerciseCount: exerciseData?.exercises?.length ?? 0,
        sessionType: null as "prehab" | "recovery" | "mobility" | "activation" | null,
      };
    }),
    schedule: scheduleRows.map((row) => ({
      date: row.date,
      sessionTheme: row.sessionTheme,
      sessionType: row.sessionType,
    })),
  };
});
```

**Step 2: Add to the router object**

In the `router` export (~line 710), add `getAgenda` to sessions:

```typescript
sessions: {
    generateWeeklyScaffold,
    generateDailySession,
    regenerateDailySession,
    getAgenda,        // <-- add this
    updateProgress,
    skipExercise,
    complete: completeSession,
    logCapacity,
    acknowledgeRestDay,
    streak,
},
```

**Step 3: Cross-reference the schedule sessionType onto sessions**

The handler above sets `sessionType: null` on sessions. To enrich it, look up each session's date in the schedule rows:

Replace the `sessionType: null` line with:

```typescript
sessionType: scheduleRows.find((s) => s.date === row.sessionDate)?.sessionType ?? null,
```

**Step 4: Run type check**

```bash
cd /Users/richard/dev/gh/trainstackhq/prehab-app && bun run check-types
```

Expected: PASS (or only unrelated errors)

**Step 5: Commit**

```bash
git add apps/server/src/rpc/router.ts
git commit -m "feat(server): implement sessions.getAgenda handler (PRE-61)"
```

---

## Task 3: Add `useAgenda` hook

**Files:**

- Modify: `apps/native/hooks/use-session.ts`

**Step 1: Add the hook**

After the `useStreak` hook (~line 46), add:

```typescript
/**
 * Fetch agenda data (sessions + schedule) for a date range.
 * Used by the calendar agenda view to show past, present, and future sessions.
 */
export function useAgenda(startDate: string, endDate: string) {
  return useQuery({
    ...orpc.sessions.getAgenda.queryOptions({
      input: { startDate, endDate },
    }),
    queryKey: ["sessions", "agenda", startDate, endDate],
    staleTime: 30_000, // refresh every 30 seconds
  });
}
```

**Step 2: Run type check**

```bash
cd /Users/richard/dev/gh/trainstackhq/prehab-app && bun run check-types
```

Expected: PASS

**Step 3: Commit**

```bash
git add apps/native/hooks/use-session.ts
git commit -m "feat(native): add useAgenda hook for calendar view (PRE-61)"
```

---

## Task 4: Create calendar utility files

**Files:**

- Create: `apps/native/components/calendar/date-helpers.ts`
- Create: `apps/native/components/calendar/types.ts`
- Create: `apps/native/components/calendar/theme.ts`
- Create: `apps/native/components/calendar/index.ts`

**Step 1: Create date-helpers.ts**

Copy the reference file from `/Users/richard/Downloads/modern-agenda-calendar/components/calendar/date-helpers.ts` verbatim — it's pure utility with no theming.

**Step 2: Create types.ts**

```typescript
/**
 * Calendar and Agenda Types for Pre
 */

/** A session that already exists in the database */
export interface AgendaSession {
  id: string;
  sessionDate: string; // YYYY-MM-DD
  completedAt: string | null;
  isRestDay: boolean;
  title: string;
  estimatedDurationMin: number;
  exerciseCount: number;
  sessionType: "prehab" | "recovery" | "mobility" | "activation" | null;
}

/** A planned session from the program_schedule scaffold */
export interface AgendaScheduleEntry {
  date: string; // YYYY-MM-DD
  sessionTheme: string;
  sessionType: "prehab" | "recovery" | "mobility" | "activation";
}

/** Combined day data for the calendar */
export interface AgendaDayData {
  date: string;
  dayNum: number;
  isToday: boolean;
  isSelected: boolean;
  /** Has a generated/completed session */
  hasSession: boolean;
  /** Session was completed */
  isCompleted: boolean;
  /** Is a rest day */
  isRestDay: boolean;
  /** Has a planned session in the scaffold (future) */
  hasSchedule: boolean;
}
```

**Step 3: Create theme.ts**

Pre-themed color system — no dark mode toggle needed (light-first design per DESIGN.md):

```typescript
/**
 * Calendar theme — Pre design system
 * See DESIGN.md for the full token set
 */

export const colors = {
  light: {
    background: "#F5EFE0",
    surface: "#EDE4CF",
    surface2: "#E3D8BE",
    border: "rgba(0,0,0,0.08)",
    faint: "#C8BCA8",
    textPrimary: "#1A2530",
    textMuted: "#8B7D6B",
    accent: "#D4603A",
    accentLight: "rgba(212,96,58,0.10)",
    success: "#4A7A4E",
    successLight: "rgba(74,122,78,0.10)",
    error: "#C04040",
    white: "#FFFFFF",
  },
  dark: {
    background: "#0D1410",
    surface: "#151E18",
    surface2: "#1E2920",
    border: "rgba(255,255,255,0.07)",
    faint: "#3A4A3E",
    textPrimary: "#E8E2D6",
    textMuted: "#8B9B8F",
    accent: "#D4603A",
    accentLight: "rgba(212,96,58,0.15)",
    success: "#4A7A4E",
    successLight: "rgba(74,122,78,0.15)",
    error: "#C04040",
    white: "#FFFFFF",
  },
} as const;

export type ThemeColors = (typeof colors)["light"];

export function getColors(isDarkMode: boolean): ThemeColors {
  return isDarkMode ? colors.dark : colors.light;
}
```

**Step 4: Create index.ts**

```typescript
export { CalendarAgenda } from "./CalendarAgenda";
export { CalendarHeader } from "./CalendarHeader";
export { DaySelector } from "./DaySelector";
export { MonthPicker } from "./MonthPicker";
export { SessionItem } from "./SessionItem";
export { EmptyDay } from "./EmptyDay";
export { getColors } from "./theme";
export type { AgendaSession, AgendaScheduleEntry, AgendaDayData } from "./types";
```

**Step 5: Commit**

```bash
git add apps/native/components/calendar/
git commit -m "feat(native): add calendar utility files — types, theme, date-helpers (PRE-61)"
```

---

## Task 5: Create AnimatedSlidingNumber + SlidingDigit

**Files:**

- Create: `apps/native/components/calendar/SlidingDigit.tsx`
- Create: `apps/native/components/calendar/AnimatedSlidingNumber.tsx`

**Step 1: Copy from reference**

Copy both files verbatim from `/Users/richard/Downloads/modern-agenda-calendar/components/animated/`:

- `SlidingDigit.tsx`
- `AnimatedSlidingNumber.tsx`

They use `react-native-reanimated` (already installed in the native app). Only change: update the import path in `AnimatedSlidingNumber.tsx` — change `"../animated/SlidingDigit"` to `"./SlidingDigit"`.

**Step 2: Commit**

```bash
git add apps/native/components/calendar/SlidingDigit.tsx apps/native/components/calendar/AnimatedSlidingNumber.tsx
git commit -m "feat(native): add animated sliding number components (PRE-61)"
```

---

## Task 6: Create CalendarHeader

**Files:**

- Create: `apps/native/components/calendar/CalendarHeader.tsx`

**Step 1: Adapt from reference**

Based on `/Users/richard/Downloads/modern-agenda-calendar/components/calendar/CalendarHeader.tsx`. Key changes:

- Remove `onToggleTheme` / theme toggle button (Pre is light-first, toggle lives elsewhere)
- Use Pre colors from `./theme.ts`
- Use Satoshi Medium for month text (Satoshi is the UI font)
- Terracotta "Today" button when not on today (instead of dark/white)

```typescript
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { getMonthYear, isToday } from "./date-helpers";
import { getColors } from "./theme";

interface CalendarHeaderProps {
  selectedDate: string;
  isDarkMode?: boolean;
  onTodayPress: () => void;
  onMonthPress: () => void;
}

export function CalendarHeader({
  selectedDate,
  isDarkMode = false,
  onTodayPress,
  onMonthPress,
}: CalendarHeaderProps) {
  const c = getColors(isDarkMode);
  const isSelectedToday = isToday(selectedDate);

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <TouchableOpacity
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onMonthPress();
        }}
        style={styles.monthButton}
        activeOpacity={0.7}
      >
        <Text style={[styles.monthText, { color: c.textMuted }]}>
          {getMonthYear(selectedDate)}
        </Text>
        <Ionicons name="chevron-down" size={16} color={c.textMuted} />
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          onTodayPress();
        }}
        style={[
          styles.todayButton,
          {
            backgroundColor: isSelectedToday ? c.accent : c.surface,
          },
        ]}
        activeOpacity={0.7}
        disabled={isSelectedToday}
      >
        <Text
          style={[
            styles.todayButtonText,
            {
              color: isSelectedToday ? c.white : c.textMuted,
            },
          ]}
        >
          Today
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  monthButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  monthText: {
    fontFamily: "Satoshi",
    fontSize: 17,
    fontWeight: "500",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  todayButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 9999,
  },
  todayButtonText: {
    fontFamily: "Satoshi",
    fontSize: 14,
    fontWeight: "600",
  },
});
```

**Step 2: Commit**

```bash
git add apps/native/components/calendar/CalendarHeader.tsx
git commit -m "feat(native): add CalendarHeader component (PRE-61)"
```

---

## Task 7: Create DaySelector

**Files:**

- Create: `apps/native/components/calendar/DaySelector.tsx`

**Step 1: Adapt from reference**

Based on `/Users/richard/Downloads/modern-agenda-calendar/components/calendar/DaySelector.tsx`. Key changes:

- Terracotta (#D4603A) for selected pill background instead of black/white
- White text on selected pill
- Dot colors: garden green (#4A7A4E) for completed, terracotta for has-session, faint (#C8BCA8) for empty
- Use `AgendaDayData` type from `./types.ts`

```typescript
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useCallback, useMemo } from "react";
import {
  Dimensions,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import type { DateData } from "react-native-calendars";
import { CalendarProvider, WeekCalendar } from "react-native-calendars";

import { getColors } from "./theme";
import type { AgendaDayData } from "./types";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

interface DaySelectorProps {
  days: AgendaDayData[];
  selectedDate: string;
  isDarkMode?: boolean;
  onDayPress: (date: string) => void;
}

export function DaySelector({
  days,
  selectedDate,
  isDarkMode = false,
  onDayPress,
}: DaySelectorProps) {
  const c = useMemo(() => getColors(isDarkMode), [isDarkMode]);

  const dayStatusMap = useMemo(() => {
    const map: Record<string, AgendaDayData> = {};
    for (const day of days) {
      map[day.date] = day;
    }
    return map;
  }, [days]);

  const handleDayPress = useCallback(
    (date: DateData) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      onDayPress(date.dateString);
    },
    [onDayPress],
  );

  const getDotColor = useCallback(
    (dayData: AgendaDayData | undefined): string => {
      if (!dayData) return c.faint;
      if (dayData.isCompleted || dayData.isRestDay) return c.success;
      if (dayData.hasSession) return c.accent;
      if (dayData.hasSchedule) return c.faint;
      return c.faint;
    },
    [c],
  );

  const renderDay = useCallback(
    ({ date }: { date?: DateData; state?: string }) => {
      if (!date) return <View style={styles.dayPill} />;

      const isSelected = date.dateString === selectedDate;
      const dayData = dayStatusMap[date.dateString];
      const dotColor = getDotColor(dayData);

      return (
        <TouchableOpacity
          onPress={() => handleDayPress(date)}
          activeOpacity={0.7}
          style={styles.dayWrapper}
        >
          <View
            style={[
              styles.dayPill,
              {
                backgroundColor: isSelected ? c.accent : c.surface,
              },
            ]}
          >
            <Text
              style={[
                styles.dayNum,
                {
                  color: isSelected ? c.white : c.textPrimary,
                  fontFamily: "Satoshi",
                },
              ]}
            >
              {date.day}
            </Text>

            {dayData?.isCompleted && isSelected ? (
              <Ionicons name="checkmark" size={14} color={c.white} />
            ) : (
              <View
                style={[
                  styles.dotIndicator,
                  {
                    backgroundColor: isSelected ? c.white : dotColor,
                  },
                ]}
              />
            )}
          </View>
        </TouchableOpacity>
      );
    },
    [selectedDate, dayStatusMap, c, getDotColor, handleDayPress],
  );

  const calendarTheme = useMemo(
    () => ({
      backgroundColor: c.background,
      calendarBackground: c.background,
      reservationsBackgroundColor: c.background,
      todayTextColor: c.accent,
      dayTextColor: c.textPrimary,
      textDisabledColor: c.textMuted,
      arrowColor: c.textPrimary,
      textDayFontWeight: "600" as const,
      textDayFontSize: 18,
      "stylesheet.calendar.header": {
        header: { height: 0, opacity: 0 },
        dayHeader: { display: "none" },
      },
    }),
    [c],
  );

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <CalendarProvider
        date={selectedDate}
        onDateChanged={(date) => {
          if (date) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onDayPress(date);
          }
        }}
      >
        <WeekCalendar
          key={isDarkMode ? "dark" : "light"}
          firstDay={1}
          theme={calendarTheme}
          dayComponent={renderDay}
          allowShadow={false}
          calendarWidth={SCREEN_WIDTH}
          calendarHeight={85}
          hideDayNames
          style={styles.weekCalendar}
        />
      </CalendarProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 85,
    width: SCREEN_WIDTH,
    overflow: "visible",
  },
  weekCalendar: {
    height: 85,
    width: SCREEN_WIDTH,
  },
  dayWrapper: {
    alignItems: "center",
    justifyContent: "center",
    height: 80,
  },
  dayPill: {
    width: 48,
    height: 68,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  dayNum: {
    fontSize: 18,
    fontWeight: "600",
  },
  dotIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
```

**Step 2: Commit**

```bash
git add apps/native/components/calendar/DaySelector.tsx
git commit -m "feat(native): add DaySelector week strip component (PRE-61)"
```

---

## Task 8: Create SessionItem + EmptyDay

**Files:**

- Create: `apps/native/components/calendar/SessionItem.tsx`
- Create: `apps/native/components/calendar/EmptyDay.tsx`

**Step 1: Create SessionItem**

This replaces the reference's `AgendaItem.tsx`. Renders differently for 3 states:

- **Completed session**: green checkmark, title, duration, exercise count
- **Active/today session**: title, duration, exercises, "Start session" CTA
- **Future planned**: session theme, session type badge, "Planned" label

```typescript
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { getColors } from "./theme";
import type { AgendaScheduleEntry, AgendaSession } from "./types";

interface SessionItemProps {
  session?: AgendaSession;
  schedule?: AgendaScheduleEntry;
  isToday: boolean;
  isDarkMode?: boolean;
  onStartSession?: (sessionId: string) => void;
}

export function SessionItem({
  session,
  schedule,
  isToday,
  isDarkMode = false,
  onStartSession,
}: SessionItemProps) {
  const c = getColors(isDarkMode);

  // Completed session
  if (session?.completedAt) {
    return (
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
        <View style={styles.cardRow}>
          <View style={[styles.statusDot, { backgroundColor: c.success }]}>
            <Ionicons name="checkmark" size={12} color={c.white} />
          </View>
          <View style={styles.cardContent}>
            <Text style={[styles.title, { color: c.textPrimary }]}>
              {session.isRestDay ? "Rest Day" : session.title}
            </Text>
            {!session.isRestDay && (
              <Text style={[styles.meta, { color: c.textMuted }]}>
                {session.exerciseCount} exercises · {session.estimatedDurationMin} min
              </Text>
            )}
          </View>
        </View>
      </View>
    );
  }

  // Today's un-started/in-progress session
  if (session && isToday) {
    return (
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
        <View style={styles.cardContent}>
          <Text style={[styles.title, { color: c.textPrimary }]}>{session.title}</Text>
          <View style={styles.metaRow}>
            {session.sessionType && (
              <View style={[styles.badge, { backgroundColor: c.accentLight }]}>
                <Text style={[styles.badgeText, { color: c.accent }]}>
                  {session.sessionType.toUpperCase()}
                </Text>
              </View>
            )}
            <Text style={[styles.meta, { color: c.textMuted }]}>
              {session.exerciseCount} exercises · {session.estimatedDurationMin} min
            </Text>
          </View>
        </View>
        <Pressable
          onPress={() => onStartSession?.(session.id)}
          style={({ pressed }) => [
            styles.startButton,
            { backgroundColor: pressed ? "#E8784A" : c.accent },
          ]}
        >
          <Text style={styles.startButtonText}>Start session</Text>
        </Pressable>
      </View>
    );
  }

  // Future planned session (from schedule only)
  if (schedule) {
    return (
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
        <View style={styles.cardContent}>
          <Text style={[styles.title, { color: c.textPrimary }]}>{schedule.sessionTheme}</Text>
          <View style={styles.metaRow}>
            <View style={[styles.badge, { backgroundColor: c.accentLight }]}>
              <Text style={[styles.badgeText, { color: c.accent }]}>
                {schedule.sessionType.toUpperCase()}
              </Text>
            </View>
            <Text style={[styles.meta, { color: c.faint }]}>Planned</Text>
          </View>
        </View>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 20,
    gap: 16,
    borderWidth: 1,
    marginBottom: 12,
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  statusDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  cardContent: {
    flex: 1,
    gap: 6,
  },
  title: {
    fontFamily: "Satoshi",
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 24,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  badge: {
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  badgeText: {
    fontFamily: "JetBrains Mono",
    fontSize: 10,
    fontWeight: "700",
  },
  meta: {
    fontFamily: "JetBrains Mono",
    fontSize: 11,
  },
  startButton: {
    borderRadius: 9999,
    paddingVertical: 14,
    alignItems: "center",
  },
  startButtonText: {
    fontFamily: "Satoshi",
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
  },
});
```

**Step 2: Create EmptyDay**

```typescript
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { getColors } from "./theme";

interface EmptyDayProps {
  isDarkMode?: boolean;
  isFuture?: boolean;
}

export function EmptyDay({ isDarkMode = false, isFuture = false }: EmptyDayProps) {
  const c = getColors(isDarkMode);

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: c.surface,
          borderColor: c.border,
        },
      ]}
    >
      <Text style={[styles.title, { color: c.textPrimary }]}>
        {isFuture ? "No session planned" : "No session"}
      </Text>
      <Text style={[styles.subtitle, { color: c.textMuted }]}>
        {isFuture ? "Check back closer to this date" : "Rest day or no session recorded"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    padding: 32,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderStyle: "dashed",
  },
  title: {
    fontFamily: "Satoshi",
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 4,
  },
  subtitle: {
    fontFamily: "DM Sans",
    fontSize: 14,
  },
});
```

**Step 3: Commit**

```bash
git add apps/native/components/calendar/SessionItem.tsx apps/native/components/calendar/EmptyDay.tsx
git commit -m "feat(native): add SessionItem and EmptyDay components (PRE-61)"
```

---

## Task 9: Create MonthPicker

**Files:**

- Create: `apps/native/components/calendar/MonthPicker.tsx`

**Step 1: Adapt from reference**

Based on `/Users/richard/Downloads/modern-agenda-calendar/components/calendar/MonthPicker.tsx`. Key changes:

- Use Pre colors
- Terracotta for selected day pill
- Remove dark/light toggle hardcoded colors, use theme

Copy the reference and update colors:

- Selected bg: `c.accent` (terracotta)
- Selected text: `c.white`
- Today text: `c.accent`
- Unselected pill: `c.surface`

**Step 2: Commit**

```bash
git add apps/native/components/calendar/MonthPicker.tsx
git commit -m "feat(native): add MonthPicker modal component (PRE-61)"
```

---

## Task 10: Create CalendarAgenda (main orchestrator)

**Files:**

- Create: `apps/native/components/calendar/CalendarAgenda.tsx`

**Step 1: Build the main component**

Adapted from the reference `CalendarAgenda.tsx`. Key differences:

- Fetches real data via `useAgenda` hook instead of mock data
- Today's content shows the existing readiness picker + session card flow
- Past days show completed session cards
- Future days show planned sessions from scaffold
- Fires `generateWeeklyScaffold` on mount to ensure schedule is populated
- No FAB (floating add button) — sessions are AI-generated, not user-created

```typescript
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dimensions, ScrollView, StyleSheet, Text, View } from "react-native";

import { useAgenda, useWeeklyScaffold } from "@/hooks/use-session";

import AnimatedSlidingNumber from "./AnimatedSlidingNumber";
import { CalendarHeader } from "./CalendarHeader";
import { getDateString, getTodayString, parseDateString } from "./date-helpers";
import { DaySelector } from "./DaySelector";
import { EmptyDay } from "./EmptyDay";
import { MonthPicker } from "./MonthPicker";
import { SessionItem } from "./SessionItem";
import { getColors } from "./theme";
import type { AgendaDayData } from "./types";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

function getMonthYear(dateString: string): { year: number; month: number } {
  const { year, month } = parseDateString(dateString);
  return { year, month };
}

function buildDayTimeline(baseDate: string, totalDays: number) {
  const { year, month } = getMonthYear(baseDate);
  const todayStr = getTodayString();
  const days: AgendaDayData[] = [];

  for (let i = 0; i < totalDays; i++) {
    const date = new Date(year, month, i + 1);
    const dateStr = getDateString(date);
    days.push({
      date: dateStr,
      dayNum: i + 1,
      isToday: dateStr === todayStr,
      isSelected: false,
      hasSession: false,
      isCompleted: false,
      isRestDay: false,
      hasSchedule: false,
    });
  }
  return days;
}

interface CalendarAgendaProps {
  isDarkMode?: boolean;
  onStartSession?: (sessionId: string) => void;
  /** Render custom content for today (readiness picker, etc.) */
  renderTodayContent?: () => React.ReactNode;
}

export function CalendarAgenda({
  isDarkMode = false,
  onStartSession,
  renderTodayContent,
}: CalendarAgendaProps) {
  const today = useMemo(() => getTodayString(), []);
  const [selectedDate, setSelectedDate] = useState(today);
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);
  const isScrollingRef = useRef(false);
  const c = useMemo(() => getColors(isDarkMode), [isDarkMode]);

  // Ensure scaffold is populated
  const scaffold = useWeeklyScaffold();
  useEffect(() => {
    scaffold.mutate({ startDate: today, daysAhead: 14 });
  }, [today]); // eslint-disable-line react-hooks/exhaustive-deps

  // Build day timeline for the selected month
  const baseDays = useMemo(() => {
    const { year, month } = getMonthYear(selectedDate);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    return buildDayTimeline(selectedDate, daysInMonth);
  }, [selectedDate]);

  // Compute date range for the current month
  const { startDate, endDate } = useMemo(() => {
    const { year, month } = getMonthYear(selectedDate);
    const start = getDateString(new Date(year, month, 1));
    const end = getDateString(new Date(year, month + 1, 1));
    return { startDate: start, endDate: end };
  }, [selectedDate]);

  // Fetch agenda data
  const { data: agenda } = useAgenda(startDate, endDate);

  // Enrich days with session/schedule status
  const daysWithStatus = useMemo(() => {
    const sessionMap = new Map(agenda?.sessions.map((s) => [s.sessionDate, s]));
    const scheduleMap = new Map(agenda?.schedule.map((s) => [s.date, s]));

    return baseDays.map((day) => {
      const session = sessionMap.get(day.date);
      const schedule = scheduleMap.get(day.date);
      return {
        ...day,
        isSelected: day.date === selectedDate,
        hasSession: !!session,
        isCompleted: !!session?.completedAt,
        isRestDay: !!session?.isRestDay,
        hasSchedule: !!schedule,
      };
    });
  }, [baseDays, agenda, selectedDate]);

  const currentDayIndex = useMemo(() => {
    const idx = daysWithStatus.findIndex((d) => d.date === selectedDate);
    return idx >= 0 ? idx : 0;
  }, [daysWithStatus, selectedDate]);

  // Scroll to selected day
  useEffect(() => {
    if (currentDayIndex >= 0 && scrollViewRef.current) {
      const timer = setTimeout(() => {
        scrollViewRef.current?.scrollTo({
          x: currentDayIndex * SCREEN_WIDTH,
          animated: false,
        });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [currentDayIndex, selectedDate]);

  const scrollToDate = useCallback(
    (date: string) => {
      const index = daysWithStatus.findIndex((d) => d.date === date);
      if (index >= 0 && scrollViewRef.current) {
        isScrollingRef.current = true;
        scrollViewRef.current.scrollTo({ x: index * SCREEN_WIDTH, animated: true });
        setTimeout(() => {
          isScrollingRef.current = false;
        }, 500);
      }
    },
    [daysWithStatus],
  );

  const handleDayPress = useCallback(
    (date: string) => {
      setSelectedDate(date);
      scrollToDate(date);
    },
    [scrollToDate],
  );

  const handleScrollEndDrag = useCallback(
    (e: any) => {
      const offsetX = e.nativeEvent.contentOffset.x;
      const index = Math.round(offsetX / SCREEN_WIDTH);
      const targetDay = daysWithStatus[index];
      if (targetDay && targetDay.date !== selectedDate) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setSelectedDate(targetDay.date);
      }
    },
    [daysWithStatus, selectedDate],
  );

  const handleScrollEnd = useCallback(
    (e: any) => {
      if (isScrollingRef.current) return;
      const offsetX = e.nativeEvent.contentOffset.x;
      const index = Math.round(offsetX / SCREEN_WIDTH);
      const targetDay = daysWithStatus[index];
      if (targetDay && targetDay.date !== selectedDate) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setSelectedDate(targetDay.date);
      }
    },
    [daysWithStatus, selectedDate],
  );

  const handleTodayPress = useCallback(() => {
    setSelectedDate(today);
    scrollToDate(today);
  }, [today, scrollToDate]);

  // Render content for a given day
  const renderDayContent = (dayIndex: number) => {
    const day = daysWithStatus[dayIndex];
    if (!day) return null;

    const session = agenda?.sessions.find((s) => s.sessionDate === day.date);
    const schedule = agenda?.schedule.find((s) => s.date === day.date);
    const isTodayDate = day.date === today;
    const isFuture = day.date > today;

    return (
      <View key={day.date} style={[styles.dayContainer, { width: SCREEN_WIDTH }]}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.contentList}>
          {/* Section title */}
          <Text style={[styles.sectionTitle, { color: c.textMuted }]}>
            {isTodayDate ? "TODAY" : isFuture ? "PLANNED" : "COMPLETED"}
          </Text>

          {/* Today: render custom content (readiness picker) if no session yet */}
          {isTodayDate && renderTodayContent && !session ? (
            renderTodayContent()
          ) : session || schedule ? (
            <SessionItem
              session={session}
              schedule={schedule}
              isToday={isTodayDate}
              isDarkMode={isDarkMode}
              onStartSession={onStartSession}
            />
          ) : (
            <EmptyDay isDarkMode={isDarkMode} isFuture={isFuture} />
          )}
        </ScrollView>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <CalendarHeader
        selectedDate={selectedDate}
        isDarkMode={isDarkMode}
        onTodayPress={handleTodayPress}
        onMonthPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setShowMonthPicker(true);
        }}
      />

      {/* Day counter */}
      <View style={styles.dayTitleContainer}>
        <Text style={[styles.dayTitle, { color: c.textPrimary }]}>DAY </Text>
        <AnimatedSlidingNumber
          number={currentDayIndex + 1}
          minDigits={1}
          maxDigits={2}
          textStyle={[styles.dayTitle, { color: c.textPrimary }]}
          containerStyle={styles.animatedNumberContainer}
        />
        <Text style={[styles.dayTitleSuffix, { color: c.textMuted }]}>
          {" "}
          / {baseDays.length}
        </Text>
      </View>

      <DaySelector
        days={daysWithStatus}
        selectedDate={selectedDate}
        isDarkMode={isDarkMode}
        onDayPress={handleDayPress}
      />

      {/* Swipeable day content */}
      <View style={[styles.agendaContainer, { backgroundColor: c.background }]}>
        <ScrollView
          ref={scrollViewRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScrollEndDrag={handleScrollEndDrag}
          onMomentumScrollEnd={handleScrollEnd}
          scrollEventThrottle={16}
          decelerationRate="normal"
        >
          {daysWithStatus.map((_, index) => renderDayContent(index))}
        </ScrollView>
      </View>

      <MonthPicker
        visible={showMonthPicker}
        selectedDate={selectedDate}
        isDarkMode={isDarkMode}
        onClose={() => setShowMonthPicker(false)}
        onSelectDate={(date) => {
          setSelectedDate(date);
          scrollToDate(date);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  dayTitleContainer: {
    flexDirection: "row",
    alignItems: "baseline",
    paddingHorizontal: 24,
    paddingTop: 4,
  },
  dayTitle: {
    fontFamily: "Satoshi",
    fontSize: 36,
    fontWeight: "800",
    letterSpacing: -1,
  },
  dayTitleSuffix: {
    fontFamily: "Satoshi",
    fontSize: 24,
    fontWeight: "600",
  },
  animatedNumberContainer: {
    alignItems: "baseline",
  },
  agendaContainer: {
    flex: 1,
    marginTop: 20,
  },
  dayContainer: {
    flex: 1,
    paddingHorizontal: 24,
  },
  sectionTitle: {
    fontFamily: "JetBrains Mono",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    marginBottom: 16,
    marginTop: 8,
    textTransform: "uppercase",
  },
  contentList: {
    paddingBottom: 120,
  },
});
```

**Step 2: Commit**

```bash
git add apps/native/components/calendar/CalendarAgenda.tsx
git commit -m "feat(native): add CalendarAgenda main orchestrator component (PRE-61)"
```

---

## Task 11: Refactor Home tab

**Files:**

- Modify: `apps/native/app/(tabs)/index.tsx`

**Step 1: Replace with CalendarAgenda**

The Home tab becomes a thin wrapper. The existing readiness picker + session card flow is passed as `renderTodayContent`. The rest (streak, rest day, error/loading) integrates into the today content.

```typescript
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CalendarAgenda } from "@/components/calendar";
import {
  useDailySession,
  useStreak,
  useRegenerateSession,
  useAcknowledgeRestDay,
} from "@/hooks/use-session";
import { orpc } from "@/utils/orpc";

type Readiness = "low" | "normal" | "high";
type SessionType = "prehab" | "recovery" | "mobility" | "activation";

function isAllLowCapacity(ratings: Record<string, number> | undefined | null): boolean {
  if (!ratings) return false;
  const values = Object.values(ratings);
  if (values.length === 0) return false;
  return values.every((v) => v <= 1);
}

export default function Home() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [sessionType, setSessionType] = useState<SessionType | undefined>(undefined);

  const { data: profileData } = useQuery({
    ...orpc.sportProfile.get.queryOptions(),
    queryKey: ["sportProfile"],
  });
  const profile = profileData?.profile;

  const { data: streakData } = useStreak();
  const currentStreak = streakData?.currentStreak ?? 0;

  const { data: session, isLoading, error, refetch } = useDailySession(readiness, sessionType);
  const isCompleted = !!session?.completedAt;
  const isResuming =
    !isCompleted && session?.dropOffExerciseIndex != null && session.dropOffExerciseIndex > 0;

  const regenerate = useRegenerateSession();
  const canRegenerate = !!session && !isCompleted && !isResuming && !regenerate.isPending;

  const shouldRestDay = isAllLowCapacity(profile?.capacityRatings);
  const acknowledgeRestDay = useAcknowledgeRestDay();
  const [restDayAcknowledged, setRestDayAcknowledged] = useState(false);

  const handleStartSession = (sessionId: string) => {
    router.push(`/session/${sessionId}`);
  };

  // Renders the readiness picker + session flow for today
  const renderTodayContent = () => (
    <View style={{ gap: 24 }}>
      {/* Streak */}
      {currentStreak > 0 && (
        <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
          <Text
            style={{
              fontFamily: "JetBrains Mono",
              fontSize: 11,
              fontWeight: "600",
              color: "#8B7D6B",
            }}
          >
            {currentStreak} day streak
          </Text>
        </View>
      )}

      {/* Rest day */}
      {shouldRestDay && !restDayAcknowledged && (
        <>
          <View
            style={{ backgroundColor: "#EDE4CF", borderRadius: 16, padding: 24, gap: 16 }}
          >
            <Text
              style={{ fontSize: 28, fontWeight: "900", fontStyle: "italic", color: "#1A2530" }}
            >
              Rest day
            </Text>
            <Text
              style={{ fontFamily: "DM Sans", fontSize: 16, lineHeight: 26, color: "#8B7D6B" }}
            >
              Your body is telling you to recover. Rest days are part of the program.
            </Text>
          </View>
          <Pressable
            onPress={() => {
              setRestDayAcknowledged(true);
              acknowledgeRestDay.mutate({
                sessionDate: new Date().toLocaleDateString("en-CA"),
              });
            }}
            style={({ pressed }) => ({
              backgroundColor: pressed ? "#E8784A" : "#D4603A",
              borderRadius: 9999,
              paddingVertical: 16,
              alignItems: "center",
            })}
          >
            <Text style={{ fontSize: 16, fontWeight: "700", color: "#fff" }}>
              Take a rest day
            </Text>
          </Pressable>
        </>
      )}

      {restDayAcknowledged && (
        <View
          style={{
            backgroundColor: "rgba(74,122,78,0.10)",
            borderRadius: 10,
            padding: 16,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Ionicons name="checkmark-circle" size={20} color="#4A7A4E" />
          <Text style={{ fontSize: 14, fontWeight: "500", color: "#4A7A4E" }}>
            Rest day logged — see you tomorrow
          </Text>
        </View>
      )}

      {/* Readiness picker (not rest day, no session yet) */}
      {!shouldRestDay && !isLoading && !error && (
        <View style={{ gap: 24 }}>
          <Text
            style={{ fontSize: 22, fontWeight: "900", fontStyle: "italic", color: "#1A2530" }}
          >
            How are you feeling?
          </Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            {(["low", "normal", "high"] as const).map((level) => {
              const selected = readiness === level;
              const label = level === "low" ? "Low" : level === "normal" ? "Normal" : "High";
              return (
                <Pressable
                  key={level}
                  onPress={() => setReadiness(level)}
                  style={{
                    backgroundColor: selected ? "#D4603A" : "#EDE4CF",
                    borderRadius: 9999,
                    paddingVertical: 10,
                    paddingHorizontal: 20,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 14,
                      fontWeight: "600",
                      color: selected ? "#fff" : "#1A2530",
                    }}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={{ gap: 10 }}>
            <Text style={{ fontSize: 13, fontWeight: "500", color: "#8B7D6B" }}>
              Session type
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {(
                [
                  { value: undefined, label: "Daily plan" },
                  { value: "activation", label: "Activation" },
                  { value: "mobility", label: "Mobility" },
                  { value: "recovery", label: "Recovery" },
                ] as const
              ).map(({ value, label }) => {
                const selected = sessionType === value;
                return (
                  <Pressable
                    key={label}
                    onPress={() => setSessionType(value as SessionType | undefined)}
                    style={{
                      backgroundColor: selected ? "rgba(212,96,58,0.10)" : "#EDE4CF",
                      borderRadius: 9999,
                      borderWidth: selected ? 1.5 : 0,
                      borderColor: "#D4603A",
                      paddingVertical: 8,
                      paddingHorizontal: 16,
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: "Satoshi",
                        fontSize: 13,
                        fontWeight: "500",
                        color: selected ? "#D4603A" : "#1A2530",
                      }}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      )}

      {/* Loading */}
      {isLoading && (
        <View style={{ alignItems: "center", paddingTop: 40, gap: 16 }}>
          <ActivityIndicator size="large" color="#D4603A" />
          <Text style={{ fontFamily: "DM Sans", fontSize: 16, color: "#8B7D6B" }}>
            Generating your plan...
          </Text>
        </View>
      )}

      {/* Error */}
      {error && (
        <View
          style={{
            backgroundColor: "rgba(192,64,64,0.08)",
            borderRadius: 10,
            padding: 20,
            gap: 12,
          }}
        >
          <Text style={{ color: "#C04040", fontSize: 16, fontWeight: "700" }}>
            Could not generate session
          </Text>
          <Pressable
            onPress={() => refetch()}
            style={({ pressed }) => ({
              backgroundColor: pressed ? "#E8784A" : "#D4603A",
              borderRadius: 9999,
              paddingVertical: 12,
              alignItems: "center",
            })}
          >
            <Text style={{ fontSize: 14, fontWeight: "600", color: "#fff" }}>Try again</Text>
          </Pressable>
        </View>
      )}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: "#F5EFE0", paddingTop: insets.top }}>
      <CalendarAgenda
        onStartSession={handleStartSession}
        renderTodayContent={renderTodayContent}
      />
    </View>
  );
}
```

**Step 2: Run type check**

```bash
cd /Users/richard/dev/gh/trainstackhq/prehab-app && bun run check-types
```

Expected: PASS

**Step 3: Commit**

```bash
git add apps/native/app/(tabs)/index.tsx
git commit -m "feat(native): refactor Home tab to use CalendarAgenda (PRE-61)"
```

---

## Task 12: Final verification

**Step 1: Run full type check**

```bash
cd /Users/richard/dev/gh/trainstackhq/prehab-app && bun run check-types
```

**Step 2: Run lint/format**

```bash
cd /Users/richard/dev/gh/trainstackhq/prehab-app && bun run check
```

**Step 3: Fix any issues, commit**

**Step 4: Update Linear ticket with summary comment**

Post a comment on PRE-61 summarizing:

- Files created/modified
- New API endpoint added
- Key design decisions (terracotta day pills, section labels, scaffold auto-generation on mount)
- How today's content preserves the existing readiness → generate → start flow
- react-native-calendars added as a dependency

**Step 5: Mark PRE-61 as Done in Linear**
