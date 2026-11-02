import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { Database } from "../db";
import { feedback } from "../db/schema";
import { hasAppleAccount, requireRider, riderId, type RiderOf } from "../rider";

export type FeedbackDeps = {
  env: {
    GITHUB_FEEDBACK_TOKEN?: string;
  };
  database: () => Database;
  userId: RiderOf;
  fetcher?: typeof fetch;
};

export const FEEDBACK_REPOSITORY = "richard-better/trainstack";
const FEEDBACK_PER_ACCOUNT_PER_DAY = 10;
const DAY_SECONDS = 24 * 60 * 60;
const TITLE_MAX_LENGTH = 72;

const Submission = z.object({
  message: z.string().trim().min(1).max(5000),
  context: z
    .object({
      app: z.string().max(100),
      system: z.string().max(100),
      device: z.string().max(100),
      screen: z.string().max(100),
      window: z.string().max(100),
    })
    .partial()
    .default({}),
});
type Submission = z.infer<typeof Submission>;

const CONTEXT_LABELS: Record<keyof Submission["context"], string> = {
  app: "App",
  system: "System",
  device: "Device",
  screen: "Screen",
  window: "Window",
};

export function feedbackRoutes(deps: FeedbackDeps) {
  const app = new Hono();
  const fetcher = deps.fetcher ?? fetch;

  app.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });
  app.use("*", requireRider(deps.userId));

  app.post("/", async (c) => {
    const token = deps.env.GITHUB_FEEDBACK_TOKEN;
    if (!token) return c.json({ error: "feedback_not_configured" }, 503);
    const parsed = Submission.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: "invalid_request" }, 400);
    const userId = riderId(c);
    const database = deps.database();
    if (!(await hasAppleAccount(database, userId))) {
      return c.json({ error: "apple_account_required" }, 403);
    }

    const id = crypto.randomUUID();
    if (!(await reserveWithinDailyLimit(database, id, userId))) {
      return c.json({ error: "rate_limited" }, 429);
    }
    const issue = await createIssue(fetcher, token, parsed.data).catch((error: unknown) => {
      console.error(error);
      return undefined;
    });
    if (!issue) {
      await releaseReservation(database, id);
      return c.json({ error: "github_unavailable" }, 502);
    }
    await database
      .update(feedback)
      .set({ issueNumber: issue.number })
      .where(and(eq(feedback.id, id), eq(feedback.userId, userId)));
    return c.json({ number: issue.number, url: issue.html_url }, 201);
  });

  return app;
}

async function reserveWithinDailyLimit(database: Database, id: string, userId: string) {
  const now = Math.floor(Date.now() / 1000);
  const recent = sql`SELECT count(*) FROM ${feedback} WHERE ${feedback.userId} = ${userId} AND ${feedback.createdAt} > ${now - DAY_SECONDS}`;
  const result = await database.run(
    sql`INSERT INTO ${feedback} (id, user_id, created_at) SELECT ${id}, ${userId}, ${now} WHERE (${recent}) < ${FEEDBACK_PER_ACCOUNT_PER_DAY}`,
  );
  return result.meta.changes > 0;
}

const releaseReservation = (database: Database, id: string) =>
  database.delete(feedback).where(eq(feedback.id, id));

type Issue = { number: number; html_url: string };

async function createIssue(
  fetcher: typeof fetch,
  token: string,
  submission: Submission,
): Promise<Issue> {
  const response = await fetcher(`https://api.github.com/repos/${FEEDBACK_REPOSITORY}/issues`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "trainstack-api",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ title: issueTitle(submission.message), body: issueBody(submission) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status !== 201) {
    throw new Error(`GitHub answered ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as Issue;
}

export function issueTitle(message: string) {
  const line =
    message
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .find(Boolean) ?? "";
  const short =
    line.length > TITLE_MAX_LENGTH ? `${line.slice(0, TITLE_MAX_LENGTH - 1).trimEnd()}…` : line;
  return `Feedback: ${short}`;
}

export function issueBody({ message, context }: Submission) {
  const details = (Object.keys(CONTEXT_LABELS) as (keyof Submission["context"])[])
    .map((key) => [CONTEXT_LABELS[key], withoutFormatting(context[key] ?? "")] as const)
    .filter(([, value]) => value)
    .map(([label, value]) => `- ${label}: ${value}`);
  return [
    ...asInertCodeBlock(message.trim()),
    "",
    "---",
    "",
    ...details,
    ...(details.length ? [""] : []),
    "_Sent from Send Feedback in TrainStack Ride._",
  ].join("\n");
}

function asInertCodeBlock(text: string) {
  const longestBacktickRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longestBacktickRun + 1));
  return [`${fence}text`, text, fence];
}

const withoutFormatting = (text: string) => text.replace(/[^\p{L}\p{N} .,()×+-]/gu, "").trim();
