import { describe, it, expect, vi, beforeEach } from "vitest";
import { emitEvent } from "../events/emit.js";
import { DomainEvents } from "../events/types.js";

/**
 * account.delete handler tests (PRE-99, soft-delete).
 *
 * Verifies the handler marks the account for deletion, drops every session in
 * the same transaction, emits the deletion-scheduled event, and returns a
 * 30-day-out deletion date. The live-DB behaviour (column transitions +
 * reactivation-on-sign-in) is exercised separately; here we mock the db to keep
 * the suite runnable without Postgres.
 */

// ─── DB mock: a transaction whose tx exposes update().set().where() and delete().where()
const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });
const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);
const mockDelete = vi.fn().mockReturnValue({ where: mockDeleteWhere });
const mockTx = { update: mockUpdate, delete: mockDelete };
const mockTransaction = vi.fn(async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx));

vi.mock("../db", () => ({
  createDb: () => ({ transaction: mockTransaction }),
  db: { transaction: mockTransaction },
  waitlist: {},
  sessions: {},
  programSchedule: {},
  sportProfiles: {},
  capacityLogs: {},
  user: { id: "id" },
  account: {},
  verification: {},
  session: { userId: "user_id" },
  intakeSummaries: {},
  profileAnswers: {},
  sessionTemplates: {},
  notificationPreferences: {},
  progressMilestones: {},
  subscriptions: {},
  sessionTypeEnum: {},
  testDatabaseConnection: vi.fn().mockResolvedValue(true),
}));

vi.mock("../auth", () => ({
  auth: { api: { getSession: vi.fn().mockResolvedValue(null) }, handler: vi.fn() },
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

// oRPC stores the unwrapped handler at ['~orpc'].handler
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getHandler(procedure: unknown): (opts: any) => Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (procedure as any)["~orpc"].handler;
}

const context = {
  session: { user: { id: "u1", email: "user@example.com", name: "Test User" } },
};

describe("account.delete handler (soft-delete)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks the account for deletion, drops sessions in a transaction, and returns ok + a date", async () => {
    const { router } = await import("../rpc/router");
    const handler = getHandler(router.account.delete);

    const result = await handler({ input: undefined, context });

    expect(result.ok).toBe(true);
    expect(typeof result.deletionDate).toBe("string");
    expect(mockTransaction).toHaveBeenCalledOnce();
    // user row updated with a deletionScheduledAt Date
    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(mockUpdateSet).toHaveBeenCalledWith({ deletionScheduledAt: expect.any(Date) });
    // every session dropped
    expect(mockDelete).toHaveBeenCalledOnce();
  });

  it("emits account_deletion_scheduled with the user's email, name, and deletion date", async () => {
    const { router } = await import("../rpc/router");
    const handler = getHandler(router.account.delete);

    const result = await handler({ input: undefined, context });

    expect(emitEvent).toHaveBeenCalledWith(
      DomainEvents.ACCOUNT_DELETION_SCHEDULED,
      { email: "user@example.com", name: "Test User", deletionDate: result.deletionDate },
      expect.objectContaining({ tx: mockTx }),
    );
  });

  it("schedules deletion ~30 days out", async () => {
    const { router } = await import("../rpc/router");
    const handler = getHandler(router.account.delete);

    const before = Date.now();
    const result = await handler({ input: undefined, context });
    const daysOut = (new Date(result.deletionDate).getTime() - before) / (24 * 60 * 60 * 1000);

    expect(daysOut).toBeGreaterThan(29.9);
    expect(daysOut).toBeLessThan(30.1);
  });
});
