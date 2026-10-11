# Session Feedback Form (PRE-60) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current all-negative feedback options ("Too easy", "Too hard", "Pain increased") with a rich feedback sheet featuring a 1-5 star rating, context-aware feedback chips (positive + negative), and an optional comment field.

**Architecture:** Replace the inline feedback pills in `CompletionView` with a new `FeedbackRatingSheet` bottom-sheet component inspired by the reference design. The sheet uses Reanimated + Gesture Handler for smooth pan-to-dismiss and star-slider interaction. The existing API contract widens `feedbackRating` from a 3-value enum to a 1-5 integer rating, adds `feedbackTags` (string array) and `feedbackComment` (string) fields. The completion screen stays as-is for the checkmark + capacity re-rating; the feedback sheet is a modal that opens from it.

**Tech Stack:** React Native, Reanimated 4, Gesture Handler, expo-linear-gradient (new install), expo-blur (new install), react-native-keyboard-controller (already installed)

---

## Task 1: Install missing packages

**Files:**

- Modify: `apps/native/package.json`

**Step 1: Install expo-blur and expo-linear-gradient**

```bash
cd apps/native && bun add expo-blur expo-linear-gradient
```

**Step 2: Commit**

```bash
git add apps/native/package.json bun.lock
git commit -m "chore: add expo-blur and expo-linear-gradient (PRE-60)"
```

---

## Task 2: Update API contract — widen feedback schema

The current `feedbackRating` is `z.enum(["too_easy", "too_hard", "pain_increased"]).nullable()`. We need to support a 1-5 star rating, selected feedback tags, and an optional comment.

**Files:**

- Modify: `packages/contract/src/index.ts` (lines 133-140, the `completeSession` input)

**Step 1: Update the contract input schema**

Replace the `completeSession` input with:

```typescript
const completeSession = oc
  .input(
    z.object({
      sessionId: z.string().min(1),
      feedbackRating: z.number().int().min(1).max(5).nullable().default(null),
      feedbackTags: z.array(z.string()).default([]),
      feedbackComment: z.string().max(500).default(""),
    }),
  )
  .output(z.object({ ok: z.boolean() }));
```

**Step 2: Run type check to see what breaks**

```bash
bun run check-types
```

Expected: errors in `completion-view.tsx`, `session/[id].tsx`, and the server handler where old enum values are referenced.

**Step 3: Commit**

```bash
git add packages/contract/src/index.ts
git commit -m "feat: widen session feedback schema to rating + tags + comment (PRE-60)"
```

---

## Task 3: Update DB schema + server handler

**Files:**

- Modify: `apps/server/src/db/schema/sessions.ts` (add `feedbackTags` and `feedbackComment` columns)
- Modify: `apps/server/src/rpc/router.ts` (lines 481-505, update `completeSession` handler)

**Step 1: Add new columns to sessions table**

In `apps/server/src/db/schema/sessions.ts`, add after the `feedbackRating` column:

```typescript
// Completion feedback: 1-5 star rating (null = skipped feedback)
feedbackRating: integer("feedback_rating"),
// Tags selected during feedback (e.g. ["felt_great", "less_stiff"])
feedbackTags: jsonb("feedback_tags").notNull().default([]),
// Optional free-text comment
feedbackComment: text("feedback_comment").notNull().default(""),
```

Note: `feedbackRating` changes from `text()` to `integer()`. This is a dev-only schema — use `db:push` not migrations.

**Step 2: Update the server handler to persist new fields**

In `apps/server/src/rpc/router.ts`, update the `completeSession` handler `.set()` call:

```typescript
await db
  .update(sessions)
  .set({
    completedAt: new Date(),
    feedbackRating,
    feedbackTags,
    feedbackComment,
  })
  .where(eq(sessions.id, sessionId));
```

Destructure the new fields from input:

```typescript
const { sessionId, feedbackRating, feedbackTags, feedbackComment } = input;
```

**Step 3: Push schema changes**

```bash
bun run db:push
```

**Step 4: Run type check**

```bash
bun run check-types
```

**Step 5: Commit**

```bash
git add apps/server/src/db/schema/sessions.ts apps/server/src/rpc/router.ts
git commit -m "feat: persist feedback rating, tags, and comment to sessions table (PRE-60)"
```

---

## Task 4: Create AnimatedText component

The reference design uses a character-by-character animated text component for the question text that changes based on rating. This is a reusable utility.

**Files:**

- Create: `apps/native/components/ui/animated-text.tsx`

**Step 1: Create the component**

Adapt the reference `AnimatedText` component to match Pre's design system. Key changes from reference:

- Keep the same animation logic (per-character enter/exit with spring + timing)
- No style changes needed — the parent passes style props

```typescript
import type { StyleProp, TextStyle } from "react-native";
import { StyleSheet } from "react-native";
import Animated, {
  LinearTransition,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";

interface AnimatedTextProps {
  text: string;
  style?: StyleProp<TextStyle>;
  delayGap?: number;
}

const SPRING_CONFIG = { damping: 18, stiffness: 200, mass: 1 };
const TIMING_DURATION = 300;
const DEFAULT_DELAY_GAP = 15;

export function AnimatedText({
  text,
  style,
  delayGap = DEFAULT_DELAY_GAP,
}: AnimatedTextProps) {
  const chars = Array.from(text);
  const transition = LinearTransition.springify()
    .damping(SPRING_CONFIG.damping)
    .stiffness(SPRING_CONFIG.stiffness)
    .mass(SPRING_CONFIG.mass);

  return (
    <Animated.View style={styles.container} layout={transition}>
      {chars.map((char, index) => (
        <AnimatedChar
          key={`${char}-${index}-${text}`}
          char={char}
          style={style}
          index={index}
          delayGap={delayGap}
        />
      ))}
    </Animated.View>
  );
}

function AnimatedChar({
  char,
  style,
  index,
  delayGap,
}: {
  char: string;
  style?: StyleProp<TextStyle>;
  index: number;
  delayGap: number;
}) {
  const delay = (index + 1) * delayGap;

  const entering = () => {
    "worklet";
    return {
      initialValues: {
        opacity: 0,
        transform: [{ translateY: -15 }, { scale: 0.5 }],
      },
      animations: {
        opacity: withDelay(delay, withTiming(1, { duration: TIMING_DURATION })),
        transform: [
          { translateY: withDelay(delay, withSpring(0, SPRING_CONFIG)) },
          { scale: withDelay(delay, withTiming(1, { duration: TIMING_DURATION })) },
        ],
      },
    };
  };

  const exiting = () => {
    "worklet";
    return {
      initialValues: {
        opacity: 1,
        transform: [{ translateY: 0 }, { scale: 1 }],
      },
      animations: {
        opacity: withDelay(delay, withTiming(0, { duration: TIMING_DURATION })),
        transform: [
          { translateY: withDelay(delay, withSpring(15, SPRING_CONFIG)) },
          { scale: withDelay(delay, withTiming(0.5, { duration: TIMING_DURATION })) },
        ],
      },
    };
  };

  const transition = LinearTransition.springify()
    .damping(SPRING_CONFIG.damping)
    .stiffness(SPRING_CONFIG.stiffness)
    .mass(SPRING_CONFIG.mass);

  return (
    <Animated.Text
      entering={entering}
      exiting={exiting}
      layout={transition}
      style={style}
    >
      {char}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
});
```

**Step 2: Commit**

```bash
git add apps/native/components/ui/animated-text.tsx
git commit -m "feat: add AnimatedText component for per-character animations (PRE-60)"
```

---

## Task 5: Create FeedbackRatingSheet component

This is the main deliverable — the bottom sheet with star rating, feedback chips, and comment input.

**Files:**

- Create: `apps/native/components/session/feedback-rating-sheet.tsx`

**Step 1: Create the component**

Adapt the reference component with these Pre design system changes:

**Colors (from DESIGN.md):**

- Sheet background: `#EDE4CF` (surface) in light mode
- Handle bar: `#C8BCA8` (faint)
- Star slider bg: `#E3D8BE` (surface-2)
- Title text: `#1A2530` (primary text), Satoshi Bold 24px
- Chip default: `#E3D8BE` bg, `#8B7D6B` text
- Chip selected: `rgba(212,96,58,0.10)` bg, `#D4603A` text, `#D4603A` border
- Comment input bg: `#E3D8BE`, placeholder `#8B7D6B`, text `#1A2530`
- Submit button: `#D4603A` bg, white text (terracotta pill)
- Cancel button: `#E3D8BE` bg, `#8B7D6B` text

**Rating gradient colors (warm palette):**

```typescript
const RATING_GRADIENT_COLORS: Record<number, [string, string, string]> = {
  1: ["#C04040", "#C04040", "#C04040"], // error red
  2: ["#C04040", "#C8893A", "#C8893A"], // red → amber
  3: ["#C8893A", "#C8893A", "#4A7A4E"], // amber → green
  4: ["#C8893A", "#4A7A4E", "#4A7A4E"], // amber → garden green
  5: ["#4A7A4E", "#4A7A4E", "#4A7A4E"], // all garden green
};
```

**Question text based on rating:**

```typescript
const getQuestionText = (rating: number): string => {
  if (rating <= 2) return "What could be better?";
  if (rating === 3) return "What stood out?";
  return "What did you like most?";
};
```

**Feedback options — mix of positive and negative:**

```typescript
const FEEDBACK_OPTIONS: FeedbackOption[] = [
  { id: "felt_great", label: "Felt great" },
  { id: "less_stiff", label: "Less stiff" },
  { id: "just_right", label: "Just right" },
  { id: "too_easy", label: "Too easy" },
  { id: "too_hard", label: "Too hard" },
  { id: "pain_increased", label: "Pain increased" },
  { id: "good_variety", label: "Good variety" },
  { id: "too_long", label: "Too long" },
];
```

**Key structural differences from reference:**

- No `appIcon` / `appName` props — replace with a header that says "How was your session?" in Satoshi Bold
- Use Pre's design tokens for all colors/spacing
- No BlurView backdrop — use simple semi-transparent overlay (lighter feel)
- Sheet border radius: 16px (`r-lg` from DESIGN.md)
- Pill buttons: `border-radius: 9999` (`r-full`)
- Comment icon: use `chatbubble-outline` instead of `create-outline`

**Props interface:**

```typescript
export interface FeedbackRatingSheetProps {
  visible: boolean;
  onClose: () => void;
  onSubmit?: (data: { rating: number; selectedOptions: string[]; comment: string }) => void;
}
```

The component body follows the same structure as the reference: Modal → backdrop → GestureDetector(pan) → sheet with handle, title, star slider (GestureDetector(pan) on the stars), expandable chips + comment section, submit/cancel button.

**Step 2: Verify it builds**

```bash
cd apps/native && npx expo export --platform ios --dump-sourcemap false 2>&1 | head -5
```

Or just run type-check:

```bash
bun run check-types
```

**Step 3: Commit**

```bash
git add apps/native/components/session/feedback-rating-sheet.tsx
git commit -m "feat: add FeedbackRatingSheet bottom-sheet component (PRE-60)"
```

---

## Task 6: Integrate into CompletionView + session runner

Wire the new sheet into the existing session completion flow.

**Files:**

- Modify: `apps/native/components/session/completion-view.tsx`
- Modify: `apps/native/app/session/[id].tsx` (lines 200-227)

**Step 1: Update CompletionView**

Replace the inline feedback pills section with a button that opens the feedback sheet. The flow becomes:

1. Session completes → CompletionView shows checkmark + "Session complete"
2. Below the title: "How was your session?" button opens FeedbackRatingSheet
3. User submits rating → sheet closes → feedback state stored
4. Capacity re-rating section stays as-is below
5. "Done" CTA at bottom submits everything

Update the `CompletionViewProps.onComplete` callback to accept the new shape:

```typescript
interface CompletionViewProps {
  onComplete: (feedback: {
    feedbackRating: number | null;
    feedbackTags: string[];
    feedbackComment: string;
    capacityRatings: Record<string, number> | null;
  }) => void;
  skippedCount: number;
  totalExercises: number;
}
```

Add state for sheet visibility and feedback data:

```typescript
const [showFeedbackSheet, setShowFeedbackSheet] = useState(false);
const [feedbackData, setFeedbackData] = useState<{
  rating: number;
  selectedOptions: string[];
  comment: string;
} | null>(null);
```

Replace the feedback pills section (lines 121-162) with:

```tsx
{/* Feedback */}
<View style={{ marginBottom: 32 }}>
  <Pressable
    onPress={() => setShowFeedbackSheet(true)}
    style={{
      backgroundColor: feedbackData ? "rgba(212,96,58,0.10)" : "#EDE4CF",
      borderRadius: 16,
      padding: 20,
      alignItems: "center",
      gap: 4,
      borderWidth: feedbackData ? 1 : 0,
      borderColor: "#D4603A",
    }}
  >
    <Text style={{
      fontSize: 14,
      fontWeight: "500",
      color: feedbackData ? "#D4603A" : "#1A2530",
    }}>
      {feedbackData
        ? `${feedbackData.rating} star${feedbackData.rating !== 1 ? "s" : ""} — tap to edit`
        : "How was your session?"}
    </Text>
    {!feedbackData && (
      <Text style={{ fontSize: 13, color: "#8B7D6B" }}>
        Tap to rate and help personalize tomorrow
      </Text>
    )}
  </Pressable>
</View>

<FeedbackRatingSheet
  visible={showFeedbackSheet}
  onClose={() => setShowFeedbackSheet(false)}
  onSubmit={(data) => {
    setFeedbackData(data);
    setShowFeedbackSheet(false);
  }}
/>
```

Update `handleDone` to pass the new shape:

```typescript
const handleDone = () => {
  onComplete({
    feedbackRating: feedbackData?.rating ?? null,
    feedbackTags: feedbackData?.selectedOptions ?? [],
    feedbackComment: feedbackData?.comment ?? "",
    capacityRatings: showCapacity ? capacityRatings : null,
  });
};
```

**Step 2: Update session runner handler**

In `apps/native/app/session/[id].tsx`, update `handleSessionComplete` (lines 200-227):

```typescript
const handleSessionComplete = useCallback(
  (feedback: {
    feedbackRating: number | null;
    feedbackTags: string[];
    feedbackComment: string;
    capacityRatings: Record<string, number> | null;
  }) => {
    completeSession.mutate({
      sessionId: session.id,
      feedbackRating: feedback.feedbackRating,
      feedbackTags: feedback.feedbackTags,
      feedbackComment: feedback.feedbackComment,
    });

    if (feedback.capacityRatings) {
      logCapacity.mutate({
        sessionId: session.id,
        capacityRatingsAfter: feedback.capacityRatings as CapacityRatings,
      });
    }

    router.back();
  },
  [session.id],
);
```

**Step 3: Run type check**

```bash
bun run check-types
```

**Step 4: Commit**

```bash
git add apps/native/components/session/completion-view.tsx apps/native/app/session/[id].tsx
git commit -m "feat: integrate FeedbackRatingSheet into session completion flow (PRE-60)"
```

---

## Task 7: Verify end-to-end

**Step 1: Start dev environment**

```bash
bun run dev
```

**Step 2: Manual test checklist**

- [ ] Complete a session → see "Session complete" screen with "How was your session?" card
- [ ] Tap the card → feedback sheet slides up
- [ ] Swipe stars or tap individual stars → gradient fills, question text changes
- [ ] Rating 1-2 shows "What could be better?" with negative chips prominent
- [ ] Rating 4-5 shows "What did you like most?" with positive chips prominent
- [ ] Select chips → they toggle with terracotta highlight
- [ ] Type a comment → keyboard avoidance works, sheet doesn't overlap
- [ ] Submit → sheet closes, card shows "X stars — tap to edit"
- [ ] Tap "Done" → session completes, data persisted
- [ ] Swipe sheet down → dismisses without submitting
- [ ] Check DB: `feedbackRating` is integer, `feedbackTags` is JSON array, `feedbackComment` is text

**Step 3: Run checks**

```bash
bun run check-types && bun run check
```

**Step 4: Final commit if any fixes needed**

---

## Notes for implementing agent

- **expo-blur**: If `BlurView` causes issues on Android or Expo Go, fall back to a simple `View` with `backgroundColor: "rgba(0,0,0,0.4)"`. The blur is nice-to-have, not essential.
- **Star slider gesture**: The reference uses `Gesture.Pan()` from gesture-handler. Make sure the star slider gesture doesn't conflict with the sheet's pan-to-dismiss gesture. The reference handles this by having the star slider only respond to horizontal gestures.
- **Dark mode**: Not required for this PR. All colors are hardcoded light mode from DESIGN.md. Dark mode theming is a separate ticket.
- **Haptics**: Consider adding `expo-haptics` feedback on star selection (`Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)`). It's already installed.
