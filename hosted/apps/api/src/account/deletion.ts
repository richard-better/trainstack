import { asc, eq, inArray, lte, notExists } from "drizzle-orm";

import type { Database } from "../db";
import { accountFileSweep, stravaBudget, user } from "../db/schema";
import { BUDGET_WINDOW_SECONDS, budgetOf, disconnectStrava } from "../strava";
import { createVault } from "../strava/crypto";
import { athleteFiles } from "./athlete-data";

export type AthleteBuckets = {
  [Files in (typeof athleteFiles)[number] as Files["bucket"]]: R2Bucket;
};

export async function deleteAthleteFiles(buckets: AthleteBuckets, userId: string) {
  for (const files of athleteFiles) {
    const bucket = buckets[files.bucket];
    let cursor: string | undefined;
    do {
      const page = await bucket.list({ prefix: files.prefix(userId), cursor });
      if (page.objects.length > 0) await bucket.delete(page.objects.map((object) => object.key));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
}

export async function disconnectStravaForGood(
  database: Database,
  secret: string,
  userId: string,
  fetcher: typeof fetch = fetch,
) {
  const athleteId = await disconnectStrava(
    { database, vault: await createVault(secret), fetcher },
    userId,
  );
  const budgets = [budgetOf.connectStarts(userId)];
  if (athleteId !== undefined) budgets.push(budgetOf.athlete(athleteId));
  await database.delete(stravaBudget).where(inArray(stravaBudget.key, budgets));
}

export async function forgetSpentStravaBudgets(database: Database) {
  const windowStartOfAnyLiveBudget = Math.floor(Date.now() / 1000) - BUDGET_WINDOW_SECONDS;
  await database
    .delete(stravaBudget)
    .where(lte(stravaBudget.windowStart, windowStartOfAnyLiveBudget));
}

const SWEEPS_PER_RUN = 20;

export async function promiseToSweepFilesAfterDeleting(database: Database, userId: string) {
  await database
    .insert(accountFileSweep)
    .values({ userId, deletedAt: new Date() })
    .onConflictDoNothing();
}

export async function sweepFilesOfDeletedAccount(
  buckets: AthleteBuckets,
  database: Database,
  userId: string,
) {
  await deleteAthleteFiles(buckets, userId);
  await database.delete(accountFileSweep).where(eq(accountFileSweep.userId, userId));
}

export async function sweepFilesOfDeletedAccounts(buckets: AthleteBuckets, database: Database) {
  const due = await database
    .select({ userId: accountFileSweep.userId })
    .from(accountFileSweep)
    .where(
      notExists(
        database.select({ id: user.id }).from(user).where(eq(user.id, accountFileSweep.userId)),
      ),
    )
    .orderBy(asc(accountFileSweep.deletedAt))
    .limit(SWEEPS_PER_RUN);
  const failures: unknown[] = [];
  for (const { userId } of due) {
    await sweepFilesOfDeletedAccount(buckets, database, userId).catch((error: unknown) =>
      failures.push(error),
    );
  }
  return { failures };
}
