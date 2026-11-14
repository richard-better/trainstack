import { inArray, lte } from "drizzle-orm";

import type { Database } from "../db";
import { stravaBudget } from "../db/schema";
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
