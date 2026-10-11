import { anthropic } from "./durable/runtime";
import { google } from "./durable/runtime";
import { generateObject as _generateObject } from "./durable/runtime";
import { z } from "zod";

// Typed loosely so tests can inject a mock without fighting Zod v3/v4 type mismatch.
// Production code passes the real generateObject via the default parameter.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GenerateObjectFn = (params: any) => Promise<{ object: any }>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ModelLike = any;

import type { GeneratedSession, IntakeSummary } from "@trainstack/prehab-contract";

import {
  findExerciseByName,
  exerciseVideoKey,
  PLACEHOLDER_VIDEO_KEY,
  getExerciseNamesForSportsAndEquipment,
} from "./constants/exercises";
import { getMediaPublicUrl } from "../lib/s3";
import { logger } from "../lib/logger";

export interface ScaffoldItem {
  date: string;
  sessionTheme: string;
  sessionType: "prehab" | "recovery" | "mobility" | "activation";
}

// Model ids live in a dependency-light module so lightweight consumers (Coach
// stream, observability) can import them without pulling in S3 / `bun`. Kept
// re-exported here for the existing import sites.
import { GEMINI_MODEL, CLAUDE_MODEL, PROMPT_VERSION } from "./llm/models";
export { GEMINI_MODEL, CLAUDE_MODEL, PROMPT_VERSION };

const GENERATION_TIMEOUT_MS = 30_000;

// ─── AI response schemas (videoUrl looked up server-side, not generated) ──────

const AIExerciseSchema = z.object({
  name: z.string(),
  sets: z.number().int().min(1).max(5),
  reps: z.number().int().min(1).nullable(),
  durationSec: z.number().int().min(5).nullable(),
  restSec: z.number().int().min(0).max(180),
  side: z.enum(["bilateral", "left_right"]),
  formCues: z.array(z.string()).max(3),
});

// Exported so the admin playground (PRE-130) can run a single generation call
// against this exact schema while showing the raw structured output.
export const AISessionSchema = z.object({
  title: z.string().max(120),
  estimatedDurationMin: z.number().int().min(1).max(30),
  reasoningShort: z.string().min(1).max(140),
  reasoningLong: z.string().min(1).max(600),
  exercises: z.array(AIExerciseSchema).min(1).max(5),
});

const ScaffoldItemSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sessionTheme: z.string().max(120),
  sessionType: z.enum(["prehab", "recovery", "mobility", "activation"]),
});

const ScaffoldResponseSchema = z.object({
  schedule: z.array(ScaffoldItemSchema).min(1).max(14),
});

type AISession = z.infer<typeof AISessionSchema>;

// ─── Input / output types ─────────────────────────────────────────────────────

export interface DailyGenerationInputs {
  sport: string;
  sports: string[];
  readiness: "low" | "normal" | "high";
  // "check_in" when readiness came from today's daily check-in; "default" when
  // the worker fell back to the request default. The prompt uses this to decide
  // whether "Readiness: normal" is real signal or noise.
  readinessSource?: "check_in" | "default";
  // Whether primarySport reflects real dominance or is a tie-broken artifact
  // (multi-sport athletes with two top buckets). When "tied", the prompt should
  // talk about multi-sport training, not single out the primary label.
  primarySportConfidence?: "dominant" | "tied" | "n/a";
  trainingVolumeHrs: number;
  sessionTheme?: string | null;
  // Provenance of today's theme. "weekly_scaffold" = chosen by the program
  // scheduler (the LLM should *explain* it, not take credit). "on_demand" =
  // user requested it via ad-hoc. "none" = no theme.
  sessionThemeSource?: "weekly_scaffold" | "on_demand" | "none";
  sessionType?: "prehab" | "recovery" | "mobility" | "activation" | null;
  yesterdayFeedback?: string | null;
  yesterdayCapacityAfter?: Record<string, number> | null;
  name?: string | null;
  age?: number | null;
  gender?: string | null;
  goals?: string[];
  focusAreas?: string[];
  equipment?: string[];
  dailySessionTimeMin?: number | null;
  sportTimeBreakdown?: Record<string, string>;
  intakeSummary?: IntakeSummary | null;
  // Position within the user's active plan (PRE-147). Feeds plan-contextual
  // titles ("Week 3 of 6 · Building load tolerance") — null when no active plan.
  planWeek?: number | null;
  planTotalWeeks?: number | null;
  // Active plan headline/subtitle/themes from the reveal copy (PRE-154). Lets
  // the daily prompt keep the same voice the user saw on the reveal screen and
  // throughout the plan. Null when no active plan or copy wasn't produced.
  planHeadline?: string | null;
  planSubtitle?: string | null;
  planThemes?: string[] | null;
}

export interface DailyGenerationOptions {
  // Lean tap-through path (PRE-147): a single fast model, no cross-model
  // fallback, and a selection-focused prompt. The plan already fixes structure
  // (theme, type, length, focus, equipment), so the model only selects and
  // sequences from the curated catalogue rather than inventing a session —
  // which keeps the no-check-in tap-through under a few seconds.
  lean?: boolean;
}

export interface ScaffoldGenerationInputs {
  sport: string;
  trainingVolumeHrs: number;
  startDate: string;
  daysAhead: number;
  goals?: string[];
  focusAreas?: string[];
  sportTimeBreakdown?: Record<string, string>;
  intakeSummary?: IntakeSummary | null;
}

export interface DailyGenerationResult {
  session: GeneratedSession;
  generationContext: object;
}

// ─── Prompt builders ──────────────────────────────────────────────────────────

export function buildDailySystemPrompt(
  inputs: DailyGenerationInputs,
  exerciseNames: string[],
  opts: { lean?: boolean } = {},
): string {
  const {
    sport,
    readiness,
    readinessSource,
    primarySportConfidence,
    sessionTheme,
    sessionThemeSource,
    sessionType,
    yesterdayFeedback,
    yesterdayCapacityAfter,
    name,
    age,
    gender,
    goals,
    focusAreas,
    equipment,
    dailySessionTimeMin,
    sportTimeBreakdown,
    intakeSummary,
    planWeek,
    planTotalWeeks,
    planHeadline,
    planSubtitle,
    planThemes,
  } = inputs;

  const sessionTypeLabel = sessionType ?? "prehab";
  const timeBudget = dailySessionTimeMin ?? 15;
  // Lean path: the plan fixes structure, so frame the task as selection +
  // sequencing from the catalogue (not invention) to maximise first-try
  // catalogue compliance and avoid the correction round-trip (PRE-147).
  const intro = opts.lean
    ? `You are a sports physiologist assembling a ${sessionTypeLabel} session${name ? ` for ${name}` : ""} by selecting and sequencing exercises from the fixed catalogue below. The plan already sets the structure — your job is selection and ordering, not invention.`
    : `You are a sports physiologist generating a ${sessionTypeLabel} session${name ? ` for ${name}` : ""}.`;
  const lines: string[] = [
    intro,
    "",
    "## PROFILE / INTAKE (STATIC)",
    "These fields are from onboarding and coach-chat history. They describe typical training, reported injuries, flagged regions, and goals. Use as constraints and context — never present them as fresh observation of today.",
  ];
  if (age != null) lines.push(`- Age: ${age}`);
  if (gender) lines.push(`- Gender: ${gender}`);
  if (primarySportConfidence === "tied") {
    lines.push(
      `- Primary sport label: ${sport || "—"} (TIED — multiple sports share top volume; treat as multi-sport, do not single out this sport in the copy)`,
    );
  } else {
    lines.push(`- Primary sport: ${sport || "no specific sport"}`);
  }
  if (sportTimeBreakdown && Object.keys(sportTimeBreakdown).length > 0) {
    const breakdown = Object.entries(sportTimeBreakdown)
      .map(([s, b]) => `${s} ${b}h/wk`)
      .join(", ");
    lines.push(`- Typical weekly hours (averages, not this-week observation): ${breakdown}`);
  }

  if (goals && goals.length > 0) {
    lines.push("- Goals (equally weighted):");
    for (const g of goals) lines.push(`  · ${g}`);
  }

  if (focusAreas && focusAreas.length > 0) {
    lines.push(`- Regions flagged at signup: ${focusAreas.join(", ")}`);
  }

  if (intakeSummary) {
    if (Object.keys(intakeSummary.regions ?? {}).length > 0) {
      lines.push(`- Intake regions: ${JSON.stringify(intakeSummary.regions)}`);
    }
    if ((intakeSummary.currentInjuries ?? []).length > 0) {
      lines.push(
        `- Injuries reported at intake (HARD CONSTRAINTS — never load): ${JSON.stringify(intakeSummary.currentInjuries)}`,
      );
    }
    if (intakeSummary.goalsContext) {
      lines.push(`- Goal context: ${intakeSummary.goalsContext}`);
    }
    if ((intakeSummary.constraints ?? []).length > 0) {
      lines.push(`- Intake constraints: ${intakeSummary.constraints.join("; ")}`);
    }
  }

  // Plan-arc context (PRE-154). The user already saw the headline + themes on
  // the reveal screen; surfacing them here keeps the daily voice consistent.
  // Internal labels never appear in user copy — see WRITING RULES.
  const hasPlanArc =
    planHeadline != null ||
    planSubtitle != null ||
    (planThemes != null && planThemes.length > 0) ||
    (planWeek != null && planTotalWeeks != null);
  if (hasPlanArc) {
    lines.push(
      "",
      "## PLAN ARC",
      "The multi-week plan the user is on. Echo its voice (concrete, plain). Never quote the headline back at the user.",
    );
    if (planHeadline) lines.push(`- Plan headline: ${planHeadline}`);
    if (planSubtitle) lines.push(`- Plan subtitle: ${planSubtitle}`);
    if (planThemes && planThemes.length > 0) {
      lines.push(`- Plan themes: ${planThemes.join(" | ")}`);
    }
    if (planWeek != null && planTotalWeeks != null) {
      lines.push(`- Plan position: week ${planWeek} of ${planTotalWeeks}`);
    }
  }

  lines.push(
    "",
    "## TODAY'S SLOT",
    "What the user's plan calls for today. You did not choose this — explain it, don't take credit. Use 'planned' / 'today's plan' / 'on-demand' in your copy; NEVER 'scaffold' or 'scheduled for today' (internal terms).",
  );
  if (sessionTheme) {
    const themeSourceLabel =
      sessionThemeSource === "on_demand"
        ? "on-demand (user requested)"
        : sessionThemeSource === "weekly_scaffold"
          ? "planned"
          : "planned";
    lines.push(`- Theme: ${sessionTheme} (${themeSourceLabel})`);
  } else {
    lines.push("- Theme: (none — no specific theme for today)");
  }
  lines.push(`- Time budget: ${timeBudget} min`);
  lines.push(
    `- Available equipment: ${equipment && equipment.length > 0 ? equipment.join(", ") : "bodyweight only"}`,
  );

  lines.push(
    "",
    "## TODAY (DYNAMIC)",
    "Day-specific facts. Words like 'today', 'this week', 'currently', 'recently', or 'flare-up' are only permitted if supported here.",
  );
  if (readinessSource === "check_in") {
    lines.push(`- Readiness (from check-in): ${readiness}`);
  } else {
    lines.push(
      `- Readiness: ${readiness} (DEFAULT — no check-in done today; do not treat this as a fresh signal)`,
    );
  }
  if (yesterdayFeedback) {
    lines.push(`- Yesterday: ${yesterdayFeedback}`);
  }
  if (yesterdayCapacityAfter) {
    lines.push(`- Yesterday's post-session capacity: ${JSON.stringify(yesterdayCapacityAfter)}`);
  }
  if (!yesterdayFeedback && !yesterdayCapacityAfter && readinessSource !== "check_in") {
    lines.push("- (No dynamic signal today — do not invent observations.)");
  }

  if (sessionType && !opts.lean) {
    const typeDescriptions: Record<string, string> = {
      activation:
        "Focus on neuromuscular activation and movement prep — dynamic warm-up exercises that prime muscles for sport.",
      mobility:
        "Focus on joint mobility and flexibility — controlled range-of-motion exercises, not static stretching.",
      recovery:
        "Focus on active recovery — gentle movement, light stretching, and blood flow promotion. Lower intensity than normal.",
      prehab:
        "Focus on injury prevention — strengthen weak links and address imbalances for the athlete's sport.",
    };
    lines.push("", `Session type: ${sessionType}. ${typeDescriptions[sessionType]}`);
  }

  lines.push(
    "",
    "## RULES",
    `- Max 5 exercises, ≤${timeBudget} min total.`,
    "- Use ONLY equipment in the available list.",
    "- Readiness: Low = reduce sets by 1, prefer lower-impact; High = full protocol.",
    "- Never load reported injuries. If a flagged region overlaps with an intake aggravator, exclude exercises that match the aggravator pattern.",
    "",
    `## EXERCISE CATALOGUE (use ONLY these names, exact match): ${exerciseNames.join(", ")}.`,
    "",
    "## WRITING RULES",
    "- Treat sport breakdown and weekly hours as typical averages. Do NOT describe them as observed recent load.",
    "- If primary sport is TIED (see PROFILE), talk about 'training' or 'multi-sport training' — do not single out one sport.",
    '- For planned themes, lead with "Today\'s plan…" — you did not choose it.',
    '- For on-demand themes, lead with the user\'s request ("Quick X since you asked for…").',
    "- When citing intake data, mark the source: 'you flagged at signup', 'based on your intake', 'issues you reported'.",
    "- Do NOT write unsupported phrases. The model has no this-week data unless TODAY (DYNAMIC) provides it. Banned unless supported:",
    "  · 'this week', 'lately', 'currently', 'recently', 'post-ride', 'after the bike'",
    "  · 'big cycling week', 'all that mileage', 'your hips are tight today'",
    "  · 'current flare-up' (intake injuries are constraints, not observed current state)",
    "  · 'I have excluded', 'this session prioritizes', 'tailored to', 'targets X while avoiding Y'",
    "  · 'let's', 'we're going to', 'together' (coach-imitation filler)",
    "- INTERNAL TERMINOLOGY — never appears in user-facing copy:",
    "  · 'weekly scaffold', 'the scaffold', 'as per the weekly scaffold', 'per the scaffold'",
    "  · 'scheduled for today', 'the scheduler', 'session theme source'",
    "  · Replace with 'your plan', \"today's plan\", or just 'today'.",
    "- Do NOT include safety/disclaimer language in the reasoning fields. Safety lives in the UI, not the coach voice.",
    "",
    "## TITLE",
    "- 2–4 words. Name today's focus, not a list of exercises. ≤60 chars.",
    "- No 'for [goal]' suffix. No colons. Examples: 'Hip & low back', 'Knee stability', 'Shoulder reset'.",
    "",
    "## REASONING FIELDS",
    '- reasoningShort: a one-sentence WHY-NOW hook. ≤140 chars. The UI already shows duration, exercise count, and modality — do NOT restate them. Do NOT list body parts; lead with the user\'s goal, constraint, or reason this slot matters. Think "what does the user get out of this session."',
    "- reasoningLong (exactly 2 sentences, ≤300 chars total):",
    "  · Sentence 1: what today's session does. Lead with \"Today's plan…\" when the theme is planned.",
    "  · Sentence 2: one constraint or context note, source-labeled. Stop there.",
    "- Second-person, plain language, no bullet lists.",
    "",
    "## EXAMPLES",
    "Five worked examples below. Match this voice and structure. Do not copy phrasing verbatim.",
    "",
    "### Example 1 — Multi-sport, planned theme, injuries, no check-in",
    "INPUT:",
    "  PROFILE: 34M; sports cycling 10+, strength 10+, running 5-10, others 1-3; flagged 8 regions; injuries: shoulder calcification + left shin periostitis; primary sport TIED; goal: sustainable high training volume.",
    "  PLAN ARC: headline '12 weeks. Train hard, stay healthy.' themes: Hips & low back | Thoracic & shoulders | Knee tracking | Ankle & lower leg.",
    "  TODAY'S SLOT: Theme 'Hip flexor release and lumbar decompression' (planned). 20 min, bodyweight.",
    "  TODAY: Readiness normal (DEFAULT). No yesterday.",
    "OUTPUT:",
    '  title: "Hip & low back reset"',
    '  reasoningShort: "Buys you sustainable training volume by quieting the hips before they get cranky."',
    '  reasoningLong: "Today\'s plan opens the hips and decompresses the low back. Bodyweight and ground-based so it works around the shoulder and shin issues you flagged at signup."',
    "",
    "### Example 2 — Low readiness check-in (real dynamic signal)",
    "INPUT:",
    "  PROFILE: 28F runner; running 5-10; focus knees, hips, ankles; no injuries.",
    "  PLAN ARC: headline 'Run pain-free in 12 weeks.' themes: Knee tracking | Hip stability | Ankle mobility.",
    "  TODAY'S SLOT: Theme 'Knee stability and control' (planned). 15 min, band.",
    "  TODAY: Readiness LOW (check_in). Yesterday: completed, comment: 'legs felt heavy'.",
    "OUTPUT:",
    '  title: "Knee stability"',
    '  reasoningShort: "Pulled the intensity back since your legs are still heavy — control without strain."',
    '  reasoningLong: "Today\'s plan is knee stability — pulled intensity down a notch since you flagged low readiness and heavy legs in the check-in. Fewer sets, slower tempo."',
    "",
    "### Example 3 — On-demand session (user-initiated)",
    "INPUT:",
    "  PROFILE: 31M climber; climbing 5-10, strength 1-3; focus shoulders, fingers, core; no injuries.",
    "  PLAN ARC: headline 'Climb stronger, hurt less.' themes: Shoulder stability | Finger care | Core control.",
    "  TODAY'S SLOT: Theme 'Quick shoulder prep' (on-demand — user requested).",
    "  TODAY: Readiness not asked.",
    "OUTPUT:",
    '  title: "Shoulder prep"',
    '  reasoningShort: "Primes the shoulders so you can climb without that warm-up cost."',
    '  reasoningLong: "Quick shoulder primer — rotator cuff and scapular control — since you asked for shoulder prep. Kept tight so it slots in before your session."',
    "",
    "### Example 4 — Yesterday feedback drives today",
    "INPUT:",
    "  PROFILE: 42M lifter; strength 10+, running 1-3; focus lower-back, hips; no injuries.",
    "  PLAN ARC: headline 'A spine that holds up under load.' themes: Hips & low back | Hinge mechanics | Active recovery.",
    "  TODAY'S SLOT: Theme 'Active recovery — lower body' (planned). 20 min.",
    "  TODAY: Readiness normal (check_in). Yesterday: completed, comment: 'back felt rough on hinges'.",
    "OUTPUT:",
    '  title: "Lower-body recovery"',
    '  reasoningShort: "Gives the spine a break today since hinges felt rough yesterday."',
    '  reasoningLong: "Today\'s plan is gentle hip and low-back mobility. Going easier on the spine since you mentioned the back felt rough on hinges yesterday — slow range of motion, no end-range loading."',
    "",
    "### Example 5 — Sparse profile, first session",
    "INPUT:",
    "  PROFILE: 25F; cycling 1-3 only; flagged lower-back, hips; no injuries.",
    "  PLAN ARC: headline 'A reliable daily 15.' themes: Hip mobility | Low-back care | Core basics.",
    "  TODAY'S SLOT: Theme 'Hip mobility basics' (planned). 15 min, bodyweight.",
    "  TODAY: Readiness normal (DEFAULT).",
    "OUTPUT:",
    '  title: "Hip mobility"',
    '  reasoningShort: "Builds the hip range you flagged at signup — repeatable as your daily 15."',
    '  reasoningLong: "Today\'s plan covers foundational hip mobility — one of the regions you flagged at signup. Bodyweight, easy to repeat as a daily reset."',
  );

  return lines.join("\n");
}

function buildScaffoldSystemPrompt(inputs: ScaffoldGenerationInputs): string {
  const {
    sport,
    trainingVolumeHrs,
    startDate,
    daysAhead,
    goals,
    focusAreas,
    sportTimeBreakdown,
    intakeSummary,
  } = inputs;

  const isMultiSport = sportTimeBreakdown != null && Object.keys(sportTimeBreakdown).length > 1;
  const lines: string[] = [
    "You are a sports physiologist designing a multi-week prehab program schedule.",
    "",
    "## ATHLETE",
  ];
  if (isMultiSport) {
    lines.push(`- Sports (multi-sport athlete): ${Object.keys(sportTimeBreakdown).join(", ")}`);
  } else {
    lines.push(`- Primary sport: ${sport || "no specific sport"}`);
  }

  if (sportTimeBreakdown && Object.keys(sportTimeBreakdown).length > 0) {
    const breakdown = Object.entries(sportTimeBreakdown)
      .map(([s, b]) => `${s} ${b}h/wk`)
      .join(", ");
    lines.push(`- Typical weekly hours (averages): ${breakdown}`);
  } else {
    lines.push(`- Typical weekly volume: ${trainingVolumeHrs} hrs/week`);
  }

  if (goals && goals.length > 0) {
    lines.push("", "## GOALS (treat as equally weighted, vary themes to address each)");
    for (const g of goals) lines.push(`- ${g}`);
  }

  lines.push("", "## FOCUS AREAS");
  if (focusAreas && focusAreas.length > 0) {
    lines.push(
      `User flagged these for attention or pain: ${focusAreas.join(", ")}.`,
      "Schedule themes that target these areas across the window.",
    );
  } else {
    lines.push("User did not flag specific areas — vary themes broadly across joints/regions.");
  }

  if (intakeSummary) {
    if ((intakeSummary.currentInjuries ?? []).length > 0) {
      lines.push(
        "",
        "## CURRENT INJURIES — schedule around, not into",
        `- ${JSON.stringify(intakeSummary.currentInjuries)}`,
        "Do NOT schedule themes that load injured areas; favor mobility/recovery days that support those regions instead.",
      );
    }
    if ((intakeSummary.constraints ?? []).length > 0) {
      lines.push(`- constraints: ${intakeSummary.constraints.join("; ")}`);
    }
  }

  lines.push(
    "",
    "## SCHEDULE",
    `- Generate exactly ${daysAhead} sessions starting from ${startDate} (inclusive).`,
    "- Vary session types: prehab (2-3×/week), mobility (1-2×/week), activation (1×/week), recovery (1×/week).",
    "- Themes (≤80 chars each): name the focus, no 'for [sport]' or 'for [goal]' suffix.",
    "  · Good: 'Hip flexor release and lumbar mobility', 'Knee stability and control'.",
    "  · Bad: 'Lumbar Decompression and Hip Flexor Mobilization for Cycling Endurance'.",
    "- For multi-sport athletes, name themes by movement/region, not by one sport.",
  );

  return lines.join("\n");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function allExercisesInCatalogue(session: AISession): boolean {
  return session.exercises.every((ex) => findExerciseByName(ex.name) != null);
}

function enrichWithVideoUrl(aiSession: AISession): GeneratedSession {
  return {
    title: aiSession.title,
    estimatedDurationMin: aiSession.estimatedDurationMin,
    reasoningShort: aiSession.reasoningShort,
    reasoningLong: aiSession.reasoningLong,
    exercises: aiSession.exercises.map((ex) => {
      const catalogueEx = findExerciseByName(ex.name);
      const exerciseId = catalogueEx?.id ?? ex.name.toLowerCase().replace(/\s+/g, "-");
      const videoKey = catalogueEx ? exerciseVideoKey(catalogueEx) : PLACEHOLDER_VIDEO_KEY;
      const videoUrl = getMediaPublicUrl(videoKey);
      return {
        id: exerciseId,
        name: ex.name,
        sets: ex.sets,
        reps: ex.reps,
        durationSec: ex.durationSec,
        restSec: ex.restSec,
        side: ex.side,
        formCues: ex.formCues,
        videoUrl,
      };
    }),
  };
}

// ─── Model resolution ────────────────────────────────────────────────────────

export interface ModelConfig {
  model: ModelLike;
  name: string;
}

export function getModels(): ModelConfig[] {
  const models: ModelConfig[] = [{ model: google(GEMINI_MODEL), name: GEMINI_MODEL }];
  // Add Claude as secondary model only if ANTHROPIC_API_KEY is configured
  if (process.env.ANTHROPIC_API_KEY) {
    models.push({ model: anthropic(CLAUDE_MODEL), name: CLAUDE_MODEL });
  }
  return models;
}

// PRE-147: the tap-through (no-check-in) path uses a single fast model with no
// cross-model fallback. The plan fixes structure, so generation is catalogue
// selection — a lean call that lands in a few seconds. Resilience on this path
// comes from a user-initiated regenerate (and PRE-138 async retry), not a
// heavier fallback chain that widens the latency tail.
export function getLeanDailyModels(): ModelConfig[] {
  return [{ model: google(GEMINI_MODEL), name: GEMINI_MODEL }];
}

// ─── Try a single model with one retry for catalogue mismatches ──────────────

async function tryDailyWithModel(
  { model, name: _name }: ModelConfig,
  systemPrompt: string,
  exerciseNames: string[],
  generateObjectFn: GenerateObjectFn,
): Promise<AISession | null> {
  // Attempt 1
  let validated: AISession | null = null;
  try {
    const result = await generateObjectFn({
      model,
      schema: AISessionSchema,
      system: systemPrompt,
      prompt: "Generate the prehab session now.",
      abortSignal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
    });
    validated = result.object as AISession;
  } catch {
    return null;
  }

  if (allExercisesInCatalogue(validated)) return validated;

  // Attempt 2: retry with correction prompt for catalogue mismatches
  try {
    const retryResult = await generateObjectFn({
      model,
      schema: AISessionSchema,
      system: systemPrompt,
      prompt: `Your previous response included exercise names not in the approved catalogue. Use ONLY these exact names: ${exerciseNames.join(", ")}.`,
      temperature: 0.2,
      abortSignal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
    });
    const retrySession = retryResult.object as AISession;
    return allExercisesInCatalogue(retrySession) ? retrySession : null;
  } catch {
    return null;
  }
}

// ─── Daily session generation ─────────────────────────────────────────────────

/**
 * Generates a daily prehab session via cascading model fallback.
 *
 * Fallback chain: Gemini → retry once → Claude → retry once → error.
 * Each model gets two attempts: one fresh, one correction if exercise names miss the catalogue.
 * Claude is only used if ANTHROPIC_API_KEY is configured.
 * Throws if all models fail.
 */
export async function generateDailySessionWithAI(
  inputs: DailyGenerationInputs,
  generateObjectFn: GenerateObjectFn = _generateObject as GenerateObjectFn,
  models: ModelConfig[] = getModels(),
  options: DailyGenerationOptions = {},
): Promise<DailyGenerationResult> {
  const exerciseNames = getExerciseNamesForSportsAndEquipment(
    inputs.sports,
    inputs.equipment ?? [],
  );
  const systemPrompt = buildDailySystemPrompt(inputs, exerciseNames, { lean: options.lean });

  const inputsSnapshot = {
    sport: inputs.sport,
    readiness: inputs.readiness,
    sessionTheme: inputs.sessionTheme ?? null,
    sessionType: inputs.sessionType ?? null,
    goals: inputs.goals ?? null,
    focusAreas: inputs.focusAreas ?? null,
    equipment: inputs.equipment ?? null,
    dailySessionTimeMin: inputs.dailySessionTimeMin ?? null,
    intakeSummaryPresent: !!inputs.intakeSummary,
  };

  // Count every model call (fresh + catalogue-correction retries, across models)
  // and measure wall-clock so p50/p95 latency is queryable from the persisted
  // generationContext and the structured log line below (PRE-147).
  let attempts = 0;
  const countedGenerate: GenerateObjectFn = (params) => {
    attempts += 1;
    return generateObjectFn(params);
  };
  const startedAt = Date.now();

  for (const modelConfig of models) {
    const aiSession = await tryDailyWithModel(
      modelConfig,
      systemPrompt,
      exerciseNames,
      countedGenerate,
    );
    if (aiSession) {
      const durationMs = Date.now() - startedAt;
      logger.info(
        {
          evt: "daily_session_generated",
          model: modelConfig.name,
          lean: !!options.lean,
          durationMs,
          attempts,
        },
        "daily session generated",
      );
      return {
        session: enrichWithVideoUrl(aiSession),
        generationContext: {
          model: modelConfig.name,
          promptVersion: PROMPT_VERSION,
          lean: !!options.lean,
          durationMs,
          attempts,
          inputsSnapshot,
        },
      };
    }
  }

  // All models exhausted → error
  logger.warn(
    {
      evt: "daily_session_generation_failed",
      lean: !!options.lean,
      durationMs: Date.now() - startedAt,
      attempts,
    },
    "daily session generation failed: all models exhausted",
  );
  throw new Error("All AI models failed to generate a session. Please try again later.");
}

// ─── Plan-reveal copy generation (PRE-153) ───────────────────────────────────

const BANNED_REVEAL_PHRASES = [
  "unlock",
  "journey",
  "tailored",
  "personalized",
  "holistic",
  "optimize your",
  "unleash",
];
// em-dash (U+2014), en-dash (U+2013). Banned even in the retry — they read AI-slop.
const BANNED_DASHES = ["—", "–"];

export interface RevealCopyInputs {
  name: string | null;
  durationWeeks: number;
  sport: string;
  sports: string[];
  goals: string[];
  focusAreas: string[];
  intakeSummary: IntakeSummary | null;
  // Distinct sessionTheme strings drawn from the freshly-generated scaffold,
  // so the reveal-screen "plan themes" relate to what the user will actually do.
  scaffoldThemes: string[];
}

export interface RevealCopy {
  headline: string;
  subtitle: string | null;
  themes: string[];
}

const RevealCopySchema = z.object({
  headline: z.string().min(1),
  subtitle: z.string().nullable(),
  themes: z.array(z.string().min(1)).min(3).max(5),
});

function hasBannedPhrase(text: string): boolean {
  const lower = text.toLowerCase();
  if (BANNED_REVEAL_PHRASES.some((p) => lower.includes(p))) return true;
  if (BANNED_DASHES.some((d) => text.includes(d))) return true;
  return false;
}

function revealHitsBan(copy: RevealCopy): boolean {
  if (hasBannedPhrase(copy.headline)) return true;
  if (copy.subtitle && hasBannedPhrase(copy.subtitle)) return true;
  return false;
}

function buildRevealSystemPrompt(inputs: RevealCopyInputs, strict: boolean): string {
  const { name, durationWeeks, sport, sports, goals, focusAreas, intakeSummary, scaffoldThemes } =
    inputs;
  const lines: string[] = [
    "You are writing the reveal-screen copy for a personalised prehab/mobility plan.",
    "Your output is the user's first impression of their plan — short, concrete, voice-y.",
    "",
    "## ATHLETE",
  ];
  if (name) lines.push(`- Name: ${name}`);
  if (sport) lines.push(`- Primary sport: ${sport}`);
  if (sports.length > 0) lines.push(`- Sports: ${sports.join(", ")}`);
  if (goals.length > 0) lines.push(`- Goals: ${goals.join(", ")}`);
  if (focusAreas.length > 0) lines.push(`- Focus areas: ${focusAreas.join(", ")}`);
  if ((intakeSummary?.currentInjuries ?? []).length > 0) {
    lines.push(`- Current injuries reported: ${JSON.stringify(intakeSummary?.currentInjuries)}`);
  }
  if ((intakeSummary?.constraints ?? []).length > 0) {
    lines.push(`- Constraints: ${intakeSummary?.constraints.join("; ")}`);
  }
  lines.push(
    "",
    "## PLAN",
    `- Duration: ${durationWeeks} weeks.`,
    `- Themes from the generated schedule: ${scaffoldThemes.length > 0 ? scaffoldThemes.join(" | ") : "(none yet — invent 3–5 sensible themes from the profile)"}`,
    "",
    "## OUTPUT FIELDS",
    '- `headline` — a short, declarative line. Examples: "12 weeks. Run pain-free.", "Shoulders & shins, rebuilt.", "Climb stronger, hurt less."',
    '- `subtitle` — one short clause under the headline, or null. Example: "12 weeks · 5 sessions/week". Optional.',
    '- `themes` — 3 to 5 short bullet labels (≤ 40 chars each) summarising the plan\'s focuses. Examples: "Hips & lower back", "Thoracic & shoulders", "Knee tracking".',
    "",
    "## VOICE",
    "- Confident, plain English. Second person OK but never gushing.",
    "- No marketing speak, no metaphors about journeys.",
    "- Themes are short labels, not sentences.",
    "",
    "## BANNED WORDS (NEVER USE)",
    "- unlock, journey, tailored, personalized, holistic, optimize your, unleash",
    "- em-dashes (—) or en-dashes (–) — use periods or commas instead.",
  );
  if (strict) {
    lines.push(
      "",
      "Your previous output used a banned word or dash. Rewrite from scratch and choose different wording.",
    );
  }
  return lines.join("\n");
}

/**
 * Generates the reveal-screen copy (headline / subtitle / themes) for a freshly
 * built plan (PRE-153). Single call against the fast tier. If the first output
 * trips a banned phrase, retry once with a stricter prompt; if the retry also
 * hits, accept it anyway (we'd rather ship the model's words than fall back to
 * a template).
 *
 * Returns null when every model fails outright — the caller stores nulls and
 * the reveal screen renders without a custom headline.
 */
export async function generateRevealCopyWithAI(
  inputs: RevealCopyInputs,
  generateObjectFn: GenerateObjectFn = _generateObject as GenerateObjectFn,
  models: ModelConfig[] = getLeanDailyModels(),
): Promise<RevealCopy | null> {
  for (const { model } of models) {
    let first: RevealCopy | null = null;
    try {
      const result = await generateObjectFn({
        model,
        schema: RevealCopySchema,
        system: buildRevealSystemPrompt(inputs, false),
        prompt: "Write the reveal copy now.",
        abortSignal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
      });
      first = result.object as RevealCopy;
    } catch {
      continue;
    }

    if (!revealHitsBan(first)) return first;

    // Strict retry — but if the retry also hits, accept it. We never want to
    // fall back to a template at this point in the funnel.
    try {
      const retry = await generateObjectFn({
        model,
        schema: RevealCopySchema,
        system: buildRevealSystemPrompt(inputs, true),
        prompt: "Write the reveal copy now, avoiding the banned words.",
        temperature: 0.4,
        abortSignal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
      });
      return retry.object as RevealCopy;
    } catch {
      return first;
    }
  }
  return null;
}

// ─── Weekly scaffold generation ───────────────────────────────────────────────

/**
 * Generates a 7–14 day program schedule using cascading model fallback.
 * Tries each configured model once. Throws if all models fail.
 */
export async function generateWeeklyScaffoldWithAI(
  inputs: ScaffoldGenerationInputs,
  generateObjectFn: GenerateObjectFn = _generateObject as GenerateObjectFn,
  models: ModelConfig[] = getModels(),
): Promise<ScaffoldItem[]> {
  const systemPrompt = buildScaffoldSystemPrompt(inputs);

  for (const { model } of models) {
    try {
      const result = await generateObjectFn({
        model,
        schema: ScaffoldResponseSchema,
        system: systemPrompt,
        prompt: `Generate the ${inputs.daysAhead}-day schedule starting ${inputs.startDate}.`,
        abortSignal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
      });
      return (result.object as { schedule: ScaffoldItem[] }).schedule;
    } catch {
      continue;
    }
  }

  throw new Error("All AI models failed to generate the weekly scaffold. Please try again later.");
}
