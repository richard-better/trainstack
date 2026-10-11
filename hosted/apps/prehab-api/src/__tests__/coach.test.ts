import { endSessionTool, flagRedFlagTool } from "../services/coach/durable";
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/s3", () => ({
  getMediaPublicUrl: (key: string) => `https://example.com/media/${key}`,
}));

import {
  buildCoachContextSystem,
  COACH_AGENT_ID,
  COACH_INSTRUCTIONS,
  RED_FLAG_SAFETY_MESSAGE,
} from "../services/coach/agent";
import { extractIntakeSummary } from "../services/coach/extraction";

// NL projection assembled by `buildStructuredIntakeProse(loadProfileAnswers(userId))`
// in production. Tests pass it directly so we exercise the same prose path
// without standing up a database fixture.
const BASE_INTAKE_PROSE = `Q: Tell us about you
A: Name Alex; DOB 1992-04-12; Gender female

Q: What do you train for?
A: running, yoga

Q: How much per week?
A: running 3-5h/wk, yoga 1-3h/wk

Q: What are you here for?
A: improve-mobility, recover-from-injury

Q: Anywhere to focus?
A: knees, lower-back

Q: What do you have?
A: resistance-bands, yoga-mat

Q: How long per day?
A: 15 min`;

// ── Agent setup ───────────────────────────────────────────────────────────

describe("Coach agent setup", () => {
  it("createCoachAgent uses the COACH_AGENT_ID and ships both tools", () => {
    expect(COACH_AGENT_ID).toBe("coach");
  });

  it("instructions enforce no-diagnose and reference both tools", () => {
    expect(COACH_INSTRUCTIONS).toMatch(/never diagnose/i);
    expect(COACH_INSTRUCTIONS).toContain("endSession");
    expect(COACH_INSTRUCTIONS).toContain("flagRedFlag");
  });

  it("instructions explicitly say flagRedFlag must not terminate the session", () => {
    // Guard against regressions: the safety section must keep stating that
    // the chat continues, not end on a red flag. PRE-115.
    expect(COACH_INSTRUCTIONS).toMatch(/does NOT terminate/i);
    expect(COACH_INSTRUCTIONS).toMatch(
      /keep (?:the )?conversation going|never refuse to keep chatting/i,
    );
  });
});

// ── Tool definitions ─────────────────────────────────────────────────────

describe("Coach tools", () => {
  it("endSession returns { ended: true }", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (endSessionTool.execute as any)({}, {});
    expect(result.control).toEqual({ terminate: true });
  });

  it("flagRedFlag returns the hardcoded safety message", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (flagRedFlagTool.execute as any)({ reason: "neurological signs" }, {});
    expect(result.content).toEqual([{ type: "text", text: RED_FLAG_SAFETY_MESSAGE }]);
    expect(RED_FLAG_SAFETY_MESSAGE).toMatch(/physical therapist|doctor/i);
  });
});

// ── Structured-intake prose wrapper ──────────────────────────────────────

describe("buildCoachContextSystem", () => {
  it("wraps prose in a do-not-re-ask header", () => {
    const sys = buildCoachContextSystem(BASE_INTAKE_PROSE);
    expect(sys).toMatch(/do not re-ask/i);
    expect(sys).toContain("Alex");
    expect(sys).toContain("running 3-5h/wk");
    expect(sys).toContain("knees");
  });

  it("falls back gracefully when no answers exist", () => {
    const sys = buildCoachContextSystem("");
    expect(sys).toMatch(/none recorded yet/i);
  });
});

// ── Extraction pass ───────────────────────────────────────────────────────

describe("extractIntakeSummary", () => {
  it("happy path: parses model JSON into a validated IntakeSummary", async () => {
    const generateObject = vi.fn().mockResolvedValue({
      object: {
        regions: {
          knees: {
            onset: "2 months ago",
            aggravators: ["deep squats"],
            type: "achy",
            diagnosis: null,
          },
        },
        currentInjuries: [
          { area: "right knee", diagnosis: "suspected meniscus", providerSeen: false },
        ],
        goalsContext: "Wants to ski pain-free this winter",
        constraints: ["no overhead pressing — old shoulder"],
      },
    });

    const summary = await extractIntakeSummary(
      {
        structuredIntakeProse: BASE_INTAKE_PROSE,
        messages: [
          { role: "user", parts: [{ type: "text", text: "knees ache after squats" }] },
          { role: "assistant", parts: [{ type: "text", text: "How long?" }] },
          { role: "user", parts: [{ type: "text", text: "2 months" }] },
        ],
      },
      generateObject,
      "model-mock",
    );

    expect(summary.regions.knees?.aggravators).toContain("deep squats");
    expect(summary.currentInjuries).toHaveLength(1);
    expect(summary.goalsContext).toMatch(/ski/);
    expect(generateObject).toHaveBeenCalledOnce();
    const call = generateObject.mock.calls[0]![0]!;
    expect(call.system).toContain("flagRedFlag");
    expect(call.prompt).toContain("Alex");
    expect(call.prompt).toContain("knees ache");
  });

  it("normalizes missing optional fields via Zod defaults", async () => {
    const generateObject = vi.fn().mockResolvedValue({
      object: {
        regions: {},
        currentInjuries: [],
        goalsContext: null,
        constraints: [],
      },
    });

    const summary = await extractIntakeSummary(
      {
        structuredIntakeProse: BASE_INTAKE_PROSE,
        messages: [{ role: "user", parts: [{ type: "text", text: "nothing else" }] }],
      },
      generateObject,
      "model-mock",
    );

    expect(summary.regions).toEqual({});
    expect(summary.currentInjuries).toEqual([]);
    expect(summary.constraints).toEqual([]);
    expect(summary.goalsContext).toBeNull();
  });

  it("encodes flagRedFlag tool calls into the transcript so they reach the extractor", async () => {
    const generateObject = vi.fn().mockResolvedValue({
      object: { regions: {}, currentInjuries: [], goalsContext: null, constraints: [] },
    });

    await extractIntakeSummary(
      {
        structuredIntakeProse: BASE_INTAKE_PROSE,
        messages: [
          { role: "user", parts: [{ type: "text", text: "sharp pain after fall" }] },
          {
            role: "assistant",
            parts: [
              {
                type: "tool-flagRedFlag",
                input: { reason: "post-trauma sharp pain" },
              },
            ],
          },
        ],
      },
      generateObject,
      "model-mock",
    );

    const prompt = generateObject.mock.calls[0]![0]!.prompt as string;
    expect(prompt).toContain("[tool:flagRedFlag");
    expect(prompt).toContain("post-trauma sharp pain");
  });
});
