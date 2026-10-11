import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Coach oRPC handler tests. Mocks DB + auth + extraction so the handlers
 * can run end-to-end without a real Postgres or LLM call.
 *
 * Together with coach.test.ts (agent + tools + extraction unit tests) and
 * coach-stream.test.ts (Fastify streaming wire format), this covers the
 * verification matrix in PRE-105.
 */

const mockGetOrCreate = vi.fn();
const mockGetPending = vi.fn();
const mockGetThread = vi.fn();
const mockSeedGreeting = vi.fn();
const mockTransition = vi.fn();
const mockUpsertSummary = vi.fn();
const mockExtract = vi.fn();
const mockLoadAnswers = vi.fn();
const mockBuildProse = vi.fn();
const mockHydrate = vi.fn();
const mockDerivePrimary = vi.fn();

vi.mock("../services/coach", () => ({
  extractIntakeSummary: mockExtract,
  getOrCreatePendingIntakeThread: mockGetOrCreate,
  getPendingIntakeThread: mockGetPending,
  getThreadForUser: mockGetThread,
  seedIntakeGreeting: mockSeedGreeting,
  transitionThreadCompleted: mockTransition,
  upsertIntakeSummary: mockUpsertSummary,
  registerCoachStreamRoute: vi.fn(),
}));

vi.mock("../services/profile-projection", () => ({
  buildStructuredIntakeProse: mockBuildProse,
  derivePrimarySport: mockDerivePrimary,
  hydrateProfile: mockHydrate,
  loadProfileAnswers: mockLoadAnswers,
}));

vi.mock("../db", () => ({
  db: {},
  waitlist: {},
  sessions: {},
  programSchedule: {},
  sportProfiles: {},
  profileAnswers: {},
  capacityLogs: {},
  dailyCheckIns: {},
  intakeSummaries: {},
  sessionTemplates: {},
  threads: {},
  messages: {},
  notificationPreferences: {},
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

vi.mock("../events/emit.js", () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getHandler(procedure: unknown): (opts: any) => Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (procedure as any)["~orpc"].handler;
}

const FAKE_USER = { id: "user-1" } as const;
const FAKE_CTX = { session: { user: FAKE_USER } } as const;

const FAKE_THREAD = {
  id: "thread-1",
  userId: FAKE_USER.id,
  type: "intake",
  status: "pending" as const,
  startedAt: new Date("2026-05-03T10:00:00Z"),
  completedAt: null,
  flaggedForReviewAt: null,
  flagReason: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("coach.startThread", () => {
  it("returns the user's pending thread (idempotent)", async () => {
    mockGetOrCreate.mockResolvedValue(FAKE_THREAD);
    const { router } = await import("../rpc/router");
    const handler = getHandler(router.coach.startThread);

    const result = await handler({ context: FAKE_CTX, input: undefined });

    expect(mockGetOrCreate).toHaveBeenCalledWith(FAKE_USER.id);
    expect(result.thread.id).toBe(FAKE_THREAD.id);
    expect(result.thread.status).toBe("pending");
    expect(result.thread.startedAt).toBe(FAKE_THREAD.startedAt.toISOString());
    expect(result.thread.flaggedForReviewAt).toBeNull();
  });

  it("seeds the opening greeting for the resolved thread (PRE-109)", async () => {
    mockGetOrCreate.mockResolvedValue(FAKE_THREAD);
    const { router } = await import("../rpc/router");
    const handler = getHandler(router.coach.startThread);

    await handler({ context: FAKE_CTX, input: undefined });

    expect(mockSeedGreeting).toHaveBeenCalledWith(FAKE_USER.id, FAKE_THREAD.id);
  });
});

describe("coach.currentIntakeThread (banner)", () => {
  it("returns the pending thread when one exists — read-only, never creates", async () => {
    mockGetPending.mockResolvedValue(FAKE_THREAD);
    const { router } = await import("../rpc/router");
    const handler = getHandler(router.coach.currentIntakeThread);

    const result = await handler({ context: FAKE_CTX, input: undefined });

    expect(mockGetPending).toHaveBeenCalledWith(FAKE_USER.id);
    expect(mockGetOrCreate).not.toHaveBeenCalled();
    expect(result.thread?.id).toBe(FAKE_THREAD.id);
    expect(result.thread?.status).toBe("pending");
  });

  it("returns null when no pending thread — banner stays hidden", async () => {
    mockGetPending.mockResolvedValue(null);
    const { router } = await import("../rpc/router");
    const handler = getHandler(router.coach.currentIntakeThread);

    const result = await handler({ context: FAKE_CTX, input: undefined });

    expect(mockGetPending).toHaveBeenCalledWith(FAKE_USER.id);
    expect(result.thread).toBeNull();
  });
});

describe("coach.getThread (resume)", () => {
  it("returns thread + ordered messages so the client can rehydrate useChat", async () => {
    mockGetThread.mockResolvedValue({
      thread: FAKE_THREAD,
      messages: [
        {
          id: "m1",
          threadId: FAKE_THREAD.id,
          role: "user",
          parts: [{ type: "text", text: "hi" }],
          createdAt: new Date("2026-05-03T10:01:00Z"),
        },
        {
          id: "m2",
          threadId: FAKE_THREAD.id,
          role: "assistant",
          parts: [{ type: "text", text: "hello" }],
          createdAt: new Date("2026-05-03T10:01:05Z"),
        },
      ],
    });

    const { router } = await import("../rpc/router");
    const handler = getHandler(router.coach.getThread);

    const result = await handler({
      context: FAKE_CTX,
      input: { threadId: FAKE_THREAD.id },
    });

    expect(mockGetThread).toHaveBeenCalledWith(FAKE_USER.id, FAKE_THREAD.id);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].role).toBe("user");
    expect(result.messages[1].parts).toEqual([{ type: "text", text: "hello" }]);
  });

  it("404s when the thread doesn't belong to the user", async () => {
    mockGetThread.mockResolvedValue(null);
    const { router } = await import("../rpc/router");
    const handler = getHandler(router.coach.getThread);

    await expect(
      handler({ context: FAKE_CTX, input: { threadId: "missing" } }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("coach.endThread", () => {
  it("transitions to completed and runs the extraction pass", async () => {
    mockGetThread.mockResolvedValue({ thread: FAKE_THREAD, messages: [] });
    mockLoadAnswers.mockResolvedValue({});
    mockBuildProse.mockReturnValue("Q: What do you train for?\nA: running");
    mockExtract.mockResolvedValue({
      regions: {},
      currentInjuries: [],
      goalsContext: null,
      constraints: [],
    });

    const { router } = await import("../rpc/router");
    const handler = getHandler(router.coach.endThread);

    const result = await handler({
      context: FAKE_CTX,
      input: { threadId: FAKE_THREAD.id },
    });

    expect(result).toEqual({ ok: true });
    expect(mockTransition).toHaveBeenCalledWith(FAKE_THREAD.id);
    expect(mockExtract).toHaveBeenCalledOnce();
    expect(mockUpsertSummary).toHaveBeenCalledWith(
      FAKE_USER.id,
      FAKE_THREAD.id,
      expect.any(Object),
    );
  });

  it("idempotent on already-completed threads", async () => {
    mockGetThread.mockResolvedValue({
      thread: { ...FAKE_THREAD, status: "completed" },
      messages: [],
    });

    const { router } = await import("../rpc/router");
    const handler = getHandler(router.coach.endThread);

    const result = await handler({
      context: FAKE_CTX,
      input: { threadId: FAKE_THREAD.id },
    });

    expect(result).toEqual({ ok: true });
    expect(mockTransition).not.toHaveBeenCalled();
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it("does not throw when extraction fails — best-effort", async () => {
    mockGetThread.mockResolvedValue({ thread: FAKE_THREAD, messages: [] });
    mockLoadAnswers.mockResolvedValue({});
    mockBuildProse.mockReturnValue("Q: What do you train for?\nA: (none)");
    mockExtract.mockRejectedValue(new Error("LLM down"));

    const { router } = await import("../rpc/router");
    const handler = getHandler(router.coach.endThread);

    const result = await handler({
      context: FAKE_CTX,
      input: { threadId: FAKE_THREAD.id },
    });

    expect(result).toEqual({ ok: true });
    expect(mockTransition).toHaveBeenCalledWith(FAKE_THREAD.id);
    expect(mockUpsertSummary).not.toHaveBeenCalled();
  });
});

describe("coach.skipThread", () => {
  it("leaves the thread pending so it can be resumed", async () => {
    mockGetThread.mockResolvedValue({ thread: FAKE_THREAD, messages: [] });
    const { router } = await import("../rpc/router");
    const handler = getHandler(router.coach.skipThread);

    const result = await handler({
      context: FAKE_CTX,
      input: { threadId: FAKE_THREAD.id },
    });

    expect(result).toEqual({ ok: true });
    expect(mockTransition).not.toHaveBeenCalled();
  });
});
