# Home Tab Redesign — Check-in + Workout Card

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the home tab so today's workout is shown directly (not gated behind readiness selection), with an integrated play button inside the card, a separate daily check-in component that opens a modal, and the streak counter moved into the calendar header next to "Today".

**Architecture:** The current readiness picker inline UI is replaced by two distinct components: (1) a `DailyCheckIn` card that opens a `CheckInSheet` bottom-sheet modal with low/normal/high + optional free text, and (2) a `TodayWorkoutCard` that shows the session with an integrated play button. The check-in sets readiness state which triggers session generation (same data flow, different presentation). The streak counter moves from the today content area into `CalendarHeader`.

**Tech Stack:** React Native, Expo Router, React Native Reanimated (for bottom sheet gestures — pattern from existing `feedback-rating-sheet.tsx`), existing oRPC hooks.

---

## Current State

- **Home tab** (`apps/native/app/(tabs)/index.tsx`): Renders `CalendarAgenda` with a `renderTodayContent` callback that shows the readiness picker ("How are you feeling?" with Low/Normal/High pills), session type selector, and then the generated session card + separate Start button below it.
- **CalendarAgenda** (`apps/native/components/calendar/CalendarAgenda.tsx:195`): Shows `renderTodayContent()` ONLY when `isTodayDate && !session` — meaning if a session already exists in the agenda (from a prior generation), it bypasses the custom content entirely and shows a generic `SessionItem`.
- **CalendarHeader** (`apps/native/components/calendar/CalendarHeader.tsx`): Shows month picker + "Today" button. No streak info.
- **Streak**: Currently displayed as a right-aligned text in `renderTodayContent` (index.tsx:62-75).

## Key Design Decisions

1. **Check-in IS readiness** — the daily check-in modal sets the same `readiness` state (low/normal/high) that drives session generation. No new API needed.
2. **No per-body-region check-in for now** — skip the "surface problem areas" feature. Just overall feeling + optional text.
3. **Session type selector stays** — keep it on the today content area (not in the modal).
4. **CalendarAgenda always renders today content** — remove the `!session` gate so the custom today view (check-in + workout card) always shows for today's date.
5. **Streak in header** — move streak counter next to the "Today" button in `CalendarHeader`.

---

### Task 1: Move streak counter into CalendarHeader

**Files:**

- Modify: `apps/native/components/calendar/CalendarHeader.tsx`
- Modify: `apps/native/components/calendar/CalendarAgenda.tsx` (pass streak prop)
- Modify: `apps/native/app/(tabs)/index.tsx` (remove inline streak, pass to CalendarAgenda)

**Step 1: Update CalendarHeader to accept and display streak**

Add a `streak` prop. Display it next to the "Today" button as `"🔥 N"` or just `"N day streak"` in JetBrains Mono, muted text. Only show when streak > 0.

```tsx
// CalendarHeader.tsx — add to props interface
interface CalendarHeaderProps {
  selectedDate: string;
  isDarkMode?: boolean;
  streak?: number; // NEW
  onTodayPress: () => void;
  onMonthPress: () => void;
}

// In the return, add streak display next to Today button:
// Before the Today button, add:
{
  streak != null && streak > 0 && (
    <Text
      style={{
        fontFamily: "JetBrains Mono",
        fontSize: 11,
        fontWeight: "600",
        color: c.textMuted,
      }}
    >
      {streak}d streak
    </Text>
  );
}
```

**Step 2: Thread streak through CalendarAgenda**

Add `streak?: number` to `CalendarAgendaProps` and pass it to `CalendarHeader`.

```tsx
// CalendarAgenda.tsx — update props
interface CalendarAgendaProps {
  isDarkMode?: boolean;
  streak?: number; // NEW
  onStartSession?: (sessionId: string) => void;
  renderTodayContent?: () => React.ReactNode;
}

// Pass to CalendarHeader:
<CalendarHeader
  selectedDate={selectedDate}
  isDarkMode={isDarkMode}
  streak={streak}  // NEW
  onTodayPress={handleTodayPress}
  onMonthPress={...}
/>
```

**Step 3: Pass streak from Home, remove inline streak display**

In `index.tsx`, pass `streak={currentStreak}` to `<CalendarAgenda>` and delete lines 62-75 (the inline streak display in `renderTodayContent`).

**Step 4: Verify visually**

Run: `bun run dev` and check the header shows streak next to Today button.

**Step 5: Commit**

```bash
git add apps/native/components/calendar/CalendarHeader.tsx apps/native/components/calendar/CalendarAgenda.tsx apps/native/app/\(tabs\)/index.tsx
git commit -m "refactor: move streak counter into CalendarHeader next to Today button"
```

---

### Task 2: Create CheckInSheet bottom-sheet modal

**Files:**

- Create: `apps/native/components/home/check-in-sheet.tsx`

**Step 1: Create the CheckInSheet component**

Follow the exact pattern from `feedback-rating-sheet.tsx` for the modal + pan gesture + backdrop. The sheet contains:

1. Title: "How are you feeling?" (Satoshi Bold, 22px)
2. Three feeling buttons: "Low energy", "Normal", "Feeling great" — styled as pills, same visual pattern as current readiness picker but larger/more prominent
3. Optional free-text input: placeholder "Anything to note..." (DM Sans, surface-2 background, r-md border radius)
4. "Done" button (terracotta pill, disabled until a feeling is selected)

Props:

```tsx
interface CheckInSheetProps {
  visible: boolean;
  onSubmit: (readiness: "low" | "normal" | "high", note?: string) => void;
  onClose: () => void;
}
```

```tsx
// apps/native/components/home/check-in-sheet.tsx
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";

type Readiness = "low" | "normal" | "high";

const FEELINGS: { value: Readiness; label: string; icon: string }[] = [
  { value: "low", label: "Low energy", icon: "battery-dead-outline" },
  { value: "normal", label: "Normal", icon: "battery-half-outline" },
  { value: "high", label: "Feeling great", icon: "battery-full-outline" },
];

interface CheckInSheetProps {
  visible: boolean;
  onSubmit: (readiness: Readiness, note?: string) => void;
  onClose: () => void;
}

export function CheckInSheet({ visible, onSubmit, onClose }: CheckInSheetProps) {
  const [selected, setSelected] = useState<Readiness | null>(null);
  const [note, setNote] = useState("");
  const translateY = useRef(new Animated.Value(400)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setSelected(null);
      setNote("");
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          damping: 25,
          stiffness: 300,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 400,
          damping: 25,
          stiffness: 300,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const dismiss = useCallback(() => {
    Keyboard.dismiss();
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 400,
        damping: 25,
        stiffness: 300,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start(() => onClose());
  }, [onClose, translateY, backdropOpacity]);

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      if (e.translationY > 0) {
        translateY.setValue(e.translationY);
      }
    })
    .onEnd((e) => {
      if (e.translationY > 100 || e.velocityY > 500) {
        dismiss();
      } else {
        Animated.spring(translateY, {
          toValue: 0,
          damping: 25,
          stiffness: 300,
          useNativeDriver: true,
        }).start();
      }
    });

  const handleSubmit = () => {
    if (!selected) return;
    dismiss();
    setTimeout(() => onSubmit(selected, note.trim() || undefined), 200);
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={dismiss}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ flex: 1, justifyContent: "flex-end" }}
        >
          <Animated.View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(0,0,0,0.4)",
              opacity: backdropOpacity,
            }}
          >
            <Pressable style={{ flex: 1 }} onPress={dismiss} />
          </Animated.View>

          <GestureDetector gesture={panGesture}>
            <Animated.View
              style={{
                backgroundColor: "#EDE4CF",
                borderTopLeftRadius: 16,
                borderTopRightRadius: 16,
                padding: 24,
                paddingBottom: 40,
                gap: 24,
                transform: [{ translateY }],
              }}
            >
              {/* Handle */}
              <View style={{ alignItems: "center" }}>
                <View
                  style={{
                    width: 36,
                    height: 4,
                    borderRadius: 2,
                    backgroundColor: "#C8BCA8",
                  }}
                />
              </View>

              <Text style={{ fontSize: 22, fontWeight: "700", color: "#1A2530" }}>
                How are you feeling?
              </Text>

              {/* Feeling options */}
              <View style={{ gap: 10 }}>
                {FEELINGS.map(({ value, label, icon }) => {
                  const isSelected = selected === value;
                  return (
                    <Pressable
                      key={value}
                      onPress={() => setSelected(value)}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 12,
                        backgroundColor: isSelected ? "rgba(212,96,58,0.10)" : "#E3D8BE",
                        borderWidth: isSelected ? 1.5 : 0,
                        borderColor: "#D4603A",
                        borderRadius: 10,
                        padding: 16,
                      }}
                    >
                      <Ionicons
                        name={icon as any}
                        size={20}
                        color={isSelected ? "#D4603A" : "#8B7D6B"}
                      />
                      <Text
                        style={{
                          fontSize: 16,
                          fontWeight: "600",
                          color: isSelected ? "#D4603A" : "#1A2530",
                        }}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Optional note */}
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Anything to note..."
                placeholderTextColor="#8B7D6B"
                multiline
                style={{
                  backgroundColor: "#E3D8BE",
                  borderRadius: 10,
                  padding: 16,
                  fontFamily: "DM Sans",
                  fontSize: 15,
                  color: "#1A2530",
                  minHeight: 60,
                  textAlignVertical: "top",
                }}
              />

              {/* Submit */}
              <Pressable
                onPress={handleSubmit}
                disabled={!selected}
                style={({ pressed }) => ({
                  backgroundColor: !selected ? "#C8BCA8" : pressed ? "#E8784A" : "#D4603A",
                  borderRadius: 9999,
                  paddingVertical: 16,
                  alignItems: "center",
                  opacity: !selected ? 0.6 : 1,
                })}
              >
                <Text style={{ fontSize: 16, fontWeight: "700", color: "#fff" }}>Done</Text>
              </Pressable>
            </Animated.View>
          </GestureDetector>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}
```

**Step 2: Commit**

```bash
git add apps/native/components/home/check-in-sheet.tsx
git commit -m "feat: add CheckInSheet bottom-sheet modal for daily check-in"
```

---

### Task 3: Redesign today content in Home tab

**Files:**

- Modify: `apps/native/app/(tabs)/index.tsx`
- Modify: `apps/native/components/calendar/CalendarAgenda.tsx` (remove `!session` gate)

**Step 1: Update CalendarAgenda to always render today content**

In `CalendarAgenda.tsx`, change the rendering logic at line 195 so `renderTodayContent` is always used for today, regardless of whether a session exists. Pass the agenda session to it so the today content can display it.

Change `renderTodayContent` prop type to accept the day's session:

```tsx
// CalendarAgenda.tsx — update prop type
interface CalendarAgendaProps {
  isDarkMode?: boolean;
  streak?: number;
  onStartSession?: (sessionId: string) => void;
  renderTodayContent?: (session?: AgendaSession) => React.ReactNode; // CHANGED
}
```

Change the render logic in `renderDayContent` (around line 195):

```tsx
// Replace the ternary at line 195-207 with:
{
  isTodayDate && renderTodayContent ? (
    renderTodayContent(session)
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
  );
}
```

**Step 2: Rewrite renderTodayContent in Home tab**

Replace the entire `renderTodayContent` in `index.tsx` with a new layout:

1. **Daily check-in card** — if readiness is not set, shows a card with "Daily check-in" title and a "Check in" button that opens the `CheckInSheet`. If readiness IS set, shows a compact "Checked in: Normal" summary with a change button.
2. **Session type selector** — same as current, shown after check-in is done.
3. **Today's workout card** — if session exists (from agenda OR from `useDailySession`), show session title, metadata, and an integrated play button INSIDE the card. If loading, show loading state inside a card shell. If no session and no readiness yet, show a muted "Complete your check-in to generate today's session" message.

Key changes to the data flow:

- Accept `agendaSession` parameter from CalendarAgenda
- If `agendaSession` exists and readiness is null, the user already generated a session earlier — show it directly without requiring check-in again
- The `useDailySession` hook is still used for fresh generation after check-in

```tsx
// index.tsx — new renderTodayContent (replaces lines 59-375)
const renderTodayContent = (agendaSession?: AgendaSession) => {
  // If there's an existing session from the agenda, use it directly
  const displaySession = session ?? agendaSession;
  const isCompleted = !!displaySession?.completedAt;
  const isResuming =
    !isCompleted &&
    session?.dropOffExerciseIndex != null &&
    session.dropOffExerciseIndex > 0;

  return (
    <View style={{ gap: 16 }}>
      {/* Daily Check-in Card */}
      {!displaySession && (
        <Pressable
          onPress={() => setShowCheckIn(true)}
          style={{
            backgroundColor: "#EDE4CF",
            borderRadius: 16,
            padding: 24,
            gap: 12,
          }}
        >
          <Text style={{ fontSize: 18, fontWeight: "700", color: "#1A2530" }}>
            Daily check-in
          </Text>
          <Text style={{ fontFamily: "DM Sans", fontSize: 14, color: "#8B7D6B" }}>
            How are you feeling today?
          </Text>
          <View
            style={{
              backgroundColor: "#D4603A",
              borderRadius: 9999,
              paddingVertical: 12,
              alignItems: "center",
              marginTop: 4,
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: "700", color: "#fff" }}>
              Check in
            </Text>
          </View>
        </Pressable>
      )}

      {/* Rest day (keep existing logic) */}
      {shouldRestDay && !restDayAcknowledged && (
        /* ... existing rest day card — keep as-is ... */
      )}

      {/* Loading */}
      {isLoading && (
        <View
          style={{
            backgroundColor: "#EDE4CF",
            borderRadius: 16,
            padding: 24,
            alignItems: "center",
            gap: 16,
          }}
        >
          <ActivityIndicator size="large" color="#D4603A" />
          <Text style={{ fontFamily: "DM Sans", fontSize: 16, color: "#8B7D6B" }}>
            Generating your session...
          </Text>
        </View>
      )}

      {/* Error */}
      {error && (
        /* ... existing error card — keep as-is ... */
      )}

      {/* Today's Workout Card — with integrated play button */}
      {displaySession && !isCompleted && (
        <View style={{ backgroundColor: "#EDE4CF", borderRadius: 16, padding: 24, gap: 16 }}>
          <Text
            style={{ fontSize: 28, fontWeight: "900", fontStyle: "italic", color: "#1A2530" }}
          >
            {displaySession.title}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {profile?.primarySport && (
              <View
                style={{
                  backgroundColor: "rgba(212,96,58,0.10)",
                  borderRadius: 6,
                  paddingVertical: 3,
                  paddingHorizontal: 8,
                }}
              >
                <Text
                  style={{
                    fontFamily: "JetBrains Mono",
                    fontSize: 10,
                    fontWeight: "700",
                    color: "#D4603A",
                    textTransform: "uppercase",
                  }}
                >
                  {profile.primarySport}
                </Text>
              </View>
            )}
            <Text style={{ fontFamily: "JetBrains Mono", fontSize: 11, color: "#8B7D6B" }}>
              {displaySession.exercises?.length ?? displaySession.exerciseCount} exercises
              {" · "}
              {displaySession.estimatedDurationMin} min
            </Text>
          </View>

          {/* Integrated play button — INSIDE the card */}
          <Pressable
            onPress={() => router.push(`/session/${displaySession.id}`)}
            style={({ pressed }) => ({
              backgroundColor: pressed ? "#E8784A" : "#D4603A",
              borderRadius: 9999,
              paddingVertical: 16,
              alignItems: "center",
            })}
          >
            <Text style={{ fontSize: 16, fontWeight: "700", color: "#fff" }}>
              {isResuming ? "Resume session →" : "Start session"}
            </Text>
          </Pressable>
        </View>
      )}

      {/* Session type selector — show when session exists but not completed */}
      {displaySession && !isCompleted && canRegenerate && (
        <View style={{ gap: 10 }}>
          <Text style={{ fontSize: 13, fontWeight: "500", color: "#8B7D6B" }}>
            Session type
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {/* ... existing session type pills — keep as-is ... */}
          </View>
        </View>
      )}

      {/* Regenerate button */}
      {canRegenerate && (
        <Pressable
          onPress={() => {
            regenerate.mutate({
              sessionDate: displaySession!.sessionDate ?? todayLocal(),
              readiness: readiness ?? "normal",
              sessionType,
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
          <Text style={{ fontSize: 14, fontWeight: "600", color: "#8B7D6B" }}>
            Regenerate session
          </Text>
        </Pressable>
      )}

      {/* Completed */}
      {isCompleted && (
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
            Session completed today
          </Text>
        </View>
      )}
    </View>
  );
};
```

**Step 3: Add CheckInSheet state and import**

At the top of the Home component, add:

```tsx
import { CheckInSheet } from "@/components/home/check-in-sheet";

// Inside Home():
const [showCheckIn, setShowCheckIn] = useState(false);

const handleCheckIn = (r: Readiness, _note?: string) => {
  setReadiness(r);
  setShowCheckIn(false);
  // Note: we're not persisting the note yet — can add later
};
```

At the bottom of the return, add the modal:

```tsx
return (
  <View style={{ flex: 1, backgroundColor: "#F5EFE0", paddingTop: insets.top }}>
    <CalendarAgenda
      streak={currentStreak}
      onStartSession={handleStartSession}
      renderTodayContent={renderTodayContent}
    />
    <CheckInSheet
      visible={showCheckIn}
      onSubmit={handleCheckIn}
      onClose={() => setShowCheckIn(false)}
    />
  </View>
);
```

**Step 4: Import `todayLocal` helper**

The `todayLocal` function is in `hooks/use-session.ts` but not exported. Either export it or inline the same logic. Simplest: just inline it since it's a one-liner.

```tsx
// At the top of index.tsx, add helper:
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
```

**Step 5: Import AgendaSession type**

```tsx
import type { AgendaSession } from "@/components/calendar/types";
```

**Step 6: Verify visually**

Run the app. Expected behavior:

- Open today → see "Daily check-in" card
- Tap "Check in" → modal opens with Low/Normal/High options
- Select one, tap Done → modal closes, session generates, workout card appears with play button inside
- If session already existed → workout card shows directly, no check-in card
- Swipe to other days → normal SessionItem / schedule / empty behavior
- Streak shows in header next to Today button

**Step 7: Commit**

```bash
git add apps/native/app/\(tabs\)/index.tsx apps/native/components/calendar/CalendarAgenda.tsx
git commit -m "feat: redesign home tab with check-in modal and integrated workout card"
```

---

### Task 4: Clean up — remove unused code

**Files:**

- Modify: `apps/native/app/(tabs)/index.tsx`

**Step 1: Remove dead code**

- Remove the `isAllLowCapacity` function if it's no longer used (it's still used for `shouldRestDay`, so keep it).
- Remove any leftover references to the old inline readiness picker that aren't used.
- Verify all imports are used.

**Step 2: Run linter**

```bash
cd /Users/richard/dev/gh/trainstackhq/prehab-app && bun run check
```

Fix any lint/format issues.

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: clean up unused code from home tab redesign"
```

---

### Task 5: Verify type safety

**Step 1: Run type checker**

```bash
cd /Users/richard/dev/gh/trainstackhq/prehab-app && bun run check-types
```

**Step 2: Fix any type errors**

The main potential issue: `displaySession` comes from two different types — `useDailySession` returns the full session with `exercises` array, while `AgendaSession` has `exerciseCount` instead. The workout card needs to handle both shapes:

```tsx
// Use exerciseCount for agenda sessions, exercises.length for generated sessions
const exerciseCount = displaySession.exercises?.length ?? displaySession.exerciseCount;
```

**Step 3: Commit if fixes needed**

```bash
git add -A
git commit -m "fix: resolve type mismatches in home tab session display"
```
