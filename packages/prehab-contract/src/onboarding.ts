import { z } from "zod";

import {
  DailySessionTimeEnum,
  EquipmentEnum,
  FocusAreaEnum,
  GenderEnum,
  GoalEnum,
  PreferredSessionTimeSchema,
  SportTimeBreakdownSchema,
  SportV2Enum,
} from "./index";

/**
 * Event-sourced onboarding answers.
 *
 * `QUESTIONS` is the single source of truth for every discrete question we ask.
 * Each entry owns its `id`, `version`, validation `answerSchema`, and the
 * skippability rule. The native client renders bespoke UI per screen but
 * imports its question metadata + schema from here so the server can validate
 * the same payloads it stores in `profile_answers`.
 *
 * Adding a new question: append a row to `QUESTIONS`, append the id to
 * `OnboardingFlow`, add the value to the `ProfileAnswer` discriminated union.
 * No DB migration. Bumping a question's `version` only affects new starts.
 */

// ── Demographics value (composite — name required, rest optional) ─────────
export const DemographicsValueSchema = z.object({
  name: z.string().min(1).max(120),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  gender: GenderEnum.nullable(),
});
export type DemographicsValue = z.infer<typeof DemographicsValueSchema>;

// Sports + per-sport time breakdown live as separate questions so we can ask
// them on separate screens, but the breakdown is only valid alongside the
// list — server-side cross-validation lives in the savePartial handler.
export const SportsValueSchema = z.array(SportV2Enum);
export type SportsValue = z.infer<typeof SportsValueSchema>;

export const SportTimeValueSchema = SportTimeBreakdownSchema;
export type SportTimeValue = z.infer<typeof SportTimeValueSchema>;

export const GoalsValueSchema = z.array(GoalEnum).min(1);
export type GoalsValue = z.infer<typeof GoalsValueSchema>;

export const FocusAreasValueSchema = z.array(FocusAreaEnum);
export type FocusAreasValue = z.infer<typeof FocusAreasValueSchema>;

export const EquipmentValueSchema = z.array(EquipmentEnum);
export type EquipmentValue = z.infer<typeof EquipmentValueSchema>;

export const DailyTimeValueSchema = DailySessionTimeEnum;
export type DailyTimeValue = z.infer<typeof DailyTimeValueSchema>;

export const PreferredTimeValueSchema = PreferredSessionTimeSchema;
export type PreferredTimeValue = z.infer<typeof PreferredTimeValueSchema>;

// `notifications` records the OS permission outcome (best-effort — the user
// can change it later in settings).
export const NotificationsValueSchema = z.object({
  optedIn: z.boolean(),
});
export type NotificationsValue = z.infer<typeof NotificationsValueSchema>;

// `disclaimer` and `welcome` carry no payload — `value: {}`. They exist as
// answers so resume can land on the correct screen and analytics see drop-off.
export const EmptyValueSchema = z.object({});
export type EmptyValue = z.infer<typeof EmptyValueSchema>;

// ── Question registry ────────────────────────────────────────────────────

export type QuestionMeta<S extends z.ZodTypeAny = z.ZodTypeAny> = {
  id: string;
  version: number;
  title: string;
  subtitle?: string;
  // Whether the user can advance without providing a value. `welcome` and
  // `disclaimer` are required-acknowledge gates; sport-time / preferred-time
  // are skippable. The screen owns the UI for skip — this just signals
  // whether the server should accept `{ skipped: true }`.
  skippable: boolean;
  answerSchema: S;
};

export const QUESTIONS = {
  welcome: {
    id: "welcome",
    version: 1,
    title: "A 3-minute setup so your sessions actually fit you.",
    skippable: false,
    answerSchema: EmptyValueSchema,
  },
  demographics: {
    id: "demographics",
    version: 1,
    title: "Tell us about you",
    subtitle: "Just the basics. Your name is required — the rest is optional.",
    skippable: false,
    answerSchema: DemographicsValueSchema,
  },
  sports: {
    id: "sports",
    version: 1,
    title: "What do you train for?",
    subtitle: "Pick everything you do regularly. Skip if nothing fits.",
    skippable: true,
    answerSchema: SportsValueSchema,
  },
  "sport-time": {
    id: "sport-time",
    version: 1,
    title: "How much per week?",
    subtitle: "Hours per week for each. We'll use this to weight your sessions.",
    skippable: false,
    answerSchema: SportTimeValueSchema,
  },
  goals: {
    id: "goals",
    version: 1,
    title: "What are you here for?",
    subtitle: "Pick at least one. All goals get equal weight.",
    skippable: false,
    answerSchema: GoalsValueSchema,
  },
  "focus-areas": {
    id: "focus-areas",
    version: 1,
    title: "Anywhere to focus?",
    subtitle: "Tap regions you want to focus on or where you have issues.",
    skippable: true,
    answerSchema: FocusAreasValueSchema,
  },
  equipment: {
    id: "equipment",
    version: 1,
    title: "What do you have?",
    subtitle: "We'll only prescribe exercises for the gear you own. None? Bodyweight is enough.",
    skippable: true,
    answerSchema: EquipmentValueSchema,
  },
  "daily-time": {
    id: "daily-time",
    version: 1,
    title: "How long per day?",
    subtitle: "Your time budget caps the session — Coach respects it.",
    skippable: false,
    answerSchema: DailyTimeValueSchema,
  },
  "preferred-time": {
    id: "preferred-time",
    version: 1,
    title: "When do you train?",
    subtitle: "We'll anchor your daily session and remind you at this time.",
    skippable: true,
    answerSchema: PreferredTimeValueSchema,
  },
  notifications: {
    id: "notifications",
    version: 1,
    title: "Make durability a habit",
    skippable: true,
    answerSchema: NotificationsValueSchema,
  },
  disclaimer: {
    id: "disclaimer",
    version: 1,
    title: "Important health notice",
    skippable: false,
    answerSchema: EmptyValueSchema,
  },
} as const satisfies Record<string, QuestionMeta>;

export type QuestionId = keyof typeof QUESTIONS;

export const QuestionIdSchema = z.enum(Object.keys(QUESTIONS) as [QuestionId, ...QuestionId[]]);

export const FlowVersion = 1;

/**
 * The ordered onboarding flow. Conditional skips (e.g. sport-time when no
 * sports were selected, notifications when no preferred time) are decided
 * client-side by the screen's "Continue" handler — the server treats every
 * question independently. `resumePoint` walks this list in order.
 */
export const OnboardingFlow: readonly QuestionId[] = [
  "welcome",
  "demographics",
  "sports",
  "sport-time",
  "goals",
  "focus-areas",
  "equipment",
  "daily-time",
  "preferred-time",
  "notifications",
  "disclaimer",
];

// ── Discriminated answer union ────────────────────────────────────────────

export const ProfileAnswerSchema = z.discriminatedUnion("questionId", [
  z.object({ questionId: z.literal("welcome"), value: EmptyValueSchema }),
  z.object({ questionId: z.literal("demographics"), value: DemographicsValueSchema }),
  z.object({ questionId: z.literal("sports"), value: SportsValueSchema }),
  z.object({ questionId: z.literal("sport-time"), value: SportTimeValueSchema }),
  z.object({ questionId: z.literal("goals"), value: GoalsValueSchema }),
  z.object({ questionId: z.literal("focus-areas"), value: FocusAreasValueSchema }),
  z.object({ questionId: z.literal("equipment"), value: EquipmentValueSchema }),
  z.object({ questionId: z.literal("daily-time"), value: DailyTimeValueSchema }),
  z.object({ questionId: z.literal("preferred-time"), value: PreferredTimeValueSchema }),
  z.object({ questionId: z.literal("notifications"), value: NotificationsValueSchema }),
  z.object({ questionId: z.literal("disclaimer"), value: EmptyValueSchema }),
]);

export type ProfileAnswer = z.infer<typeof ProfileAnswerSchema>;

// Map of questionId → its inferred value type. Convenient for the projection
// helper that hydrates structured intake from `profile_answers`.
export type AnswerValueByQuestion = {
  welcome: EmptyValue;
  demographics: DemographicsValue;
  sports: SportsValue;
  "sport-time": SportTimeValue;
  goals: GoalsValue;
  "focus-areas": FocusAreasValue;
  equipment: EquipmentValue;
  "daily-time": DailyTimeValue;
  "preferred-time": PreferredTimeValue;
  notifications: NotificationsValue;
  disclaimer: EmptyValue;
};
