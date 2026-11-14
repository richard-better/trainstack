import {
  type IntervalCompliance,
  intervalCompliance,
  type AnalysisActivity,
} from "@trainstack/analysis";
import type { PlannedContent, PlannedCompliance } from "@trainstack/contract";
import type { Workout } from "@trainstack/workout";
import type { Profile } from "@trainstack/zones";
import { and, eq, inArray, isNull, type SQL, sql } from "drizzle-orm";

import { sha256Hex } from "../activities/files";
import type { Database } from "../db";
import {
  activity,
  activityAnalysis,
  plannedIntervalCompliance,
  plannedWorkout,
} from "../db/schema";
import { thresholdsFor } from "./planned";

export const contentHashOf = (content: string) => sha256Hex(new TextEncoder().encode(content));

export type PlannedForCompliance = { id: string; contentHash: string; workout: Workout };

export const lastsUntilLap = (blocks: Workout["steps"]): boolean =>
  blocks.some((block) =>
    block.type === "repeat" ? lastsUntilLap(block.steps) : block.duration.type === "open",
  );

const hasTargets = (blocks: Workout["steps"]): boolean =>
  blocks.some((block) =>
    block.type === "repeat"
      ? hasTargets(block.steps)
      : block.target !== undefined && block.target.type !== "maxEffort",
  );

export async function plannedWorkoutsOn(db: Database, userId: string, day: string | null) {
  if (day === null) return [];
  const rows = await db
    .select({ id: plannedWorkout.id, content: plannedWorkout.content })
    .from(plannedWorkout)
    .where(
      and(
        eq(plannedWorkout.userId, userId),
        eq(plannedWorkout.day, day),
        eq(plannedWorkout.kind, "workout"),
        isNull(plannedWorkout.deletedAt),
      ),
    );
  const targeted = rows
    .map((row) => ({
      id: row.id,
      content: row.content!,
      workout: (JSON.parse(row.content!) as PlannedContent & { kind: "workout" }).workout,
    }))
    .filter(({ workout }) => hasTargets(workout.steps))
    .toSorted((a, b) => (a.id < b.id ? -1 : 1));
  return Promise.all(
    targeted.map(async ({ id, content, workout }): Promise<PlannedForCompliance> => ({
      id,
      contentHash: await contentHashOf(content),
      workout,
    })),
  );
}

export const signatureOf = (planned: readonly PlannedForCompliance[]) =>
  planned.map(({ id, contentHash }) => `${id}:${contentHash}`).join(",");

export function compliancesOf(
  file: AnalysisActivity,
  planned: readonly PlannedForCompliance[],
  profile: Profile,
) {
  return planned.map(({ id, contentHash, workout }) => ({
    plannedId: id,
    contentHash,
    result: intervalCompliance(file, workout, thresholdsFor(profile, workout.sport)),
  }));
}

export type StoredCompliance = ReturnType<typeof compliancesOf>[number];

export function storeCompliances(
  db: Database,
  userId: string,
  activityId: string,
  compliances: readonly StoredCompliance[],
  stillOurs: SQL,
) {
  return [
    db.run(sql`
      DELETE FROM ${plannedIntervalCompliance}
      WHERE user_id = ${userId} AND activity_id = ${activityId} AND ${stillOurs}
    `),
    db.run(sql`
      INSERT INTO ${plannedIntervalCompliance} (user_id, activity_id, planned_id, content_hash, result)
      SELECT ${userId}, ${activityId}, value ->> 'plannedId', value ->> 'contentHash', value -> 'result'
      FROM json_each(${JSON.stringify(compliances)}) WHERE ${stillOurs}
    `),
  ] as const;
}

export function checkComplianceOn(db: Database, userId: string, days: readonly string[]) {
  return db.run(sql`
    UPDATE ${activityAnalysis} SET due = 1, generation = generation + 1
    WHERE user_id = ${userId} AND activity_id IN (
      SELECT id FROM ${activity}
      WHERE user_id = ${userId} AND local_day IN (SELECT value FROM json_each(${JSON.stringify(days)}))
    )
  `);
}

export async function intervalsOf(
  db: Database,
  userId: string,
  pairs: readonly { plannedId: string; activityId: string }[],
) {
  if (pairs.length === 0)
    return new Map<string, { contentHash: string; result: IntervalCompliance | null }>();
  const rows = await db
    .select()
    .from(plannedIntervalCompliance)
    .where(
      and(
        eq(plannedIntervalCompliance.userId, userId),
        inArray(
          plannedIntervalCompliance.activityId,
          sql`(SELECT value FROM json_each(${JSON.stringify(pairs.map((pair) => pair.activityId))}))`,
        ),
      ),
    );
  return new Map(
    rows.map((row) => [
      `${row.plannedId} ${row.activityId}`,
      { contentHash: row.contentHash, result: row.result },
    ]),
  );
}

export const partBand = 0.2;
export const partZero = 0.5;

const ratioScore = (ratio: number) =>
  Math.min(1, Math.max(0, 1 - (Math.abs(ratio - 1) - partBand) / (partZero - partBand)));

function part(planned: number | null, done: number | null) {
  if (planned === null || done === null || !(planned > 0)) return null;
  const ratio = done / planned;
  return { planned, done, ratio, score: ratioScore(ratio) };
}

export function complianceOf({
  planned,
  done,
  intervals,
  withSteps,
  pending,
  lengthIsTheAthletes,
}: {
  planned: { seconds: number | null; meters: number | null; load: number | null };
  done: { seconds: number | null; meters: number | null; load: number | null };
  intervals: IntervalCompliance | null;
  withSteps: boolean;
  pending: boolean;
  lengthIsTheAthletes: boolean;
}): PlannedCompliance {
  const length = (plannedValue: number | null, doneValue: number | null) =>
    lengthIsTheAthletes ? null : part(plannedValue, doneValue);
  const parts = {
    duration: length(planned.seconds, done.seconds),
    distance: length(planned.meters, done.meters),
    load: length(planned.load, done.load),
    intervals: intervals
      ? {
          secondsWithData: intervals.secondsWithData,
          secondsInTarget: intervals.secondsInTarget,
          share:
            intervals.secondsWithData > 0
              ? intervals.secondsInTarget / intervals.secondsWithData
              : null,
          score:
            intervals.secondsWithData > 0
              ? intervals.secondsInTarget / intervals.secondsWithData
              : null,
          alignedBy: intervals.alignedBy,
          steps: withSteps ? [...intervals.steps] : null,
        }
      : null,
  };
  const scores = [parts.duration, parts.distance, parts.load, parts.intervals].flatMap((entry) =>
    entry && entry.score !== null ? [entry.score] : [],
  );
  const score =
    scores.length === 0
      ? null
      : Math.round((100 * scores.reduce((sum, value) => sum + value, 0)) / scores.length);
  return {
    score,
    rating:
      score === null ? null : score >= 80 ? "on_target" : score >= 50 ? "partly" : "off_target",
    parts,
    pending,
  };
}
