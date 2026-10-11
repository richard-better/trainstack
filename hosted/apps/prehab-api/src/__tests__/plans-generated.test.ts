import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * plans.startGenerated handler tests (PRE-149 / PRE-153).
 *
 * After PRE-153 this RPC is a thin enqueue-and-return: it resets any prior
 * `failed` row back to `pending`, emits `plan_generation_requested`, and
 * returns the (possibly still-pending) active plan row so the client can keep
 * polling. The heavy lifting (scaffold + reveal copy + supersede) lives in
 * `runPlanGeneration` and is tested separately at the worker level.
 */

// ── DB mock ────────────────────────────────────────────────────────────────
// Mocks two builder chains:
//  1. db.update(plans).set(...).where(...) — the failed→pending reset
//  2. db.select().from(plans).where(...).orderBy(...).limit(...) — read-back

const mockSelectResult = vi.fn().mockResolvedValue([]);

function makeSelectBuilder() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {
    orderBy: vi.fn(),
    limit: vi.fn(),
  };
  builder.orderBy.mockReturnValue(builder);
  builder.limit.mockReturnValue(builder);
  // oxlint-disable-next-line no-thenable
  builder["then"] = (onFulfilled: (v: unknown[]) => unknown, onRejected?: unknown) =>
    mockSelectResult().then(onFulfilled, onRejected as never);
  return builder;
}

const mockDbSelectWhere = vi.fn(() => makeSelectBuilder());
const mockDbSelectFrom = vi.fn().mockReturnValue({ where: mockDbSelectWhere });
const mockDbSelect = vi.fn().mockReturnValue({ from: mockDbSelectFrom });

const mockDbUpdateWhere = vi.fn().mockResolvedValue(undefined);
const mockDbUpdateSet = vi.fn().mockReturnValue({ where: mockDbUpdateWhere });
const mockDbUpdate = vi.fn().mockReturnValue({ set: mockDbUpdateSet });

const mockDbTransaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb({} as never));

vi.mock("../db", () => ({
  db: { select: mockDbSelect, update: mockDbUpdate, transaction: mockDbTransaction },
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
const TODAY = "2026-05-21";

const PENDING_PLAN_ROW = {
  id: "plan-pending",
  source: "generated" as const,
  status: "active" as const,
  generationStatus: "pending" as const,
  startDate: TODAY,
  endDate: "2026-07-01",
  planTemplateId: null,
  headline: null,
  subtitle: null,
  themes: null,
  createdAt: new Date("2026-05-21T10:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSelectResult.mockResolvedValue([PENDING_PLAN_ROW]);
});

describe("plans.startGenerated (PRE-153 enqueue-and-return)", () => {
  it("enqueues plan_generation_requested and returns the active plan row", async () => {
    const { router } = await import("../rpc/router");
    const handler = getHandler(router.plans.startGenerated);

    const result = await handler({ context: FAKE_CTX, input: { today: TODAY } });

    expect(mockEmitEvent).toHaveBeenCalledOnce();
    const [eventName, payload, options] = mockEmitEvent.mock.calls[0]!;
    expect(eventName).toBe("plan_generation_requested");
    expect(payload).toEqual({ userId: "user-1", today: TODAY });
    expect(options).toMatchObject({ jobKey: "plan-gen:user-1" });

    expect(result.plan.id).toBe("plan-pending");
    expect(result.plan.generationStatus).toBe("pending");
  });

  it("resets failed → pending so the client polls don't briefly read failed", async () => {
    const { router } = await import("../rpc/router");
    const handler = getHandler(router.plans.startGenerated);

    await handler({ context: FAKE_CTX, input: { today: TODAY } });

    // The pre-enqueue UPDATE writes {generationStatus: pending, generationError: null}.
    expect(mockDbUpdateSet).toHaveBeenCalledWith({
      generationStatus: "pending",
      generationError: null,
    });
  });

  it("404s when no active plan row exists yet (worker hasn't run)", async () => {
    mockSelectResult.mockResolvedValue([]);

    const { router } = await import("../rpc/router");
    const handler = getHandler(router.plans.startGenerated);

    await expect(handler({ context: FAKE_CTX, input: { today: TODAY } })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    // Event is still enqueued — the worker will insert the row.
    expect(mockEmitEvent).toHaveBeenCalledOnce();
  });
});
