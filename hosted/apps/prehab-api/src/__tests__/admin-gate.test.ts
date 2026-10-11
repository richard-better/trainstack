import { describe, expect, it, vi } from "vitest";
import { call } from "@orpc/server";

/**
 * Admin staff-gate tests (PRE-129). Exercises adminMiddleware end-to-end via
 * oRPC `call` (the raw-handler shortcut other router tests use would bypass the
 * middleware, which is exactly what we're testing here). DB/services are mocked
 * so the router module imports without a real Postgres.
 */

// The allowlist the gate reads. ADMIN_EMAILS is checked case-insensitively.
vi.mock("@trainstack/prehab-env/server", () => ({
  env: { ADMIN_EMAILS: "admin@pre.app, second@pre.app", LOG_LEVEL: "silent" },
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
  llmCallLogs: {},
  sessionTemplates: {},
  threads: {},
  messages: {},
  notificationPreferences: {},
  subscriptions: {},
  plans: {},
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

// The gate only reads context.session?.user; a partial session is fine at
// runtime. Cast past the full Better-Auth context type for the test.
const adminCtx = (email: string) =>
  ({ auth: null, session: { user: { id: "u-admin", email, name: "Staff" } } }) as never;
const anonCtx = { auth: null, session: null } as never;

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "NO_ERROR";
  } catch (e) {
    return (e as { code?: string }).code ?? "UNKNOWN";
  }
}

describe("admin staff gate", () => {
  it("rejects an unauthenticated caller with UNAUTHORIZED", async () => {
    const { router } = await import("../rpc/router");
    const code = await codeOf(() => call(router.admin.me, undefined, { context: anonCtx }));
    expect(code).toBe("UNAUTHORIZED");
  });

  it("rejects a signed-in non-admin with FORBIDDEN", async () => {
    const { router } = await import("../rpc/router");
    const code = await codeOf(() =>
      call(router.admin.me, undefined, { context: adminCtx("random@user.com") }),
    );
    expect(code).toBe("FORBIDDEN");
  });

  it("allows an allowlisted admin and returns their identity", async () => {
    const { router } = await import("../rpc/router");
    const result = await call(router.admin.me, undefined, {
      context: adminCtx("admin@pre.app"),
    });
    expect(result).toEqual({ userId: "u-admin", email: "admin@pre.app", name: "Staff" });
  });

  it("matches the allowlist case-insensitively", async () => {
    const { router } = await import("../rpc/router");
    const result = await call(router.admin.me, undefined, {
      context: adminCtx("ADMIN@PRE.APP"),
    });
    expect(result.email).toBe("ADMIN@PRE.APP");
  });
});
