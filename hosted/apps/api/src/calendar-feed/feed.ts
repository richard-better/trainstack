import { CALENDAR_FEED_WEEKS_AHEAD, CALENDAR_FEED_WEEKS_BACK } from "@trainstack/contract";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

import { DEFAULT_TIME_ZONE, dayIn } from "../activities/local-day";
import { daysFrom, loadDays } from "../calendar/range";
import { plannedOf } from "../calendar/planned";
import type { Database } from "../db";
import { calendarFeed } from "../db/schema";
import { timeZoneOf } from "../settings/router";
import { toBase64Url } from "../strava/crypto";
import { feedAddresses } from "./address";
import { activityEvent, plannedEvent } from "./events";
import { calendar, type Component, text } from "./ics";

export const MAX_FEED_EVENTS = 1500;
const REFRESH = "PT1H";

export type CalendarFeedDeps = {
  env: { BETTER_AUTH_SECRET: string; WEB_APP_ORIGIN: string };
  database: () => Database;
};

const shifted = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export async function feedOf(
  db: Database,
  userId: string,
  { withActivities, webOrigin, now }: { withActivities: boolean; webOrigin: string; now: Date },
) {
  const zone = (await timeZoneOf(db, userId)) ?? DEFAULT_TIME_ZONE;
  const today = dayIn(zone, now);
  const days = daysFrom(
    shifted(today, -7 * CALENDAR_FEED_WEEKS_BACK),
    shifted(today, 7 * CALENDAR_FEED_WEEKS_AHEAD),
  );
  const loaded = await loadDays(db, userId, days);
  const events: Component[] = [];
  for (const day of days) {
    const { planned, activities, presented } = loaded.get(day)!;
    for (const row of planned) {
      const shown = plannedOf(row, today, presented.get(row.id));
      const paired = activities.find(({ id }) => id === shown.pairing?.activityId);
      events.push(plannedEvent(shown, paired, { webOrigin }));
    }
    if (withActivities) {
      for (const done of activities) events.push(activityEvent(done, day, { webOrigin }));
    }
  }
  const what = withActivities
    ? "planned workouts, notes and rest days, and activities"
    : "planned workouts, notes and rest days";
  return calendar(
    [
      { name: "VERSION", value: "2.0" },
      { name: "PRODID", value: "-//Trainstack//Training calendar//EN" },
      { name: "CALSCALE", value: "GREGORIAN" },
      { name: "NAME", value: "Trainstack" },
      { name: "X-WR-CALNAME", value: "Trainstack" },
      { name: "DESCRIPTION", value: text(`Your training in Trainstack: ${what}`) },
      { name: "X-WR-CALDESC", value: text(`Your training in Trainstack: ${what}`) },
      { name: "X-WR-TIMEZONE", value: text(zone) },
      { name: "REFRESH-INTERVAL", parameters: "VALUE=DURATION", value: REFRESH },
      { name: "X-PUBLISHED-TTL", value: REFRESH },
    ],
    events.slice(0, MAX_FEED_EVENTS),
  );
}

const privateHeaders = {
  "Cache-Control": "private, no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex",
};

const notFound = () =>
  new Response("Not found\n", {
    status: 404,
    headers: {
      ...privateHeaders,
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });

async function entityTagOf(body: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return `"${toBase64Url(digest)}"`;
}

const matches = (ifNoneMatch: string | undefined, entityTag: string) =>
  ifNoneMatch !== undefined &&
  ifNoneMatch
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//, ""))
    .some((tag) => tag === "*" || tag === entityTag);

export function calendarFeedRoutes(deps: CalendarFeedDeps) {
  const app = new Hono();

  app.get("/:file", async (c) => {
    const addresses = await feedAddresses(deps.env.BETTER_AUTH_SECRET);
    const feedId = await addresses.feedIdOf(c.req.param("file"));
    if (!feedId) return notFound();
    const db = deps.database();
    const feed = await db
      .select({ userId: calendarFeed.userId, withActivities: calendarFeed.withActivities })
      .from(calendarFeed)
      .where(eq(calendarFeed.feedId, feedId))
      .get();
    if (!feed) return notFound();
    const body = await feedOf(db, feed.userId, {
      withActivities: feed.withActivities,
      webOrigin: deps.env.WEB_APP_ORIGIN,
      now: new Date(),
    });
    const entityTag = await entityTagOf(body);
    const headers = { ...privateHeaders, ETag: entityTag };
    if (matches(c.req.header("If-None-Match"), entityTag)) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(body, {
      headers: {
        ...headers,
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="trainstack.ics"',
      },
    });
  });
  app.get("*", () => notFound());

  return app;
}
