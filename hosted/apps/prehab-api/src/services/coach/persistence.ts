import type { IntakeSummary } from "@trainstack/prehab-contract";
import { and, asc, eq } from "drizzle-orm";

import { db, intakeSummaries, messages, threads } from "../../db";

export interface PersistedThread {
  id: string;
  userId: string;
  type: string;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  flaggedForReviewAt: Date | null;
  flagReason: string | null;
}

export interface PersistedMessage {
  id: string;
  threadId: string;
  role: string;
  parts: unknown[];
  createdAt: Date;
}

export const INTAKE_THREAD_TYPE = "intake";

function toPersistedThread(row: typeof threads.$inferSelect): PersistedThread {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    status: row.status,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    flaggedForReviewAt: row.flaggedForReviewAt,
    flagReason: row.flagReason,
  };
}

function toPersistedMessage(row: typeof messages.$inferSelect): PersistedMessage {
  return {
    id: row.id,
    threadId: row.threadId,
    role: row.role,
    // `content` is a UIMessage `parts` array — kept as `unknown[]` here so the
    // route handler casts to V6UIMessage at the wire boundary.
    parts: (row.content as unknown[]) ?? [],
    createdAt: row.createdAt,
  };
}

/**
 * Read-only — returns the user's pending intake thread or null. Used by the
 * home/settings resume entries to detect a pending thread without creating
 * one as a side effect.
 */
export async function getPendingIntakeThread(userId: string): Promise<PersistedThread | null> {
  const rows = await db
    .select()
    .from(threads)
    .where(
      and(
        eq(threads.userId, userId),
        eq(threads.type, INTAKE_THREAD_TYPE),
        eq(threads.status, "pending"),
      ),
    )
    .limit(1);

  return rows[0] ? toPersistedThread(rows[0]) : null;
}

/**
 * Idempotent: returns the user's existing pending intake thread or creates one.
 * A pending thread takes priority — re-running the Coach replaces nothing,
 * it resumes. Completed/skipped threads are left alone and a new pending
 * thread is created so re-running starts a fresh conversation.
 */
export async function getOrCreatePendingIntakeThread(userId: string): Promise<PersistedThread> {
  const existing = await db
    .select()
    .from(threads)
    .where(
      and(
        eq(threads.userId, userId),
        eq(threads.type, INTAKE_THREAD_TYPE),
        eq(threads.status, "pending"),
      ),
    )
    .limit(1);

  if (existing.length > 0) return toPersistedThread(existing[0]!);

  const inserted = await db
    .insert(threads)
    .values({ userId, type: INTAKE_THREAD_TYPE, status: "pending" })
    .returning();

  return toPersistedThread(inserted[0]!);
}

export async function getThreadForUser(
  userId: string,
  threadId: string,
): Promise<{ thread: PersistedThread; messages: PersistedMessage[] } | null> {
  const threadRows = await db
    .select()
    .from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.userId, userId)))
    .limit(1);

  const threadRow = threadRows[0];
  if (!threadRow) return null;

  const messageRows = await db
    .select()
    .from(messages)
    .where(eq(messages.threadId, threadId))
    .orderBy(asc(messages.createdAt));

  return {
    thread: toPersistedThread(threadRow),
    messages: messageRows.map(toPersistedMessage),
  };
}

/** Persists a single message's `parts` array. Caller controls role + ordering. */
export async function persistMessage(
  threadId: string,
  role: "user" | "assistant" | "system",
  parts: unknown[],
  id: string = crypto.randomUUID(),
): Promise<PersistedMessage> {
  const inserted = await db
    .insert(messages)
    .values({ id, threadId, role, content: parts })
    .onConflictDoUpdate({ target: messages.id, set: { content: parts } })
    .returning();
  return toPersistedMessage(inserted[0]!);
}

export async function transitionThreadCompleted(threadId: string): Promise<void> {
  await db
    .update(threads)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(threads.id, threadId));
}

export async function flagThreadForReview(threadId: string, reason: string): Promise<void> {
  await db
    .update(threads)
    .set({ flaggedForReviewAt: new Date(), flagReason: reason })
    .where(eq(threads.id, threadId));
}

export async function upsertIntakeSummary(
  userId: string,
  threadId: string,
  summary: IntakeSummary,
): Promise<void> {
  // Read any existing summary so we can preserve the structured-intake prose
  // half (written by sportProfile.savePartial) while overwriting the Coach
  // extraction half.
  const prior = await db
    .select({ summary: intakeSummaries.summary })
    .from(intakeSummaries)
    .where(eq(intakeSummaries.userId, userId))
    .limit(1);
  const priorPayload = (prior[0]?.summary as Record<string, unknown> | null) ?? {};

  const merged = {
    ...priorPayload,
    ...summary,
  };

  await db
    .insert(intakeSummaries)
    .values({ userId, threadId, summary: merged })
    .onConflictDoUpdate({
      target: intakeSummaries.userId,
      set: { threadId, summary: merged, extractedAt: new Date() },
    });
}
