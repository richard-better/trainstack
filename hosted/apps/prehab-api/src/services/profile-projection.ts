import { eq } from "drizzle-orm";

import {
  type AnswerValueByQuestion,
  type DemographicsValue,
  type EquipmentValue,
  type FocusAreasValue,
  type GoalsValue,
  type NotificationsValue,
  type PreferredTimeValue,
  type QuestionId,
  type SportTimeValue,
  type SportsValue,
  QUESTIONS,
} from "@trainstack/prehab-contract/onboarding";

import { db, profileAnswers, sportProfiles } from "../db";

export interface ProfileAnswerRecord {
  questionId: string;
  version: number;
  status: "answered" | "skipped";
  value: unknown;
  recordedAt: Date;
}

/**
 * Loads every answer the user has recorded, keyed by questionId. Skipped
 * answers carry `status: "skipped"` and `value: null`.
 */
export async function loadProfileAnswers(
  userId: string,
): Promise<Record<string, ProfileAnswerRecord>> {
  const rows = await db.select().from(profileAnswers).where(eq(profileAnswers.userId, userId));

  const out: Record<string, ProfileAnswerRecord> = {};
  for (const r of rows) {
    out[r.questionId] = {
      questionId: r.questionId,
      version: r.version,
      status: r.status as "answered" | "skipped",
      value: r.value,
      recordedAt: r.recordedAt,
    };
  }
  return out;
}

/**
 * Returns the answered value for `questionId`, or null when the user hasn't
 * answered (or skipped). Use this server-side to read fields the slim
 * `sport_profiles` row no longer holds.
 */
export function answeredValue<Q extends QuestionId>(
  answers: Record<string, ProfileAnswerRecord>,
  questionId: Q,
): AnswerValueByQuestion[Q] | null {
  const entry = answers[questionId];
  if (!entry) return null;
  if (entry.status !== "answered") return null;
  return entry.value as AnswerValueByQuestion[Q];
}

/**
 * Hydrated structured profile assembled from `profile_answers` + the slim
 * `sport_profiles` row. This is the shape server-side generators consume —
 * it preserves the legacy field names so we don't have to re-thread the call
 * sites that already speak this dialect.
 */
export interface HydratedProfile {
  primarySport: string;
  sports: string[];
  trainingVolumeHrsPerWeek: number;
  preferredSessionTime: string | null;
  onboardingCompletedAt: Date | null;
  name: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  goals: string[];
  focusAreas: string[];
  equipment: string[];
  dailySessionTimeMin: number | null;
  sportTimeBreakdown: Record<string, string>;
}

const BUCKET_RANK: Record<string, number> = {
  "<1": 1,
  "1-3": 2,
  "3-5": 3,
  "5-10": 4,
  "10+": 5,
};

function bucketMidpointHrs(bucket: string): number {
  switch (bucket) {
    case "<1":
      return 0.5;
    case "1-3":
      return 2;
    case "3-5":
      return 4;
    case "5-10":
      return 7.5;
    case "10+":
      return 12;
    default:
      return 0;
  }
}

/**
 * Derives `primarySport` from a sports list + per-sport time breakdown.
 * Tie-broken by the order sports appear in the list (stable).
 */
export function derivePrimarySport(
  sports: string[],
  sportTimeBreakdown: Record<string, string>,
): string {
  let primary = sports[0] ?? "";
  let bestRank = sports[0] ? (BUCKET_RANK[sportTimeBreakdown[sports[0]] ?? ""] ?? 0) : 0;
  for (const sport of sports) {
    const rank = BUCKET_RANK[sportTimeBreakdown[sport] ?? ""] ?? 0;
    if (rank > bestRank) {
      bestRank = rank;
      primary = sport;
    }
  }
  return primary;
}

export type PrimarySportConfidence = "dominant" | "tied" | "n/a";

// `primarySport` is tie-broken by list order, so it can mislabel multi-sport
// athletes when two sports share the top bucket (e.g. cycling 10+ AND strength
// 10+). The prompt needs to know whether the label is a dominance signal or
// just a stable artifact — when tied, framing should be multi-sport, not
// "you're a cyclist."
export function derivePrimarySportConfidence(
  sports: string[],
  sportTimeBreakdown: Record<string, string>,
): PrimarySportConfidence {
  if (sports.length === 0) return "n/a";
  if (sports.length === 1) return "dominant";
  let top = 0;
  let topCount = 0;
  for (const s of sports) {
    const rank = BUCKET_RANK[sportTimeBreakdown[s] ?? ""] ?? 0;
    if (rank > top) {
      top = rank;
      topCount = 1;
    } else if (rank === top) {
      topCount++;
    }
  }
  if (top === 0) return "n/a";
  return topCount === 1 ? "dominant" : "tied";
}

export function deriveTrainingVolumeHrs(sportTimeBreakdown: Record<string, string>): number {
  return Object.values(sportTimeBreakdown).reduce((sum, b) => sum + bucketMidpointHrs(b), 0);
}

/**
 * Hydrates the structured profile by joining the slim row against the
 * answers table. Returns null when the user has no `sport_profiles` row yet.
 */
export async function hydrateProfile(userId: string): Promise<HydratedProfile | null> {
  const profileRows = await db.select().from(sportProfiles).where(eq(sportProfiles.userId, userId));
  const slim = profileRows[0];
  if (!slim) return null;

  const answers = await loadProfileAnswers(userId);

  const demographics = answeredValue(answers, "demographics");
  const sports = (answeredValue(answers, "sports") as SportsValue | null) ?? [];
  const sportTime =
    (answeredValue(answers, "sport-time") as SportTimeValue | null) ??
    ({} as Record<string, string>);
  const goals = (answeredValue(answers, "goals") as GoalsValue | null) ?? [];
  const focusAreas = (answeredValue(answers, "focus-areas") as FocusAreasValue | null) ?? [];
  const equipment = (answeredValue(answers, "equipment") as EquipmentValue | null) ?? [];
  const dailyTime = answeredValue(answers, "daily-time");
  const dailySessionTimeMin = dailyTime ? Number(dailyTime) : null;

  return {
    primarySport: slim.primarySport,
    sports: sports as string[],
    trainingVolumeHrsPerWeek: deriveTrainingVolumeHrs(sportTime as Record<string, string>),
    preferredSessionTime: slim.preferredSessionTime,
    onboardingCompletedAt: slim.onboardingCompletedAt,
    name: (demographics as DemographicsValue | null)?.name ?? null,
    dateOfBirth: (demographics as DemographicsValue | null)?.dateOfBirth ?? null,
    gender: (demographics as DemographicsValue | null)?.gender ?? null,
    goals: goals as string[],
    focusAreas: focusAreas as string[],
    equipment: equipment as string[],
    dailySessionTimeMin,
    sportTimeBreakdown: sportTime as Record<string, string>,
  };
}

/**
 * Builds a natural-language "Q: …\nA: …" projection of the user's structured
 * intake. Read by the Coach in place of the typed `CoachContext` bag, and by
 * the intake-summary path so the same prose is the canonical context.
 */
export function buildStructuredIntakeProse(answers: Record<string, ProfileAnswerRecord>): string {
  const lines: string[] = [];
  for (const id of Object.keys(QUESTIONS) as QuestionId[]) {
    const meta = QUESTIONS[id];
    const entry = answers[id];
    if (!entry) continue; // unseen — omit
    if (entry.status === "skipped") {
      lines.push(`Q: ${meta.title}\nA: (skipped)`);
      continue;
    }
    const formatted = formatAnswer(id, entry.value);
    if (formatted == null) continue;
    lines.push(`Q: ${meta.title}\nA: ${formatted}`);
  }
  return lines.join("\n\n");
}

function formatAnswer<Q extends QuestionId>(questionId: Q, value: unknown): string | null {
  switch (questionId) {
    case "welcome":
    case "disclaimer":
      return null;
    case "demographics": {
      const v = value as DemographicsValue;
      const parts: string[] = [`Name ${v.name}`];
      if (v.dateOfBirth) parts.push(`DOB ${v.dateOfBirth}`);
      if (v.gender) parts.push(`Gender ${v.gender}`);
      return parts.join("; ");
    }
    case "sports": {
      const v = value as SportsValue;
      return v.length > 0 ? v.join(", ") : "(none selected)";
    }
    case "sport-time": {
      const v = value as SportTimeValue;
      const entries = Object.entries(v as Record<string, string>);
      if (entries.length === 0) return "(none)";
      return entries.map(([s, b]) => `${s} ${b}h/wk`).join(", ");
    }
    case "goals":
      return (value as GoalsValue).join(", ");
    case "focus-areas": {
      const v = value as FocusAreasValue;
      return v.length > 0 ? v.join(", ") : "(none)";
    }
    case "equipment": {
      const v = value as EquipmentValue;
      return v.length > 0 ? v.join(", ") : "(none — bodyweight only)";
    }
    case "daily-time":
      return `${value as string} min`;
    case "preferred-time":
      return value as PreferredTimeValue;
    case "notifications": {
      const v = value as NotificationsValue;
      return v.optedIn ? "opted in" : "declined";
    }
    default:
      return null;
  }
}
