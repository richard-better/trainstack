import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * plans.getRevealState self-heal regression test.
 *
 * The reveal screen gates its "Start my plan" CTA on today's daily session
 * landing (`firstSession.status` flips ready/failed). The only thing that
 * normally creates that session is the plan-generation job, which runs once —
 * on the day the plan is generated. A user who reaches the reveal screen on a
 * LATER day (plan already `ready`, reveal never marked seen) had no session for
 * `today`, so `firstSession` stayed null and the CTA spun forever.
 *
 * getRevealState now self-heals: a ready plan with no live daily session for
 * today enqueues one. These tests pin that behaviour.
 */

// ── DB mock ────────────────────────────────────────────────────────────────
// Select chains return sequenced results (plan, then session, then schedule).
const mockSelectResults: unknown[][] = [];
let selectCall = 0;

function makeSelectBuilder() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = { orderBy: vi.fn(), limit: vi.fn() };
  builder.orderBy.mockReturnValue(builder);
  builder.limit.mockReturnValue(builder);
  // oxlint-disable-next-line no-thenable
  builder["then"] = (onFulfilled: (v: unknown[]) => unknown, onRejected?: unknown) => {
    const result = mockSelectResults[selectCall] ?? [];
    selectCall += 1;
    return Promise.resolve(result).then(onFulfilled, onRejected as never);
  };
  return builder;
}

const mockDbSelectWhere = vi.fn(() => makeSelectBuilder());
const mockDbSelectFrom = vi.fn().mockReturnValue({ where: mockDbSelectWhere });
const mockDbSelect = vi.fn().mockReturnValue({ from: mockDbSelectFrom });

const mockInsertReturning = vi.fn();
const mockInsertValues = vi.fn().mockReturnValue({ returning: mockInsertReturning });
const mockDbInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

vi.mock("../db", () => ({
  db: { select: mockDbSelect, insert: mockDbInsert },
  waitlist: {},
  sessions: {},
  programSchedule: {},
  sportProfiles: {},
  profileAnswers: {},
  capacityLogs: {},
  dailyCheckIns: {},
  intakeSummaries: {},
  sessionTemplates: {},
  plans: {},
  threads: {},
  messages: {},
  notificationPreferences: {},
  progressMilestones: {},
  subscriptions: {},
  user: {},
  account: {},
  verification: {},
  session: {},
  testDatabaseConnection: vi.fn().mockResolvedValue(true),
}));

vi.mock("../auth", () => ({
  auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

vi.mock("../lib/s3", () => ({
  getMediaPublicUrl: vi.fn().mockReturnValue("https://example.com/media"),
}));

vi.mock("../services/session-generator", () => ({
  generateDailySessionWithAI: vi.fn(),
  generateWeeklyScaffoldWithAI: vi.fn(),
  generateRevealCopyWithAI: vi.fn(),
  GEMINI_MODEL: "gemini-mock",
  CLAUDE_MODEL: "claude-mock",
  PROMPT_VERSION: "v1",
}));

vi.mock("../services/constants/exercises", () => ({
  exercises: [],
  exerciseVideoKey: vi.fn(),
  exerciseThumbnailKey: vi.fn(),
  findExerciseById: vi.fn(),
  PLACEHOLDER_VIDEO_KEY: "placeholder",
}));

vi.mock("../services/coach", () => ({
  extractIntakeSummary: vi.fn(),
  getOrCreatePendingIntakeThread: vi.fn(),
  getPendingIntakeThread: vi.fn(),
  getThreadForUser: vi.fn(),
  seedIntakeGreeting: vi.fn(),
  transitionThreadCompleted: vi.fn(),
  upsertIntakeSummary: vi.fn(),
  registerCoachStreamRoute: vi.fn(),
}));

vi.mock("../services/profile-projection", () => ({
  buildStructuredIntakeProse: vi.fn().mockReturnValue(""),
  derivePrimarySport: vi.fn().mockReturnValue(""),
  hydrateProfile: vi.fn(),
  loadProfileAnswers: vi.fn().mockResolvedValue({}),
}));

const mockEmitEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("../events/emit.js", () => ({
  emitEvent: (...args: unknown[]) => mockEmitEvent(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getHandler(procedure: unknown): (opts: any) => Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (procedure as any)["~orpc"].handler;
}

const FAKE_CTX = { session: { user: { id: "user-1" } } } as const;
const TODAY = "2026-06-26";

const READY_PLAN_ROW = {
  id: "plan-ready",
  source: "generated" as const,
  status: "active" as const,
  generationStatus: "ready" as const,
  startDate: "2026-05-27",
  endDate: "2026-08-19",
  planTemplateId: null,
  headline: "12 weeks. Run, climb, and move pain-free.",
  subtitle: null,
  themes: ["Shoulder stability and health"],
  createdAt: new Date("2026-05-27T08:49:59Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  selectCall = 0;
  mockSelectResults.length = 0;
});

describe("plans.getRevealState self-heal (stuck-spinner regression)", () => {
  it("enqueues today's session when the plan is ready but no daily session exists", async () => {
    // 1: plans, 2: sessions (none for today), 3: programSchedule
    mockSelectResults.push([READY_PLAN_ROW], [], []);
    mockInsertReturning.mockResolvedValue([
      { id: "sess-new", status: "pending", sessionDate: TODAY, exercises: [] },
    ]);

    const { router } = await import("../rpc/router");
    const handler = getHandler(router.plans.getRevealState);

    const result = await handler({ context: FAKE_CTX, input: { today: TODAY } });

    expect(mockDbInsert).toHaveBeenCalledOnce();
    expect(mockEmitEvent).toHaveBeenCalledOnce();
    const [eventName, payload, options] = mockEmitEvent.mock.calls[0]!;
    expect(eventName).toBe("session_generation_requested");
    expect(payload).toEqual({ sessionId: "sess-new" });
    expect(options).toMatchObject({ jobKey: "session-gen:sess-new" });

    // The freshly-inserted pending row is surfaced so the client keeps polling.
    expect(result.firstSession?.id).toBe("sess-new");
    expect(result.firstSession?.status).toBe("pending");
  });

  it("does not enqueue when today's session already exists", async () => {
    mockSelectResults.push(
      [READY_PLAN_ROW],
      [{ id: "sess-existing", status: "ready", sessionDate: TODAY, exercises: [] }],
      [],
    );

    const { router } = await import("../rpc/router");
    const handler = getHandler(router.plans.getRevealState);

    const result = await handler({ context: FAKE_CTX, input: { today: TODAY } });

    expect(mockDbInsert).not.toHaveBeenCalled();
    expect(mockEmitEvent).not.toHaveBeenCalled();
    expect(result.firstSession?.id).toBe("sess-existing");
  });

  it("does not enqueue while the plan is still generating", async () => {
    mockSelectResults.push([{ ...READY_PLAN_ROW, generationStatus: "pending" }], [], []);

    const { router } = await import("../rpc/router");
    const handler = getHandler(router.plans.getRevealState);

    const result = await handler({ context: FAKE_CTX, input: { today: TODAY } });

    // Plan-gen job owns first-session creation until the plan flips ready.
    expect(mockDbInsert).not.toHaveBeenCalled();
    expect(mockEmitEvent).not.toHaveBeenCalled();
    expect(result.firstSession).toBeNull();
  });
});
