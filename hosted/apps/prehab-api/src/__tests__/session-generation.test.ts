import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Session generation tests.
 *
 * generateDailySessionWithAI accepts optional generateObjectFn and models parameters.
 * Tests pass a vi.fn() mock and explicit model configs to avoid real API calls.
 */

// Stub the s3 lib — its `import { S3Client } from "bun"` doesn't resolve under vitest's vite runner.
vi.mock("../lib/s3", () => ({
  getMediaPublicUrl: (key: string) => `https://example.com/media/${key}`,
}));

import {
  generateDailySessionWithAI,
  GEMINI_MODEL,
  CLAUDE_MODEL,
  type DailyGenerationInputs,
  type ModelConfig,
} from "../services/session-generator";

// ─── Fixture data ─────────────────────────────────────────────────────────────

const BASE_INPUTS: DailyGenerationInputs = {
  sport: "running",
  sports: ["running"],
  readiness: "normal",
  trainingVolumeHrs: 5,
  sessionTheme: "Runner's Knee Prevention",
  yesterdayFeedback: null,
  yesterdayCapacityAfter: null,
  goals: ["prevent-future"],
  focusAreas: ["knees"],
  equipment: [],
  dailySessionTimeMin: 15,
  sportTimeBreakdown: { running: "3-5" },
};

/** Valid session object with exercise names that exist in the catalogue. */
const VALID_SESSION_OBJECT = {
  title: "Runner's Knee Prevention",
  estimatedDurationMin: 12,
  reasoningShort: "Targeting knee stability · based on your runner's knee focus",
  reasoningLong:
    "Your schedule calls for runner's-knee prevention today. Glute bridges and bird dogs build the hip and core control that keeps the knee tracking cleanly, while single-leg heel raises shore up the calf and achilles so the knee isn't absorbing every impact.",
  exercises: [
    {
      name: "Glute Bridge (Double-Leg)",
      sets: 3,
      reps: 15,
      durationSec: null,
      restSec: 30,
      side: "bilateral",
      formCues: ["Drive through heels", "Squeeze glutes", "Core engaged"],
    },
    {
      name: "Bird Dog",
      sets: 3,
      reps: 12,
      durationSec: null,
      restSec: 20,
      side: "left_right",
      formCues: ["Extend opposite arm and leg", "Keep core braced", "Move slowly"],
    },
    {
      name: "Single-Leg Heel Raise",
      sets: 3,
      reps: 12,
      durationSec: null,
      restSec: 30,
      side: "left_right",
      formCues: ["Full range", "Control descent", "Balance on forefoot"],
    },
  ],
};

const UNKNOWN_EXERCISE_SESSION = {
  ...VALID_SESSION_OBJECT,
  exercises: [
    {
      name: "Unknown Exercise XYZ",
      sets: 3,
      reps: 10,
      durationSec: null,
      restSec: 20,
      side: "bilateral",
      formCues: ["cue"],
    },
  ],
};

const GEMINI_CONFIG: ModelConfig = { model: "gemini-mock", name: GEMINI_MODEL };
const CLAUDE_CONFIG: ModelConfig = { model: "claude-mock", name: CLAUDE_MODEL };
const BOTH_MODELS: ModelConfig[] = [GEMINI_CONFIG, CLAUDE_CONFIG];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("generateDailySessionWithAI", () => {
  let mockGenerateObject: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGenerateObject = vi.fn();
  });

  it("happy path: valid AI response → session returned with videoUrl", async () => {
    mockGenerateObject.mockResolvedValueOnce({ object: VALID_SESSION_OBJECT });

    const result = await generateDailySessionWithAI(BASE_INPUTS, mockGenerateObject, BOTH_MODELS);

    expect(result.session.title).toBe("Runner's Knee Prevention");
    expect(result.session.exercises).toHaveLength(3);
    expect(result.session.exercises[0]).toMatchObject({
      name: "Glute Bridge (Double-Leg)",
      side: "bilateral",
      videoUrl: expect.any(String),
    });
    expect(result.session.reasoningShort).toBe(
      "Targeting knee stability · based on your runner's knee focus",
    );
    expect(result.session.reasoningLong).toMatch(/runner's-knee prevention/);
    expect(result.generationContext).toMatchObject({ model: GEMINI_MODEL });
    expect(mockGenerateObject).toHaveBeenCalledTimes(1);
  });

  it("Gemini error → Claude succeeds → session from Claude", async () => {
    mockGenerateObject
      .mockRejectedValueOnce(new Error("Gemini 500"))
      .mockResolvedValueOnce({ object: VALID_SESSION_OBJECT });

    const result = await generateDailySessionWithAI(BASE_INPUTS, mockGenerateObject, BOTH_MODELS);

    expect(result.generationContext).toMatchObject({ model: CLAUDE_MODEL });
    // Gemini failed on attempt 1, Claude succeeded on attempt 1
    expect(mockGenerateObject).toHaveBeenCalledTimes(2);
  });

  it("Gemini bad exercises + retry fails → Claude succeeds → session from Claude", async () => {
    mockGenerateObject
      .mockResolvedValueOnce({ object: UNKNOWN_EXERCISE_SESSION }) // Gemini attempt 1
      .mockResolvedValueOnce({ object: UNKNOWN_EXERCISE_SESSION }) // Gemini retry
      .mockResolvedValueOnce({ object: VALID_SESSION_OBJECT }); // Claude attempt 1

    const result = await generateDailySessionWithAI(BASE_INPUTS, mockGenerateObject, BOTH_MODELS);

    expect(result.generationContext).toMatchObject({ model: CLAUDE_MODEL });
    expect(mockGenerateObject).toHaveBeenCalledTimes(3);
  });

  it("both models fail → throws error", async () => {
    mockGenerateObject
      .mockRejectedValueOnce(new Error("Gemini 500")) // Gemini attempt 1
      .mockRejectedValueOnce(new Error("Claude 500")); // Claude attempt 1

    await expect(
      generateDailySessionWithAI(BASE_INPUTS, mockGenerateObject, BOTH_MODELS),
    ).rejects.toThrow("All AI models failed to generate a session");
  });

  it("exercise not in catalogue → retries with correction prompt → throws when still invalid", async () => {
    // Both Gemini calls return unknown exercises, both Claude calls return unknown exercises
    mockGenerateObject
      .mockResolvedValueOnce({ object: UNKNOWN_EXERCISE_SESSION })
      .mockResolvedValueOnce({ object: UNKNOWN_EXERCISE_SESSION })
      .mockResolvedValueOnce({ object: UNKNOWN_EXERCISE_SESSION })
      .mockResolvedValueOnce({ object: UNKNOWN_EXERCISE_SESSION });

    await expect(
      generateDailySessionWithAI(BASE_INPUTS, mockGenerateObject, BOTH_MODELS),
    ).rejects.toThrow("All AI models failed to generate a session");
    // 2 attempts per model × 2 models = 4
    expect(mockGenerateObject).toHaveBeenCalledTimes(4);
  });

  it("exercise not in catalogue on first call → valid exercises on retry → session returned", async () => {
    mockGenerateObject
      .mockResolvedValueOnce({ object: UNKNOWN_EXERCISE_SESSION })
      .mockResolvedValueOnce({ object: VALID_SESSION_OBJECT });

    const result = await generateDailySessionWithAI(BASE_INPUTS, mockGenerateObject, BOTH_MODELS);

    expect(result.session.exercises[0]?.name).toBe("Glute Bridge (Double-Leg)");
    expect(result.generationContext).toMatchObject({ model: GEMINI_MODEL });
    expect(mockGenerateObject).toHaveBeenCalledTimes(2);
    // Retry call should use lower temperature
    expect(mockGenerateObject.mock.calls[1]![0]).toMatchObject({ temperature: 0.2 });
  });

  it("API error on retry after catalogue miss → falls through to Claude", async () => {
    mockGenerateObject
      .mockResolvedValueOnce({ object: UNKNOWN_EXERCISE_SESSION }) // Gemini attempt 1
      .mockRejectedValueOnce(new Error("API 500")) // Gemini retry fails
      .mockResolvedValueOnce({ object: VALID_SESSION_OBJECT }); // Claude attempt 1

    const result = await generateDailySessionWithAI(BASE_INPUTS, mockGenerateObject, BOTH_MODELS);

    expect(result.generationContext).toMatchObject({ model: CLAUDE_MODEL });
  });

  it("single model (no Claude configured) → Gemini fails → throws error", async () => {
    mockGenerateObject.mockRejectedValueOnce(new Error("Gemini 500"));

    await expect(
      generateDailySessionWithAI(BASE_INPUTS, mockGenerateObject, [GEMINI_CONFIG]),
    ).rejects.toThrow("All AI models failed to generate a session");
  });

  it("generation context includes model name and inputs snapshot", async () => {
    mockGenerateObject.mockResolvedValueOnce({ object: VALID_SESSION_OBJECT });

    const result = await generateDailySessionWithAI(BASE_INPUTS, mockGenerateObject, BOTH_MODELS);

    expect(result.generationContext).toMatchObject({
      model: GEMINI_MODEL,
      promptVersion: "v1",
      inputsSnapshot: {
        sport: "running",
        readiness: "normal",
      },
    });
  });

  it("system prompt has PROFILE/INTAKE, TODAY'S SLOT, TODAY, RULES, WRITING RULES sections", async () => {
    mockGenerateObject.mockResolvedValueOnce({ object: VALID_SESSION_OBJECT });

    await generateDailySessionWithAI(BASE_INPUTS, mockGenerateObject, BOTH_MODELS);

    const systemPrompt = mockGenerateObject.mock.calls[0]![0]!.system as string;
    expect(systemPrompt).toContain("## PROFILE / INTAKE (STATIC)");
    expect(systemPrompt).toContain("## TODAY'S SLOT");
    expect(systemPrompt).toContain("## TODAY (DYNAMIC)");
    expect(systemPrompt).toContain("## RULES");
    expect(systemPrompt).toContain("## WRITING RULES");
    expect(systemPrompt).toContain("## EXAMPLES");
    // Safety boilerplate must NOT be mandated in the prose — that lives in UI.
    expect(systemPrompt).not.toContain(
      "Always include a form cue: 'Stop immediately if you feel sharp pain.'",
    );
    // PRE-154: internal terms must be banned from user-facing copy.
    expect(systemPrompt).toContain("'weekly scaffold'");
    expect(systemPrompt).toContain("'scheduled for today'");
  });

  it("v2 prompt surfaces user goals, focus areas, and time budget", async () => {
    mockGenerateObject.mockResolvedValueOnce({ object: VALID_SESSION_OBJECT });

    await generateDailySessionWithAI(
      {
        ...BASE_INPUTS,
        goals: ["recover-from-injury", "improve-mobility"],
        focusAreas: ["knees", "hips"],
        dailySessionTimeMin: 10,
      },
      mockGenerateObject,
      BOTH_MODELS,
    );

    const systemPrompt = mockGenerateObject.mock.calls[0]![0]!.system as string;
    expect(systemPrompt).toContain("recover-from-injury");
    expect(systemPrompt).toContain("improve-mobility");
    expect(systemPrompt).toContain("knees");
    expect(systemPrompt).toContain("hips");
    expect(systemPrompt).toContain("Time budget: 10 min");
    expect(systemPrompt).toContain("≤10 min total");
  });

  it("equipment list flows into the AVAILABLE EQUIPMENT line", async () => {
    mockGenerateObject.mockResolvedValueOnce({ object: VALID_SESSION_OBJECT });

    await generateDailySessionWithAI(
      {
        ...BASE_INPUTS,
        equipment: ["resistance-bands", "dumbbells"],
      },
      mockGenerateObject,
      BOTH_MODELS,
    );

    const systemPrompt = mockGenerateObject.mock.calls[0]![0]!.system as string;
    expect(systemPrompt).toMatch(/Available equipment: .*resistance-bands.*dumbbells/);
  });

  it("empty equipment falls back to bodyweight-only language", async () => {
    mockGenerateObject.mockResolvedValueOnce({ object: VALID_SESSION_OBJECT });

    await generateDailySessionWithAI(
      { ...BASE_INPUTS, equipment: [] },
      mockGenerateObject,
      BOTH_MODELS,
    );

    const systemPrompt = mockGenerateObject.mock.calls[0]![0]!.system as string;
    expect(systemPrompt).toContain("bodyweight only");
  });

  // ─── PRE-147: plan-contextual titles ──────────────────────────────────────

  it("plan position is passed to the prompt under PLAN ARC", async () => {
    mockGenerateObject.mockResolvedValueOnce({ object: VALID_SESSION_OBJECT });

    await generateDailySessionWithAI(
      { ...BASE_INPUTS, planWeek: 3, planTotalWeeks: 6 },
      mockGenerateObject,
      BOTH_MODELS,
    );

    const systemPrompt = mockGenerateObject.mock.calls[0]![0]!.system as string;
    expect(systemPrompt).toContain("## PLAN ARC");
    expect(systemPrompt).toContain("Plan position: week 3 of 6");
    expect(systemPrompt).toContain("## TITLE");
    // Title rule is now 2–4 words, no plan-position prefix — the home band
    // surfaces the week separately so the title can stay coach-like.
    expect(systemPrompt).toContain("2–4 words");
    expect(systemPrompt).not.toContain('"Week 3 of 6 · <focus>"');
  });

  it("plan position flows through across sports (climbing, cycling, lifting)", async () => {
    for (const sport of ["climbing", "cycling", "lifting"]) {
      mockGenerateObject.mockResolvedValueOnce({ object: VALID_SESSION_OBJECT });
      await generateDailySessionWithAI(
        { ...BASE_INPUTS, sport, sports: [sport], planWeek: 2, planTotalWeeks: 8 },
        mockGenerateObject,
        BOTH_MODELS,
      );
      const systemPrompt = mockGenerateObject.mock.lastCall![0]!.system as string;
      expect(systemPrompt).toContain("Plan position: week 2 of 8");
    }
  });

  it("no plan arc → no PLAN ARC section at all", async () => {
    mockGenerateObject.mockResolvedValueOnce({ object: VALID_SESSION_OBJECT });

    await generateDailySessionWithAI(BASE_INPUTS, mockGenerateObject, BOTH_MODELS);

    const systemPrompt = mockGenerateObject.mock.calls[0]![0]!.system as string;
    expect(systemPrompt).not.toContain("Plan position:");
    expect(systemPrompt).not.toContain("## PLAN ARC");
    expect(systemPrompt).toContain("## TITLE");
    expect(systemPrompt).toContain("2–4 words");
  });

  // ─── PRE-147: lean tap-through path ────────────────────────────────────────

  it("lean path: single fast model, no fallback — Gemini failure throws immediately", async () => {
    mockGenerateObject.mockRejectedValueOnce(new Error("Gemini 500"));

    await expect(
      generateDailySessionWithAI(BASE_INPUTS, mockGenerateObject, [GEMINI_CONFIG], { lean: true }),
    ).rejects.toThrow("All AI models failed to generate a session");
    // One call only — no Claude, no second model attempt.
    expect(mockGenerateObject).toHaveBeenCalledTimes(1);
  });

  it("lean prompt frames the task as selection/sequencing, not invention", async () => {
    mockGenerateObject.mockResolvedValueOnce({ object: VALID_SESSION_OBJECT });

    await generateDailySessionWithAI(BASE_INPUTS, mockGenerateObject, [GEMINI_CONFIG], {
      lean: true,
    });

    const systemPrompt = mockGenerateObject.mock.calls[0]![0]!.system as string;
    expect(systemPrompt).toContain("selecting and sequencing");
    expect(systemPrompt).toContain("not invention");
  });

  it("generation context records latency (durationMs), attempts, and lean flag", async () => {
    mockGenerateObject.mockResolvedValueOnce({ object: VALID_SESSION_OBJECT });

    const result = await generateDailySessionWithAI(
      BASE_INPUTS,
      mockGenerateObject,
      [GEMINI_CONFIG],
      {
        lean: true,
      },
    );

    expect(result.generationContext).toMatchObject({ lean: true, attempts: 1 });
    const ctx = result.generationContext as { durationMs: number };
    expect(typeof ctx.durationMs).toBe("number");
    expect(ctx.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("attempts counter includes the catalogue-correction retry", async () => {
    mockGenerateObject
      .mockResolvedValueOnce({ object: UNKNOWN_EXERCISE_SESSION })
      .mockResolvedValueOnce({ object: VALID_SESSION_OBJECT });

    const result = await generateDailySessionWithAI(BASE_INPUTS, mockGenerateObject, [
      GEMINI_CONFIG,
    ]);

    expect(result.generationContext).toMatchObject({ attempts: 2, lean: false });
  });

  it("intake summary regions and currentInjuries are injected into the prompt", async () => {
    mockGenerateObject.mockResolvedValueOnce({ object: VALID_SESSION_OBJECT });

    await generateDailySessionWithAI(
      {
        ...BASE_INPUTS,
        intakeSummary: {
          regions: {
            knees: { onset: "ongoing", aggravators: ["squats"], type: "achy", diagnosis: null },
          },
          currentInjuries: [
            { area: "right knee", diagnosis: "suspected meniscus", providerSeen: false },
          ],
          goalsContext: "front split goal",
          constraints: ["no overhead pressing"],
        },
      },
      mockGenerateObject,
      BOTH_MODELS,
    );

    const systemPrompt = mockGenerateObject.mock.calls[0]![0]!.system as string;
    expect(systemPrompt).toContain("## PROFILE / INTAKE (STATIC)");
    expect(systemPrompt).toContain("Intake regions");
    expect(systemPrompt).toContain("right knee");
    expect(systemPrompt).toContain("front split goal");
    expect(systemPrompt).toContain("no overhead pressing");
    // Injuries from intake are framed as hard constraints, not "current state".
    expect(systemPrompt).toContain("HARD CONSTRAINTS");
  });

  // ─── Provenance fields (static vs dynamic, tied primary sport) ──────────────

  it("readinessSource='default' marks readiness as a fallback, not a fresh signal", async () => {
    mockGenerateObject.mockResolvedValueOnce({ object: VALID_SESSION_OBJECT });

    await generateDailySessionWithAI(
      { ...BASE_INPUTS, readinessSource: "default" },
      mockGenerateObject,
      BOTH_MODELS,
    );

    const systemPrompt = mockGenerateObject.mock.calls[0]![0]!.system as string;
    expect(systemPrompt).toContain("DEFAULT — no check-in done today");
    expect(systemPrompt).toContain("do not treat this as a fresh signal");
  });

  it("readinessSource='check_in' presents readiness as a real today signal", async () => {
    mockGenerateObject.mockResolvedValueOnce({ object: VALID_SESSION_OBJECT });

    await generateDailySessionWithAI(
      { ...BASE_INPUTS, readiness: "low", readinessSource: "check_in" },
      mockGenerateObject,
      BOTH_MODELS,
    );

    const systemPrompt = mockGenerateObject.mock.calls[0]![0]!.system as string;
    expect(systemPrompt).toContain("Readiness (from check-in): low");
    expect(systemPrompt).not.toContain("DEFAULT — no check-in");
  });

  it("primarySportConfidence='tied' flips the prompt to multi-sport framing", async () => {
    mockGenerateObject.mockResolvedValueOnce({ object: VALID_SESSION_OBJECT });

    await generateDailySessionWithAI(
      {
        ...BASE_INPUTS,
        sport: "cycling",
        sports: ["cycling", "strength-training"],
        sportTimeBreakdown: { cycling: "10+", "strength-training": "10+" },
        primarySportConfidence: "tied",
      },
      mockGenerateObject,
      BOTH_MODELS,
    );

    const systemPrompt = mockGenerateObject.mock.calls[0]![0]!.system as string;
    expect(systemPrompt).toContain("TIED");
    expect(systemPrompt).toContain("multi-sport");
    expect(systemPrompt).toContain("do not single out this sport");
  });

  it("sessionThemeSource='weekly_scaffold' renders as the user-facing 'planned' label", async () => {
    mockGenerateObject.mockResolvedValueOnce({ object: VALID_SESSION_OBJECT });

    await generateDailySessionWithAI(
      { ...BASE_INPUTS, sessionTheme: "Hips & low back", sessionThemeSource: "weekly_scaffold" },
      mockGenerateObject,
      BOTH_MODELS,
    );

    const systemPrompt = mockGenerateObject.mock.calls[0]![0]!.system as string;
    // PRE-154: internal source enum must NOT leak into the prompt; the prompt
    // uses 'planned' / 'on-demand' instead.
    expect(systemPrompt).not.toContain("source: weekly_scaffold");
    expect(systemPrompt).toContain("(planned)");
  });

  it("sessionThemeSource='on_demand' renders as the user-facing 'on-demand' label", async () => {
    mockGenerateObject.mockResolvedValueOnce({ object: VALID_SESSION_OBJECT });

    await generateDailySessionWithAI(
      { ...BASE_INPUTS, sessionTheme: "Quick shoulder prep", sessionThemeSource: "on_demand" },
      mockGenerateObject,
      BOTH_MODELS,
    );

    const systemPrompt = mockGenerateObject.mock.calls[0]![0]!.system as string;
    expect(systemPrompt).not.toContain("source: on_demand");
    expect(systemPrompt).toContain("on-demand (user requested)");
  });

  // ─── PRE-154: plan-arc copy threaded into the prompt ─────────────────────────

  it("PLAN ARC surfaces the plan's headline, subtitle, and themes when present", async () => {
    mockGenerateObject.mockResolvedValueOnce({ object: VALID_SESSION_OBJECT });

    await generateDailySessionWithAI(
      {
        ...BASE_INPUTS,
        planHeadline: "12 weeks. Run, climb, move pain-free.",
        planSubtitle: "12 weeks · 4 sessions per week",
        planThemes: [
          "Shoulder stability",
          "Knee tracking",
          "Ankle mobility",
          "Upper back and posture",
        ],
      },
      mockGenerateObject,
      BOTH_MODELS,
    );

    const systemPrompt = mockGenerateObject.mock.calls[0]![0]!.system as string;
    expect(systemPrompt).toContain("## PLAN ARC");
    expect(systemPrompt).toContain("12 weeks. Run, climb, move pain-free.");
    expect(systemPrompt).toContain("12 weeks · 4 sessions per week");
    expect(systemPrompt).toContain("Shoulder stability");
    expect(systemPrompt).toContain("Knee tracking");
  });

  it("plan-arc fields null → no PLAN ARC section, no headline leak", async () => {
    mockGenerateObject.mockResolvedValueOnce({ object: VALID_SESSION_OBJECT });

    await generateDailySessionWithAI(
      {
        ...BASE_INPUTS,
        planHeadline: null,
        planSubtitle: null,
        planThemes: null,
      },
      mockGenerateObject,
      BOTH_MODELS,
    );

    const systemPrompt = mockGenerateObject.mock.calls[0]![0]!.system as string;
    expect(systemPrompt).not.toContain("## PLAN ARC");
    expect(systemPrompt).not.toContain("Plan headline:");
  });
});
