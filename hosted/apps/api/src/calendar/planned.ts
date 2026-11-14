import {
  MAX_PLANNED_PER_DAY,
  MAX_WORKOUT_BYTES,
  type PlannedContent,
  type PlannedWorkout,
} from "@trainstack/contract";
import { plannedEstimate, type PlanThresholds } from "@trainstack/analysis";
import type { Workout } from "@trainstack/workout";
import {
  type DatedChange,
  metricSettings,
  paceDistanceMetres,
  type Profile,
  profileOn,
} from "@trainstack/zones";
import { and, asc, eq, gt, type SQL, sql } from "drizzle-orm";

import type { Database } from "../db";
import { plannedWorkout } from "../db/schema";
import { settingsHistoryOf } from "../settings/router";

export type PlannedRow = typeof plannedWorkout.$inferSelect;

export const findPlanned = (db: Database, userId: string, id: string) =>
  db
    .select()
    .from(plannedWorkout)
    .where(and(eq(plannedWorkout.userId, userId), eq(plannedWorkout.id, id)))
    .get();

const nextRevision = (userId: string) =>
  sql`(SELECT coalesce(max(revision), 0) + 1 FROM ${plannedWorkout} WHERE user_id = ${userId})`;

const latest = (...dates: (Date | null)[]) =>
  new Date(Math.max(...dates.map((date) => date?.getTime() ?? 0)));

export function stateOf(row: PlannedRow, today: string): PlannedWorkout["state"] {
  if (row.skipped) return "skipped";
  if (row.kind === "workout" && row.day! < today) return "missed";
  return "planned";
}

function contentOf(stored: string): PlannedContent {
  const content = JSON.parse(stored) as PlannedContent;
  if (content.kind !== "workout" || content.source?.kind !== "library") return content;
  return {
    ...content,
    source: { ...content.source, updatedAt: new Date(content.source.updatedAt) },
  };
}

export function plannedOf(row: PlannedRow, today: string): PlannedWorkout {
  return {
    id: row.id,
    day: row.day!,
    position: row.position!,
    content: contentOf(row.content!),
    planId: row.planId,
    planned:
      row.kind === "workout"
        ? { seconds: row.plannedSeconds, meters: row.plannedMeters, load: row.plannedLoad }
        : null,
    skipped: row.skipped ? { reason: row.skipReason } : null,
    state: stateOf(row, today),
    createdAt: row.createdAt,
    updatedAt: latest(row.placedAt, row.contentAt, row.skippedAt),
  };
}

export const isContentTooLarge = (content: PlannedContent) =>
  new TextEncoder().encode(JSON.stringify(content)).byteLength > MAX_WORKOUT_BYTES;

export function thresholdsFor(profile: Profile, sport: Workout["sport"]): PlanThresholds {
  const thresholdPace = metricSettings(profile, "pace", sport)?.thresholds.threshold_pace;
  const paceDistance = paceDistanceMetres(sport);
  return {
    ftp: metricSettings(profile, "power", sport)?.thresholds.ftp,
    thresholdSpeed:
      thresholdPace !== undefined && paceDistance !== undefined
        ? paceDistance / thresholdPace
        : undefined,
    lactateThresholdHeartRate: metricSettings(profile, "heart_rate", sport)?.thresholds
      .lactate_threshold_heart_rate,
  };
}

type Estimate = { seconds: number | null; meters: number | null; load: number | null };

const noEstimate: Estimate = { seconds: null, meters: null, load: null };

function estimatorFor(db: Database, userId: string) {
  let history: Promise<DatedChange[]> | undefined;
  return async (content: PlannedContent, day: string): Promise<Estimate> => {
    if (content.kind !== "workout") return noEstimate;
    history ??= settingsHistoryOf(db, userId);
    const profile = profileOn(await history, day);
    return plannedEstimate(content.workout, thresholdsFor(profile, content.workout.sport));
  };
}

async function holdsAtLeast(db: Database, columns: SQL, ours: SQL, userId: string, id: string) {
  const row = await db.get<{ held: number }>(sql`
    SELECT ${columns} >= ${ours} AS held FROM ${plannedWorkout} WHERE user_id = ${userId} AND id = ${id}
  `);
  return row?.held === 1;
}

const roomOn = (userId: string, day: string, id: string) =>
  sql`(SELECT count(*) FROM ${plannedWorkout} WHERE user_id = ${userId} AND day = ${day} AND deleted_at IS NULL AND id != ${id}) < ${MAX_PLANNED_PER_DAY}`;

const WRITE_ATTEMPTS = 5;

export type Written =
  | { kind: "written"; row: PlannedRow }
  | { kind: "deleted"; deletedAt: Date }
  | { kind: "dayFull" }
  | { kind: "missing" };

export type PlannedPut = {
  id: string;
  day: string;
  position: number;
  content: PlannedContent;
  planId: string | null;
  updatedAt: Date;
};

export async function putPlanned(
  db: Database,
  userId: string,
  input: PlannedPut,
): Promise<Written> {
  const estimate = estimatorFor(db, userId);
  const content = JSON.stringify(input.content);
  const at = input.updatedAt.getTime();
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
    const before = await findPlanned(db, userId, input.id);
    if (before?.deletedAt) return { kind: "deleted", deletedAt: before.deletedAt };
    const day = before?.day ?? input.day;
    const planned = await estimate(input.content, day);
    if (!before) {
      await db.run(sql`
        INSERT INTO ${plannedWorkout} (user_id, id, day, position, placed_at, kind, plan_id, content, content_at, planned_seconds, planned_meters, planned_load, revision)
        SELECT ${userId}, ${input.id}, ${day}, ${input.position}, ${at}, ${input.content.kind}, ${input.planId}, ${content}, ${at}, ${planned.seconds}, ${planned.meters}, ${planned.load}, ${nextRevision(userId)}
        WHERE ${roomOn(userId, day, input.id)}
        ON CONFLICT (user_id, id) DO NOTHING
      `);
    } else {
      await db.run(sql`
        UPDATE ${plannedWorkout}
        SET kind = ${input.content.kind}, plan_id = ${input.planId}, content = ${content}, content_at = ${at},
          planned_seconds = ${planned.seconds}, planned_meters = ${planned.meters}, planned_load = ${planned.load},
          revision = ${nextRevision(userId)}
        WHERE user_id = ${userId} AND id = ${input.id} AND deleted_at IS NULL AND day = ${day}
          AND (${at}, ${content}, ${input.planId ?? ""}) > (content_at, content, coalesce(plan_id, ''))
      `);
    }
    const after = await findPlanned(db, userId, input.id);
    if (!after) {
      if (!(await hasRoom(db, userId, day, input.id))) return { kind: "dayFull" };
      continue;
    }
    if (after.deletedAt) return { kind: "deleted", deletedAt: after.deletedAt };
    const held = await holdsAtLeast(
      db,
      sql`(content_at, content, coalesce(plan_id, ''))`,
      sql`(${at}, ${content}, ${input.planId ?? ""})`,
      userId,
      input.id,
    );
    if (held) {
      return { kind: "written", row: after };
    }
  }
  throw new Error(`Planned workout ${input.id} kept changing while it was written`);
}

async function hasRoom(db: Database, userId: string, day: string, id: string) {
  const row = await db.get<{ room: number }>(sql`SELECT ${roomOn(userId, day, id)} AS room`);
  return row?.room === 1;
}

export async function movePlanned(
  db: Database,
  userId: string,
  { id, day, position, updatedAt }: { id: string; day: string; position: number; updatedAt: Date },
): Promise<Written> {
  const estimate = estimatorFor(db, userId);
  const at = updatedAt.getTime();
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
    const before = await findPlanned(db, userId, id);
    if (!before) return { kind: "missing" };
    if (before.deletedAt) return { kind: "deleted", deletedAt: before.deletedAt };
    const planned = await estimate(JSON.parse(before.content!) as PlannedContent, day);
    await db.run(sql`
      UPDATE ${plannedWorkout}
      SET day = ${day}, position = ${position}, placed_at = ${at},
        planned_seconds = ${planned.seconds}, planned_meters = ${planned.meters}, planned_load = ${planned.load},
        revision = ${nextRevision(userId)}
      WHERE user_id = ${userId} AND id = ${id} AND deleted_at IS NULL AND content = ${before.content}
        AND (${at}, ${day}, ${position}) > (placed_at, day, position)
        AND (day = ${day} OR ${roomOn(userId, day, id)})
    `);
    const after = (await findPlanned(db, userId, id))!;
    if (after.deletedAt) return { kind: "deleted", deletedAt: after.deletedAt };
    const held = await holdsAtLeast(
      db,
      sql`(placed_at, day, position)`,
      sql`(${at}, ${day}, ${position})`,
      userId,
      id,
    );
    if (held) {
      return { kind: "written", row: after };
    }
    if (after.content === before.content) return { kind: "dayFull" };
  }
  throw new Error(`Planned workout ${id} kept changing while it was moved`);
}

export function skipPlanned(
  db: Database,
  userId: string,
  {
    id,
    skipped,
    updatedAt,
  }: { id: string; skipped: { reason: string | null } | null; updatedAt: Date },
) {
  const isSkipped = skipped === null ? 0 : 1;
  const reason = skipped?.reason ?? null;
  return db.run(sql`
    UPDATE ${plannedWorkout}
    SET skipped = ${isSkipped}, skip_reason = ${reason}, skipped_at = ${updatedAt.getTime()}, revision = ${nextRevision(userId)}
    WHERE user_id = ${userId} AND id = ${id} AND deleted_at IS NULL
      AND (${updatedAt.getTime()}, ${isSkipped}, ${reason ?? ""}) > (coalesce(skipped_at, -1), skipped, coalesce(skip_reason, ''))
  `);
}

export async function deletePlanned(db: Database, userId: string, id: string) {
  const deletedAt = new Date();
  await db
    .insert(plannedWorkout)
    .values({ userId, id, deletedAt, revision: nextRevision(userId) })
    .onConflictDoUpdate({
      target: [plannedWorkout.userId, plannedWorkout.id],
      set: {
        day: null,
        position: null,
        placedAt: null,
        kind: null,
        planId: null,
        content: null,
        contentAt: null,
        plannedSeconds: null,
        plannedMeters: null,
        plannedLoad: null,
        skipped: false,
        skipReason: null,
        skippedAt: null,
        deletedAt: sql`excluded.deleted_at`,
        revision: sql`excluded.revision`,
      },
      setWhere: sql`${plannedWorkout.deletedAt} IS NULL`,
    });
  const row = await findPlanned(db, userId, id);
  return { id, deletedAt: row?.deletedAt ?? deletedAt };
}

export async function plannedChanges(
  db: Database,
  userId: string,
  since: string | undefined,
  today: string,
) {
  const after = since === undefined ? 0 : Number(since);
  const rows = await db
    .select()
    .from(plannedWorkout)
    .where(and(eq(plannedWorkout.userId, userId), gt(plannedWorkout.revision, after)))
    .orderBy(asc(plannedWorkout.revision));
  const cursor = Math.max(after, ...rows.map((row) => row.revision));
  return {
    planned: rows.filter((row) => row.deletedAt === null).map((row) => plannedOf(row, today)),
    deleted: rows.flatMap((row) =>
      row.deletedAt ? [{ id: row.id, deletedAt: row.deletedAt }] : [],
    ),
    cursor: String(cursor),
  };
}
