/**
 * Emit a domain event by enqueuing a Graphile Worker job.
 *
 * Can be called standalone (uses default db connection) or within a Drizzle
 * transaction for atomic state-change + event-emission:
 *
 *   await db.transaction(async (tx) => {
 *     await tx.insert(sessions).values(session);
 *     await emitEvent("session_completed", payload, { tx });
 *   });
 */

import { type SQL, sql } from "drizzle-orm";
import { db } from "../db";
import type { DomainEventName, EventPayloads } from "./types";

interface SqlExecutor {
  execute(query: SQL): Promise<unknown>;
}

interface EmitOptions {
  /** Execute within this Drizzle transaction for atomicity */
  tx?: SqlExecutor;
  /** Schedule for future execution (default: immediate) */
  runAt?: Date;
  /** Max retry attempts (default: 25) */
  maxAttempts?: number;
  /** Idempotency key — prevents duplicate jobs with same key */
  jobKey?: string;
  /** Queue name for ordered processing within a queue */
  queueName?: string;
  /** Job priority (lower number = higher priority, default: 0) */
  priority?: number;
}

export async function emitEvent<E extends DomainEventName>(
  event: E,
  payload: EventPayloads[E],
  options?: EmitOptions,
): Promise<void> {
  const executor: SqlExecutor = options?.tx ?? db;
  const payloadJson = JSON.stringify(payload);

  await executor.execute(
    sql`SELECT graphile_worker.add_job(
      identifier := ${event}::text,
      payload := ${payloadJson}::json,
      queue_name := ${options?.queueName ?? null}::text,
      run_at := ${options?.runAt?.toISOString() ?? null}::timestamptz,
      max_attempts := ${options?.maxAttempts ?? 25}::int,
      job_key := ${options?.jobKey ?? null}::text,
      priority := ${options?.priority ?? 0}::int
    )`,
  );
}
