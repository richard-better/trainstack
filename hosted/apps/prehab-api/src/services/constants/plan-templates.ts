/**
 * Curated plan templates — the real data behind Explore › Plans (PRE-144).
 *
 * Code-as-CMS, same model as the exercise catalogue (`exercises.ts`): this is
 * human-quality-controlled content that lives in code, not a DB table. The RPC
 * `plans.listTemplates` serves these directly and `plans.startFromTemplate`
 * looks one up by `id`; a started plan stores that `id` in `plans.planTemplateId`.
 *
 * ⚠️ PLACEHOLDER STRUCTURE ONLY. These week structures and session themes are
 * not curated — they exist so the screen renders and the start-plan flow works
 * end-to-end. Real, evidence-based plan content is Richard's to curate (see the
 * human-only follow-up ticket).
 */

import type { Sport } from "@trainstack/prehab-contract";

type SessionType = "prehab" | "recovery" | "mobility" | "activation";

/** One day in a plan's weekly blueprint; repeats for every week of the plan. */
export interface PlanScaffoldDay {
  /** 0-based offset within each week (0 = first day). */
  dayOffset: number;
  sessionTheme: string;
  sessionType: SessionType;
  /** Pre-generation title shown before any exercises exist. */
  title: string;
  estimatedDurationMin: number;
}

export interface PlanTemplate {
  /** Stable slug — stored on plans.planTemplateId when a user starts this plan. */
  id: string;
  title: string;
  description: string;
  durationWeeks: number;
  sessionsPerWeek: number;
  /** Free-text difficulty label, e.g. "Beginner" | "Intermediate" | "All Levels". */
  level: string;
  /** Empty = applies to all sports. */
  sportTags: Sport[];
  /** Weekly day blueprint the plan expands into. */
  scaffold: { days: PlanScaffoldDay[] };
  /** Lower = shown first. */
  sortOrder: number;
}

export const planTemplates: PlanTemplate[] = [
  {
    id: "runners-knee-prevention",
    title: "Runner's Knee Prevention",
    description:
      "Strengthen the muscles around your knees to prevent common running injuries. (Placeholder structure — content pending curation.)",
    durationWeeks: 6,
    sessionsPerWeek: 3,
    level: "Beginner",
    sportTags: ["running"],
    scaffold: {
      days: [
        {
          dayOffset: 0,
          sessionTheme: "Hip & glute activation",
          sessionType: "activation",
          title: "Hip & Glute Activation",
          estimatedDurationMin: 12,
        },
        {
          dayOffset: 2,
          sessionTheme: "Knee stability & control",
          sessionType: "prehab",
          title: "Knee Stability",
          estimatedDurationMin: 15,
        },
        {
          dayOffset: 4,
          sessionTheme: "Lower-body mobility",
          sessionType: "mobility",
          title: "Lower-Body Mobility",
          estimatedDurationMin: 10,
        },
      ],
    },
    sortOrder: 0,
  },
  {
    id: "climbers-shoulder-armor",
    title: "Climber's Shoulder Armor",
    description:
      "Bulletproof your shoulders for climbing with targeted prehab work. (Placeholder structure — content pending curation.)",
    durationWeeks: 8,
    sessionsPerWeek: 3,
    level: "Intermediate",
    sportTags: ["bouldering-climbing"],
    scaffold: {
      days: [
        {
          dayOffset: 0,
          sessionTheme: "Rotator cuff activation",
          sessionType: "activation",
          title: "Rotator Cuff Activation",
          estimatedDurationMin: 12,
        },
        {
          dayOffset: 3,
          sessionTheme: "Scapular control & pulling",
          sessionType: "prehab",
          title: "Scapular Control",
          estimatedDurationMin: 15,
        },
        {
          dayOffset: 5,
          sessionTheme: "Shoulder mobility & recovery",
          sessionType: "recovery",
          title: "Shoulder Recovery",
          estimatedDurationMin: 10,
        },
      ],
    },
    sortOrder: 1,
  },
  {
    id: "full-body-mobility-reset",
    title: "Full-Body Mobility Reset",
    description:
      "Address head-to-toe mobility restrictions with a structured program. (Placeholder structure — content pending curation.)",
    durationWeeks: 4,
    sessionsPerWeek: 5,
    level: "All Levels",
    sportTags: [],
    scaffold: {
      days: [
        {
          dayOffset: 0,
          sessionTheme: "Hips & lower back",
          sessionType: "mobility",
          title: "Hips & Lower Back",
          estimatedDurationMin: 12,
        },
        {
          dayOffset: 1,
          sessionTheme: "Thoracic spine & shoulders",
          sessionType: "mobility",
          title: "T-Spine & Shoulders",
          estimatedDurationMin: 12,
        },
        {
          dayOffset: 2,
          sessionTheme: "Ankles & feet",
          sessionType: "mobility",
          title: "Ankles & Feet",
          estimatedDurationMin: 10,
        },
        {
          dayOffset: 3,
          sessionTheme: "Active recovery flow",
          sessionType: "recovery",
          title: "Recovery Flow",
          estimatedDurationMin: 10,
        },
        {
          dayOffset: 4,
          sessionTheme: "Full-body integration",
          sessionType: "mobility",
          title: "Full-Body Flow",
          estimatedDurationMin: 15,
        },
      ],
    },
    sortOrder: 4,
  },
];

export function findPlanTemplateById(id: string): PlanTemplate | undefined {
  return planTemplates.find((t) => t.id === id);
}
