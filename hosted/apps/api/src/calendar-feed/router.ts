import { eq, sql } from "drizzle-orm";

import { calendarFeed } from "../db/schema";
import { ENV } from "../env.server";
import { signedIn } from "../procedures";
import { getDb } from "../services";
import { feedAddresses, newFeedId } from "./address";

type FeedRow = typeof calendarFeed.$inferSelect;

async function present(row: FeedRow) {
  const addresses = await feedAddresses(ENV.BETTER_AUTH_SECRET);
  return {
    path: await addresses.pathOf(row.feedId),
    withActivities: row.withActivities,
    createdAt: new Date(row.createdAt * 1000),
  };
}

const ofAthlete = (userId: string) => eq(calendarFeed.userId, userId);

export const calendarFeedRouter = {
  get: signedIn.calendarFeed.get.handler(async ({ context }) => {
    const row = await getDb()
      .select()
      .from(calendarFeed)
      .where(ofAthlete(context.session.user.id))
      .get();
    return { feed: row ? await present(row) : null };
  }),

  newAddress: signedIn.calendarFeed.newAddress.handler(async ({ context, input }) => {
    const fresh = {
      userId: context.session.user.id,
      feedId: newFeedId(),
      withActivities: input.withActivities ?? false,
      createdAt: Math.floor(Date.now() / 1000),
    };
    const [row] = await getDb()
      .insert(calendarFeed)
      .values(fresh)
      .onConflictDoUpdate({
        target: calendarFeed.userId,
        set: {
          feedId: fresh.feedId,
          createdAt: fresh.createdAt,
          withActivities:
            input.withActivities === undefined
              ? sql`${calendarFeed.withActivities}`
              : input.withActivities,
        },
      })
      .returning();
    return present(row!);
  }),

  setActivities: signedIn.calendarFeed.setActivities.handler(async ({ context, input, errors }) => {
    const [row] = await getDb()
      .update(calendarFeed)
      .set({ withActivities: input.withActivities })
      .where(ofAthlete(context.session.user.id))
      .returning();
    if (!row) throw errors.NOT_FOUND();
    return present(row);
  }),

  turnOff: signedIn.calendarFeed.turnOff.handler(async ({ context }) => {
    await getDb().delete(calendarFeed).where(ofAthlete(context.session.user.id));
    return {};
  }),
};
