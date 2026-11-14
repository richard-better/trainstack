import { oc } from "@orpc/contract";
import { z } from "zod";

export const CALENDAR_FEED_WEEKS_BACK = 4;
export const CALENDAR_FEED_WEEKS_AHEAD = 26;

export const calendarFeedSchema = z.object({
  path: z
    .string()
    .describe(
      "Where calendar apps fetch the feed, relative to the API's address. It holds the feed's secret, which is the only credential for reading it, so treat it like a password",
    ),
  withActivities: z
    .boolean()
    .describe(
      "Whether completed activities are in the feed as timed events, besides the planned workouts, notes and rest days",
    ),
  createdAt: z.date().describe("When this address was made"),
});

const unauthorized = { UNAUTHORIZED: {} };

export const calendarFeedContract = {
  get: oc
    .route({ method: "GET", path: "/calendar-feed" })
    .errors(unauthorized)
    .input(z.object({}))
    .output(
      z.object({
        feed: calendarFeedSchema.nullable().describe("The athlete's feed, or null while it is off"),
      }),
    ),
  newAddress: oc
    .route({
      method: "POST",
      path: "/calendar-feed/address",
      description: `Turn the feed on, or give it a new address. An address it had before stops working at once. The feed is iCalendar of the athlete's training from ${CALENDAR_FEED_WEEKS_BACK} weeks back to ${CALENDAR_FEED_WEEKS_AHEAD} weeks ahead`,
    })
    .errors(unauthorized)
    .input(
      z.object({
        withActivities: z
          .boolean()
          .optional()
          .describe("For a feed that is off; a feed that is on keeps its choice unless given"),
      }),
    )
    .output(calendarFeedSchema),
  setActivities: oc
    .route({ method: "POST", path: "/calendar-feed/activities" })
    .errors({ ...unauthorized, NOT_FOUND: { message: "The feed is off" } })
    .input(z.object({ withActivities: z.boolean() }))
    .output(calendarFeedSchema),
  turnOff: oc
    .route({
      method: "DELETE",
      path: "/calendar-feed",
      description: "Turn the feed off. Its address stops working at once",
    })
    .errors(unauthorized)
    .input(z.object({}))
    .output(z.object({})),
};

export type CalendarFeed = z.infer<typeof calendarFeedSchema>;
