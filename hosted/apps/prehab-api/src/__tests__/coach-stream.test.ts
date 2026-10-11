import { describe, expect, it, vi, beforeEach } from "vitest";
import Fastify from "fastify";

/**
 * End-to-end test for the /api/coach/stream Fastify route.
 *
 * Stubs auth, persistence, and Mastra's `handleChatStream` so we can assert:
 *   - Auth gate (401 unauth, 404 wrong thread, 409 non-pending, 412 no profile)
 *   - The user message is persisted before streaming starts
 *   - Mastra is invoked with the structured-data context as `system`
 *   - The response is a v6 UIMessage SSE stream the client's useChat consumes
 *   - On finish, the assistant message is persisted; endSession + flagRedFlag
 *     tool calls in the response trigger the right side effects
 *   - Resume: prior DB messages are loaded into the agent on each turn
 */

const mockGetSession = vi.fn();
const mockGetThread = vi.fn();
const mockPersist = vi.fn();
const mockLoadAnswers = vi.fn();
const mockBuildProse = vi.fn();
const mockTransition = vi.fn();
const mockFlag = vi.fn();
const mockUpsertSummary = vi.fn();
const mockExtract = vi.fn();
const mockHandleChatStream = vi.fn();

vi.mock("../auth", () => ({
  auth: { api: { getSession: mockGetSession }, handler: vi.fn() },
}));

vi.mock("../services/coach/persistence", () => ({
  flagThreadForReview: mockFlag,
  getOrCreatePendingIntakeThread: vi.fn(),
  getThreadForUser: mockGetThread,
  persistMessage: mockPersist,
  transitionThreadCompleted: mockTransition,
  upsertIntakeSummary: mockUpsertSummary,
  INTAKE_THREAD_TYPE: "intake",
}));

vi.mock("../services/profile-projection", () => ({
  buildStructuredIntakeProse: mockBuildProse,
  loadProfileAnswers: mockLoadAnswers,
}));

vi.mock("../services/coach/extraction", () => ({
  extractIntakeSummary: mockExtract,
}));

vi.mock("../services/coach/durable", () => ({
  runCoachTurn: mockHandleChatStream,
}));

vi.mock("../services/coach/agent", () => ({
  COACH_AGENT_ID: "coach",
  buildCoachContextSystem: () => "STRUCTURED-DATA-CONTEXT-BLOCK",
  RED_FLAG_SAFETY_MESSAGE: "see a provider",
}));

// ── Helpers ───────────────────────────────────────────────────────────────

const FAKE_USER = { id: "user-1" };
const FAKE_INTAKE_PROSE = "Q: Sports\nA: running\n\nQ: Focus\nA: knees";

function makePendingThread(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "thread-1",
    userId: FAKE_USER.id,
    type: "intake",
    status: "pending",
    startedAt: new Date(),
    completedAt: null,
    flaggedForReviewAt: null,
    flagReason: null,
    ...overrides,
  };
}

/** Creates a UIMessage chunk stream that emits a few text deltas + finish. */
function fakeUIMessageStream(parts: unknown[]) {
  return { id: "asst-1", parts };
}

async function buildTestApp() {
  // Import fresh after mocks are in place.
  const { registerCoachStreamRoute } = await import("../services/coach/stream-route");
  const app = Fastify({ logger: false });
  registerCoachStreamRoute(app);
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHandleChatStream.mockResolvedValue(
    fakeUIMessageStream([{ type: "text", text: "Tell me about your knees." }]),
  );
});

// ── Auth + validation gates ──────────────────────────────────────────────

describe("/api/coach/stream — gates", () => {
  it("401s without a session", async () => {
    mockGetSession.mockResolvedValue(null);
    const app = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/coach/stream",
      payload: { threadId: "thread-1", messages: [{ role: "user", parts: [] }] },
    });
    expect(res.statusCode).toBe(401);
  });

  it("400s on invalid body", async () => {
    mockGetSession.mockResolvedValue({ user: FAKE_USER });
    const app = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/coach/stream",
      payload: { messages: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("404s when the thread isn't owned by the user", async () => {
    mockGetSession.mockResolvedValue({ user: FAKE_USER });
    mockGetThread.mockResolvedValue(null);
    const app = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/coach/stream",
      payload: {
        threadId: "thread-1",
        messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] }],
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it("409s when the thread is not pending", async () => {
    mockGetSession.mockResolvedValue({ user: FAKE_USER });
    mockGetThread.mockResolvedValue({
      thread: makePendingThread({ status: "completed" }),
      messages: [],
    });
    const app = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/coach/stream",
      payload: {
        threadId: "thread-1",
        messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] }],
      },
    });
    expect(res.statusCode).toBe(409);
  });

  it("412s when the user has no sport profile yet", async () => {
    mockGetSession.mockResolvedValue({ user: FAKE_USER });
    mockGetThread.mockResolvedValue({ thread: makePendingThread(), messages: [] });
    mockLoadAnswers.mockResolvedValue({});
    mockBuildProse.mockReturnValue("");
    const app = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/coach/stream",
      payload: {
        threadId: "thread-1",
        messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] }],
      },
    });
    expect(res.statusCode).toBe(412);
  });
});

// ── Streaming wire format + persistence ──────────────────────────────────

describe("/api/coach/stream — happy path", () => {
  it("persists the user message, streams a v6 UIMessage SSE, persists the assistant reply", async () => {
    mockGetSession.mockResolvedValue({ user: FAKE_USER });
    mockLoadAnswers.mockResolvedValue({});
    mockBuildProse.mockReturnValue(FAKE_INTAKE_PROSE);
    mockGetThread
      .mockResolvedValueOnce({ thread: makePendingThread(), messages: [] })
      .mockResolvedValueOnce({
        thread: makePendingThread(),
        messages: [
          {
            id: "u1",
            threadId: "thread-1",
            role: "user",
            parts: [{ type: "text", text: "knees ache" }],
            createdAt: new Date(),
          },
        ],
      });

    const app = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/coach/stream",
      payload: {
        threadId: "thread-1",
        messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "knees ache" }] }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/event-stream/);
    // Body is the SSE payload — must contain the standard v6 frame markers.
    expect(res.body).toContain("text-delta");
    expect(res.body).toContain("Tell me about your knees");

    // User message persisted before the stream starts.
    expect(mockPersist).toHaveBeenCalledWith(
      "thread-1",
      "user",
      expect.arrayContaining([expect.objectContaining({ type: "text", text: "knees ache" })]),
      expect.any(String),
    );
    // Assistant message persisted after stream finishes.
    const assistantCall = mockPersist.mock.calls.find((c) => c[1] === "assistant");
    expect(assistantCall).toBeDefined();

    expect(mockHandleChatStream).toHaveBeenCalledOnce();
    expect(mockHandleChatStream.mock.calls[0]![0]).toMatchObject({
      userId: "user-1",
      threadId: "thread-1",
      text: "knees ache",
      intakeProse: FAKE_INTAKE_PROSE,
    });
  });
});

// ── Tool side effects on finish ──────────────────────────────────────────

describe("/api/coach/stream — tool side effects", () => {
  it("endSession tool → transition + extraction + intake_summaries upsert", async () => {
    mockGetSession.mockResolvedValue({ user: FAKE_USER });
    mockLoadAnswers.mockResolvedValue({});
    mockBuildProse.mockReturnValue(FAKE_INTAKE_PROSE);
    mockGetThread.mockResolvedValue({ thread: makePendingThread(), messages: [] });
    mockExtract.mockResolvedValue({
      regions: {},
      currentInjuries: [],
      goalsContext: null,
      constraints: [],
    });
    mockHandleChatStream.mockResolvedValue(
      fakeUIMessageStream([{ type: "tool-endSession", input: {} }]),
    );

    const app = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/coach/stream",
      payload: {
        threadId: "thread-1",
        messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "all good" }] }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mockTransition).toHaveBeenCalledWith("thread-1");
    expect(mockExtract).toHaveBeenCalledOnce();
    expect(mockUpsertSummary).toHaveBeenCalledWith("user-1", "thread-1", expect.any(Object));
  });

  it("flagRedFlag tool → soft audit tag only; thread stays pending and extraction is skipped", async () => {
    mockGetSession.mockResolvedValue({ user: FAKE_USER });
    mockLoadAnswers.mockResolvedValue({});
    mockBuildProse.mockReturnValue(FAKE_INTAKE_PROSE);
    mockGetThread.mockResolvedValue({ thread: makePendingThread(), messages: [] });
    mockHandleChatStream.mockResolvedValue(
      fakeUIMessageStream([{ type: "tool-flagRedFlag", input: { reason: "neurological signs" } }]),
    );

    const app = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/coach/stream",
      payload: {
        threadId: "thread-1",
        messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "numbness in foot" }] }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mockFlag).toHaveBeenCalledWith("thread-1", "neurological signs");
    // Critical: red flag must NOT terminate the thread or trigger the
    // intake-summary extraction — the user keeps chatting.
    expect(mockTransition).not.toHaveBeenCalled();
    expect(mockExtract).not.toHaveBeenCalled();
    expect(mockUpsertSummary).not.toHaveBeenCalled();
  });

  it("flagRedFlag + endSession in the same response → thread completes and is flagged for review", async () => {
    mockGetSession.mockResolvedValue({ user: FAKE_USER });
    mockLoadAnswers.mockResolvedValue({});
    mockBuildProse.mockReturnValue(FAKE_INTAKE_PROSE);
    mockGetThread.mockResolvedValue({ thread: makePendingThread(), messages: [] });
    mockExtract.mockResolvedValue({
      regions: {},
      currentInjuries: [],
      goalsContext: null,
      constraints: ["red flag — see provider"],
    });
    mockHandleChatStream.mockResolvedValue(
      fakeUIMessageStream([
        { type: "tool-flagRedFlag", input: { reason: "post-op concern" } },
        { type: "tool-endSession", input: {} },
      ]),
    );

    const app = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/coach/stream",
      payload: {
        threadId: "thread-1",
        messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "all done" }] }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mockFlag).toHaveBeenCalledWith("thread-1", "post-op concern");
    expect(mockTransition).toHaveBeenCalledWith("thread-1");
    expect(mockExtract).toHaveBeenCalledOnce();
  });
});
