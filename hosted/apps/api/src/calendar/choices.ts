import { and, eq, sql } from "drizzle-orm";

import type { Database } from "../db";
import { activity, plannedPairingChoice, plannedWorkout } from "../db/schema";
import { nextRevision } from "./planned";

export const activityOfDay = (db: Database, userId: string, id: string) =>
  db.get<{ id: string; day: string | null }>(sql`
    SELECT a.id AS id, coalesce((
      SELECT p.local_day FROM ${activity} p
      WHERE p.user_id = a.user_id AND p.workout_id = a.workout_id AND p.is_primary = 1
      LIMIT 1
    ), a.local_day) AS day
    FROM ${activity} a WHERE a.user_id = ${userId} AND a.id = ${id}
  `);

export async function choosePairing(
  db: Database,
  userId: string,
  choice: { id: string; activityId: string; paired: boolean; updatedAt: Date },
) {
  await db.batch([
    writeChoice(db, userId, choice),
    db.run(sql`
      UPDATE ${plannedWorkout} SET revision = ${nextRevision(userId)}
      WHERE user_id = ${userId} AND deleted_at IS NULL AND day = (
        SELECT p.day FROM ${plannedWorkout} p
        WHERE p.user_id = ${userId} AND p.id = ${choice.id} AND p.deleted_at IS NULL
      )
    `),
  ]);
}

function writeChoice(
  db: Database,
  userId: string,
  choice: { id: string; activityId: string; paired: boolean; updatedAt: Date },
) {
  const paired = choice.paired ? 1 : 0;
  const at = choice.updatedAt.getTime();
  return db.run(sql`
    INSERT INTO ${plannedPairingChoice} (user_id, planned_id, activity_id, paired, updated_at)
    SELECT ${userId}, ${choice.id}, ${choice.activityId}, ${paired}, ${at}
    WHERE EXISTS (
      SELECT 1 FROM ${plannedWorkout}
      WHERE user_id = ${userId} AND id = ${choice.id} AND deleted_at IS NULL
    )
    ON CONFLICT (user_id, planned_id, activity_id) DO UPDATE
    SET paired = excluded.paired, updated_at = excluded.updated_at
    WHERE (excluded.updated_at, excluded.paired) > (${plannedPairingChoice}.updated_at, ${plannedPairingChoice}.paired)
  `);
}

export const forgetChoices = (db: Database, userId: string, plannedId: string) =>
  db
    .delete(plannedPairingChoice)
    .where(
      and(eq(plannedPairingChoice.userId, userId), eq(plannedPairingChoice.plannedId, plannedId)),
    );
