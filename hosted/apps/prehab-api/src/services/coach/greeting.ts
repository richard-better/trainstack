import type { FocusArea } from "@trainstack/prehab-contract";

import { answeredValue, loadProfileAnswers } from "../profile-projection";

import { getThreadForUser, persistMessage } from "./persistence";

// Human-readable labels for the focus-area slugs. Mirrors the tile labels in
// `apps/native/app/(onboarding)/focus-areas.tsx` — kept here so the seeded
// greeting reads naturally instead of leaking slugs ("ankles-calves").
const FOCUS_AREA_LABELS: Record<FocusArea, string> = {
  neck: "neck",
  shoulders: "shoulders",
  "upper-back": "upper back",
  "wrists-elbows": "wrists and elbows",
  core: "core",
  "lower-back": "lower back",
  glutes: "glutes",
  hips: "hips",
  thighs: "thighs",
  knees: "knees",
  "ankles-calves": "ankles and calves",
  feet: "feet",
};

function focusAreaLabel(area: string): string {
  return FOCUS_AREA_LABELS[area as FocusArea] ?? area.replace(/-/g, " ");
}

function firstName(name: string | null | undefined): string {
  if (!name) return "";
  return name.trim().split(/\s+/)[0] ?? "";
}

/** Joins a list as "a", "a and b", or "a, b, and c". */
function joinNatural(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

export interface GreetingInput {
  name: string | null;
  focusAreas: string[];
}

/**
 * Builds the Coach's opening turn for a fresh intake thread. Deterministic (no
 * LLM round-trip) so thread creation stays fast and can't fail — the user's
 * first reply is the first streaming round-trip (per PRE-109 scope).
 *
 * References the focus areas the user flagged in structured intake so the
 * conversation reads as a continuation of onboarding, and opens with a concrete
 * first question instead of waiting for the user to break the ice.
 */
export function buildCoachGreeting({ name, focusAreas }: GreetingInput): string {
  const fn = firstName(name);
  const open = fn ? `Hey ${fn} — ` : "Hey — ";

  if (focusAreas.length > 0) {
    const labels = focusAreas.map(focusAreaLabel);
    const list = joinNatural(labels);
    const first = labels[0]!;
    return (
      `${open}I'm your Coach, and I've already got your intake. You flagged ${list} ` +
      `as areas to focus on, so before I build your first session I'd like to understand those a bit better. ` +
      `Let's start with your ${first}: what's going on there, and what tends to set it off?`
    );
  }

  return (
    `${open}I'm your Coach, and I've already got your intake. Before I build your first session, ` +
    `is there anything about your body or training the questionnaire didn't capture — past injuries, ` +
    `niggles, or anything you'd want me to keep in mind?`
  );
}

/**
 * Seeds the opening assistant greeting on a brand-new intake thread. No-op when
 * the thread already has messages (resume), so it stays idempotent across the
 * repeated `startThread` calls the client makes on every `/coach` mount.
 */
export async function seedIntakeGreeting(userId: string, threadId: string): Promise<void> {
  const record = await getThreadForUser(userId, threadId);
  if (!record || record.messages.length > 0) return;

  const answers = await loadProfileAnswers(userId);
  const focusAreas = (answeredValue(answers, "focus-areas") as string[] | null) ?? [];
  const demographics = answeredValue(answers, "demographics") as { name?: string } | null;

  const greeting = buildCoachGreeting({
    name: demographics?.name ?? null,
    focusAreas,
  });

  await persistMessage(threadId, "assistant", [{ type: "text", text: greeting }]);
}
