import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Waitlist handler tests.
 *
 * These test the business logic of the waitlist.subscribe handler by
 * mocking the database module. The handler is accessed via oRPC's internal
 * `['~orpc'].handler` which is the unwrapped async function.
 */

// ─── DB mock ─────────────────────────────────────────────────────────────────

const mockReturning = vi.fn().mockResolvedValue([{ id: "test-id" }]);
const mockOnConflictDoNothing = vi.fn().mockReturnValue({ returning: mockReturning });
const mockValues = vi.fn().mockReturnValue({ onConflictDoNothing: mockOnConflictDoNothing });
const mockInsert = vi.fn().mockReturnValue({ values: mockValues });

vi.mock("../db", () => ({
  createDb: () => ({ insert: mockInsert }),
  db: { insert: mockInsert },
  waitlist: { id: "id", email: "email" },
  sessions: {},
  programSchedule: {},
  sportProfiles: {},
  capacityLogs: {},
  user: {},
  account: {},
  verification: {},
  session: {},
  notificationPreferences: {},
  progressMilestones: {},
  subscriptions: {},
  sessionTypeEnum: {},
  appSessionRelations: {},
  capacityLogRelations: {},
  programScheduleRelations: {},
  sportProfileRelations: {},
  testDatabaseConnection: vi.fn().mockResolvedValue(true),
}));

vi.mock("../auth", () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue(null),
    },
    handler: vi.fn(),
  },
}));

vi.mock("../lib/s3", () => ({
  getMediaPublicUrl: vi.fn().mockReturnValue("https://example.com/media"),
}));

vi.mock("../services/session-generator", () => ({
  generateDailySessionWithAI: vi.fn(),
  generateWeeklyScaffoldWithAI: vi.fn(),
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
  transitionThreadCompleted: vi.fn(),
  upsertIntakeSummary: vi.fn(),
  registerCoachStreamRoute: vi.fn(),
}));

vi.mock("../services/profile-projection", () => ({
  buildStructuredIntakeProse: vi.fn().mockReturnValue(""),
  derivePrimarySport: vi.fn().mockReturnValue(""),
  hydrateProfile: vi.fn().mockResolvedValue(null),
  loadProfileAnswers: vi.fn().mockResolvedValue({}),
}));

vi.mock("../events/emit.js", () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}));

// ─── Helper to invoke oRPC handler directly ───────────────────────────────────

// oRPC DecoratedProcedure stores the underlying handler at ['~orpc'].handler
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getHandler(procedure: unknown): (opts: any) => Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (procedure as any)["~orpc"].handler;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("waitlist.subscribe handler (unit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReturning.mockResolvedValue([{ id: "test-id" }]);
    mockOnConflictDoNothing.mockReturnValue({ returning: mockReturning });
    mockValues.mockReturnValue({ onConflictDoNothing: mockOnConflictDoNothing });
    mockInsert.mockReturnValue({ values: mockValues });
  });

  it("valid email → calls db.insert with the email and returns ok", async () => {
    const { router } = await import("../rpc/router");
    const handler = getHandler(router.waitlist.subscribe);

    const result = await handler({ input: { email: "user@example.com" }, context: {} });

    expect(result).toEqual({ ok: true });
    expect(mockInsert).toHaveBeenCalledOnce();
    expect(mockValues).toHaveBeenCalledWith({ email: "user@example.com" });
  });

  it("duplicate email → onConflictDoNothing is called (idempotent, no error thrown)", async () => {
    // Second insert returns empty array (conflict, no insert)
    mockReturning.mockResolvedValueOnce([{ id: "test-id" }]).mockResolvedValueOnce([]);

    const { router } = await import("../rpc/router");
    const handler = getHandler(router.waitlist.subscribe);

    const r1 = await handler({ input: { email: "dup@example.com" }, context: {} });
    const r2 = await handler({ input: { email: "dup@example.com" }, context: {} });

    expect(r1).toEqual({ ok: true });
    expect(r2).toEqual({ ok: true });
    expect(mockOnConflictDoNothing).toHaveBeenCalledTimes(2);
  });

  it("db throws unexpected error → handler throws INTERNAL_SERVER_ERROR", async () => {
    mockReturning.mockRejectedValueOnce(new Error("DB connection lost"));

    const { router } = await import("../rpc/router");
    const handler = getHandler(router.waitlist.subscribe);

    await expect(
      handler({ input: { email: "error@example.com" }, context: {} }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});
