import type { GradeValue, LoggedSummary, StoredSession } from "@trainstack/contract";
import {
  asFont,
  asV,
  boulderingSummary,
  type GradedProblem,
  type LoggedSession,
  loggedSessionSchema,
  personalRecords,
  sessionLoad,
  strengthNumbers,
  strengthSummary,
} from "@trainstack/logbook";
import { type DatedChange, profileOn } from "@trainstack/zones";
import { and, asc, desc, eq, inArray, lt, sql, type SQL } from "drizzle-orm";

import type { Database } from "../db";
import { activity, loggedSession } from "../db/schema";
import { sha256Hex } from "../activities/files";
import { settingsHistoryOf } from "../settings/router";

export const LOGBOOK_SOURCE = "logbook";

export const activityIdOf = (sessionId: string) =>
  sha256Hex(new TextEncoder().encode(`${LOGBOOK_SOURCE}:${sessionId}`));

export const bodyOf = (session: LoggedSession) =>
  JSON.stringify({ ...session, startedAt: session.startedAt.toISOString() });

export function sessionOf(body: string): LoggedSession {
  const stored = JSON.parse(body) as Omit<LoggedSession, "startedAt"> & { startedAt: string };
  return loggedSessionSchema.parse({ ...stored, startedAt: new Date(stored.startedAt) });
}

export type SessionRow = {
  id: string;
  activityId: string;
  body: string;
  editedAt: Date;
  createdAt: Date;
  localDay: string | null;
  startedAt: Date | null;
};

export function sessionRows(
  db: Database,
  userId: string,
  condition?: SQL,
  { latestFirst = false } = {},
) {
  const order = latestFirst ? desc : asc;
  return db
    .select({
      id: loggedSession.id,
      activityId: loggedSession.activityId,
      body: loggedSession.body,
      editedAt: loggedSession.editedAt,
      createdAt: loggedSession.createdAt,
      localDay: activity.localDay,
      startedAt: activity.startedAt,
    })
    .from(loggedSession)
    .innerJoin(
      activity,
      and(eq(activity.userId, loggedSession.userId), eq(activity.id, loggedSession.activityId)),
    )
    .where(and(eq(loggedSession.userId, userId), condition))
    .orderBy(order(activity.startedAt), order(loggedSession.id));
}

export function bodyMassOn(history: readonly DatedChange[]) {
  const byDay = new Map<string, number | null>();
  return (day: string | null) => {
    const key = day ?? "";
    if (!byDay.has(key)) byDay.set(key, profileOn(history, day).weightKg);
    return byDay.get(key)!;
  };
}

export function gradeValue(problem: GradedProblem | null): GradeValue | null {
  if (!problem) return null;
  const { grade, circuit } = problem;
  return {
    grade,
    circuit: grade.scale === "circuit" ? (circuit?.name ?? null) : null,
    font: asFont(grade, circuit),
    v: asV(grade, circuit),
  };
}

export function summaryOf(session: LoggedSession, bodyMassKg: number | null): LoggedSummary {
  const { detail } = session;
  if (detail.sport === "strength") return strengthSummary(detail, bodyMassKg);
  const summary = boulderingSummary(detail);
  return {
    ...summary,
    hardestTop: gradeValue(summary.hardestTop),
    hardestFlash: gradeValue(summary.hardestFlash),
  };
}

export async function loggedOf(db: Database, userId: string, activityIds: string[]) {
  const logged = new Map<string, { sessionId: string; summary: LoggedSummary }>();
  if (activityIds.length === 0) return logged;
  const rows = await sessionRows(
    db,
    userId,
    inArray(
      loggedSession.activityId,
      sql`(SELECT value FROM json_each(${JSON.stringify(activityIds)}))`,
    ),
  );
  if (rows.length === 0) return logged;
  const massOn = bodyMassOn(await settingsHistoryOf(db, userId));
  for (const row of rows) {
    logged.set(row.activityId, {
      sessionId: row.id,
      summary: summaryOf(sessionOf(row.body), massOn(row.localDay)),
    });
  }
  return logged;
}

async function earlierStrength(db: Database, userId: string, before: Date) {
  return sessionRows(
    db,
    userId,
    and(eq(loggedSession.sport, "strength"), lt(activity.startedAt, before)),
  );
}

export async function storedOf(db: Database, userId: string, row: SessionRow) {
  const session = sessionOf(row.body);
  const massOn = bodyMassOn(await settingsHistoryOf(db, userId));
  const bodyMassKg = massOn(row.localDay);
  const { detail } = session;
  let numbers: StoredSession["numbers"];
  if (detail.sport === "strength") {
    const exercises = strengthNumbers(detail, bodyMassKg);
    const earlier = (await earlierStrength(db, userId, session.startedAt)).flatMap((other) => {
      const otherDetail = sessionOf(other.body).detail;
      return otherDetail.sport === "strength"
        ? strengthNumbers(otherDetail, massOn(other.localDay))
        : [];
    });
    numbers = { sport: "strength", exercises, records: personalRecords(exercises, earlier) };
  } else {
    numbers = { sport: "bouldering" };
  }
  return {
    id: row.id,
    activityId: row.activityId,
    localDay: row.localDay!,
    session,
    editedAt: row.editedAt,
    createdAt: row.createdAt,
    load: sessionLoad(session.rpe, session.durationSeconds),
    bodyMassKg,
    numbers,
    summary: summaryOf(session, bodyMassKg),
  } satisfies StoredSession;
}

export function statisticsOf(session: LoggedSession) {
  const statistics: Record<string, number> = { elapsed_s: session.durationSeconds };
  const load = sessionLoad(session.rpe, session.durationSeconds);
  if (load) {
    statistics.session_rpe_load_au = load.sessionRpeLoad;
    statistics.rpe_stress_tss = load.stressScore;
    statistics.load_tss = load.stressScore;
  }
  return statistics;
}

export function indoorOf(session: LoggedSession) {
  return session.detail.sport === "bouldering" ? session.detail.venue.kind === "gym" : null;
}
