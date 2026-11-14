import type { FileRoutesById } from "../routeTree.gen.ts";

export type ShowcaseWorld = "athlete" | "rough-day" | "newcomer";

export type ShowcaseNetwork = "answers" | "waits" | "fails";

export interface ShowcasePlaces {
  readonly outdoorRide: string;
  readonly indoorRide: string;
  readonly tempoRun: string;
  readonly gpsGapRun: string;
  readonly duplicateRide: string;
  readonly strength: string;
  readonly strengthSession: string;
  readonly bouldering: string;
  readonly boulderingSession: string;
  readonly workout: string;
  readonly list: string;
  readonly plannedDone: string;
  readonly plannedMissed: string;
  readonly plannedSkipped: string;
  readonly plannedAhead: string;
}

export type ShowcaseStep = { readonly click: string } | { readonly upload: readonly string[] };

export interface ShowcaseEntry {
  readonly id: string;
  readonly screen: string;
  readonly title: string;
  readonly route: keyof FileRoutesById;
  readonly world: ShowcaseWorld;
  readonly network?: ShowcaseNetwork;
  readonly path: (places: ShowcasePlaces) => string;
  readonly steps?: readonly ShowcaseStep[];
}

export const showcaseEntries: readonly ShowcaseEntry[] = [
  {
    id: "today",
    screen: "Today",
    title: "A training day: readiness next to the plan, and the check-in",
    route: "/",
    world: "athlete",
    path: () => "/",
  },
  {
    id: "today-rough-day",
    screen: "Today",
    title: "A poor check-in: readiness says ease off",
    route: "/",
    world: "rough-day",
    path: () => "/",
  },
  {
    id: "today-newcomer",
    screen: "Today",
    title: "A new account with nothing in it",
    route: "/",
    world: "newcomer",
    path: () => "/",
  },
  {
    id: "today-loading",
    screen: "Today",
    title: "Waiting for the server",
    route: "/",
    world: "athlete",
    network: "waits",
    path: () => "/",
  },
  {
    id: "today-offline",
    screen: "Today",
    title: "The server cannot be reached",
    route: "/",
    world: "athlete",
    network: "fails",
    path: () => "/",
  },
  {
    id: "activities",
    screen: "Activities",
    title: "Thirty weeks of rides, runs, lifting and climbing",
    route: "/activities/",
    world: "athlete",
    path: () => "/activities",
  },
  {
    id: "activities-upload",
    screen: "Activities",
    title: "Three files uploaded: one new, one already there, one not an activity",
    route: "/activities/",
    world: "athlete",
    path: () => "/activities",
    steps: [{ upload: ["morning-ride.fit", "SampleRide.fit", "notes.txt"] }],
  },
  {
    id: "activities-newcomer",
    screen: "Activities",
    title: "No activities yet",
    route: "/activities/",
    world: "newcomer",
    path: () => "/activities",
  },
  {
    id: "activities-loading",
    screen: "Activities",
    title: "Waiting for the server",
    route: "/activities/",
    world: "athlete",
    network: "waits",
    path: () => "/activities",
  },
  {
    id: "activities-offline",
    screen: "Activities",
    title: "The server cannot be reached",
    route: "/activities/",
    world: "athlete",
    network: "fails",
    path: () => "/activities",
  },
  {
    id: "activity-outdoor-ride",
    screen: "Activity",
    title: "An outdoor ride with a café stop: map, power, heart rate and zones",
    route: "/activities/$id",
    world: "athlete",
    path: ({ outdoorRide }) => `/activities/${outdoorRide}`,
  },
  {
    id: "activity-indoor-ride",
    screen: "Activity",
    title: "Indoor intervals scored against the planned workout",
    route: "/activities/$id",
    world: "athlete",
    path: ({ indoorRide }) => `/activities/${indoorRide}`,
  },
  {
    id: "activity-duplicate",
    screen: "Activity",
    title: "A ride recorded twice, from the bike computer and from Strava",
    route: "/activities/$id",
    world: "athlete",
    path: ({ duplicateRide }) => `/activities/${duplicateRide}`,
  },
  {
    id: "activity-tempo-run",
    screen: "Activity",
    title: "A tempo run on Margaret Island",
    route: "/activities/$id",
    world: "athlete",
    path: ({ tempoRun }) => `/activities/${tempoRun}`,
  },
  {
    id: "activity-gps-gap",
    screen: "Activity",
    title: "A run that lost GPS for two minutes",
    route: "/activities/$id",
    world: "athlete",
    path: ({ gpsGapRun }) => `/activities/${gpsGapRun}`,
  },
  {
    id: "activity-strength",
    screen: "Activity",
    title: "A logged strength session",
    route: "/activities/$id",
    world: "athlete",
    path: ({ strength }) => `/activities/${strength}`,
  },
  {
    id: "activity-bouldering",
    screen: "Activity",
    title: "A logged bouldering session",
    route: "/activities/$id",
    world: "athlete",
    path: ({ bouldering }) => `/activities/${bouldering}`,
  },
  {
    id: "activity-offline",
    screen: "Activity",
    title: "The server cannot be reached",
    route: "/activities/$id",
    world: "athlete",
    network: "fails",
    path: ({ outdoorRide }) => `/activities/${outdoorRide}`,
  },
  {
    id: "training",
    screen: "Training",
    title: "Fitness, fatigue and form over six months, with bests",
    route: "/training",
    world: "athlete",
    path: () => "/training",
  },
  {
    id: "training-year",
    screen: "Training",
    title: "A year of load and all-time bests",
    route: "/training",
    world: "athlete",
    path: () => "/training?range=1y&period=all",
  },
  {
    id: "training-newcomer",
    screen: "Training",
    title: "No training yet",
    route: "/training",
    world: "newcomer",
    path: () => "/training",
  },
  {
    id: "calendar-month",
    screen: "Calendar",
    title: "This month: done, missed, skipped and planned",
    route: "/calendar/",
    world: "athlete",
    path: () => "/calendar?view=month",
  },
  {
    id: "calendar-week",
    screen: "Calendar",
    title: "This week",
    route: "/calendar/",
    world: "athlete",
    path: () => "/calendar?view=week",
  },
  {
    id: "calendar-newcomer",
    screen: "Calendar",
    title: "Nothing planned yet",
    route: "/calendar/",
    world: "newcomer",
    path: () => "/calendar?view=month",
  },
  {
    id: "planned-done",
    screen: "Planned workout",
    title: "Done, with how well the ride matched the plan",
    route: "/calendar/planned/$id/",
    world: "athlete",
    path: ({ plannedDone }) => `/calendar/planned/${plannedDone}`,
  },
  {
    id: "planned-missed",
    screen: "Planned workout",
    title: "Planned, with no activity to match",
    route: "/calendar/planned/$id/",
    world: "athlete",
    path: ({ plannedMissed }) => `/calendar/planned/${plannedMissed}`,
  },
  {
    id: "planned-skipped",
    screen: "Planned workout",
    title: "Skipped, with the reason",
    route: "/calendar/planned/$id/",
    world: "athlete",
    path: ({ plannedSkipped }) => `/calendar/planned/${plannedSkipped}`,
  },
  {
    id: "planned-ahead",
    screen: "Planned workout",
    title: "Coming up later this week",
    route: "/calendar/planned/$id/",
    world: "athlete",
    path: ({ plannedAhead }) => `/calendar/planned/${plannedAhead}`,
  },
  {
    id: "planned-edit",
    screen: "Planned workout",
    title: "Changing a planned workout for this day only",
    route: "/calendar/planned/$id/edit",
    world: "athlete",
    path: ({ plannedAhead }) => `/calendar/planned/${plannedAhead}/edit`,
  },
  {
    id: "workouts",
    screen: "Workouts",
    title: "The library: own workouts and lists",
    route: "/workouts/",
    world: "athlete",
    path: () => "/workouts",
  },
  {
    id: "workouts-builtin",
    screen: "Workouts",
    title: "Built-in workouts",
    route: "/workouts/",
    world: "athlete",
    path: () => "/workouts?in=builtin",
  },
  {
    id: "workouts-newcomer",
    screen: "Workouts",
    title: "An empty library",
    route: "/workouts/",
    world: "newcomer",
    path: () => "/workouts",
  },
  {
    id: "workout",
    screen: "Workout",
    title: "An own workout",
    route: "/workouts/$id/",
    world: "athlete",
    path: ({ workout }) => `/workouts/${workout}`,
  },
  {
    id: "workout-builtin",
    screen: "Workout",
    title: "A built-in workout",
    route: "/workouts/builtin/$id",
    world: "athlete",
    path: () => "/workouts/builtin/vo2-max-booster",
  },
  {
    id: "workout-list",
    screen: "Workout",
    title: "A list of workouts",
    route: "/workouts/lists/$listId",
    world: "athlete",
    path: ({ list }) => `/workouts/lists/${list}`,
  },
  {
    id: "workout-edit",
    screen: "Workout editor",
    title: "Editing an own workout",
    route: "/workouts/$id/edit",
    world: "athlete",
    path: ({ workout }) => `/workouts/${workout}/edit`,
  },
  {
    id: "workout-new",
    screen: "Workout editor",
    title: "A new run",
    route: "/workouts/new",
    world: "athlete",
    path: () => "/workouts/new?sport=running",
  },
  {
    id: "check-in",
    screen: "Check-in",
    title: "Today's check-in, not filled in yet, with eight weeks of history",
    route: "/check-in",
    world: "athlete",
    path: () => "/check-in",
  },
  {
    id: "check-in-rough-day",
    screen: "Check-in",
    title: "Today's poor check-in, three months of history",
    route: "/check-in",
    world: "rough-day",
    path: () => "/check-in?range=3m",
  },
  {
    id: "check-in-newcomer",
    screen: "Check-in",
    title: "The first check-in",
    route: "/check-in",
    world: "newcomer",
    path: () => "/check-in",
  },
  {
    id: "log-strength",
    screen: "Strength log",
    title: "Logging a new strength session",
    route: "/log/strength",
    world: "athlete",
    path: () => "/log/strength",
  },
  {
    id: "log-strength-session",
    screen: "Strength log",
    title: "A logged session with its progress",
    route: "/log/strength",
    world: "athlete",
    path: ({ strengthSession }) => `/log/strength?id=${strengthSession}`,
  },
  {
    id: "log-bouldering",
    screen: "Bouldering log",
    title: "Logging a new bouldering session",
    route: "/log/bouldering",
    world: "athlete",
    path: () => "/log/bouldering",
  },
  {
    id: "log-bouldering-session",
    screen: "Bouldering log",
    title: "A logged session with its grade pyramid",
    route: "/log/bouldering",
    world: "athlete",
    path: ({ boulderingSession }) => `/log/bouldering?id=${boulderingSession}`,
  },
  {
    id: "settings",
    screen: "Settings",
    title: "A suggested max heart rate, zones, the calendar feed and export",
    route: "/settings",
    world: "athlete",
    path: () => "/settings",
  },
  {
    id: "settings-power-zones",
    screen: "Settings",
    title: "Power zones for cycling",
    route: "/settings",
    world: "athlete",
    path: () => "/settings?sport=cycling&metric=power",
  },
  {
    id: "settings-delete",
    screen: "Settings",
    title: "Deleting the account",
    route: "/settings",
    world: "athlete",
    path: () => "/settings?delete=true",
  },
  {
    id: "settings-newcomer",
    screen: "Settings",
    title: "A new account's settings",
    route: "/settings",
    world: "newcomer",
    path: () => "/settings",
  },
  {
    id: "log-bouldering-colours",
    screen: "Bouldering log",
    title: "Choosing a circuit colour",
    route: "/log/bouldering",
    world: "athlete",
    path: () => "/log/bouldering",
    steps: [{ click: "Colours" }, { click: "Use these colours" }],
  },
  {
    id: "missing-page",
    screen: "Page not found",
    title: "An unknown address",
    route: "__root__",
    world: "athlete",
    path: () => "/no-such-page",
  },
  {
    id: "settings-threshold-edit",
    screen: "Settings",
    title: "Changing a threshold from a date",
    route: "/settings",
    world: "athlete",
    path: () => "/settings",
    steps: [{ click: "Change" }],
  },
  {
    id: "planned-move",
    screen: "Planned workout",
    title: "Moving a workout to another date",
    route: "/calendar/planned/$id/",
    world: "athlete",
    path: ({ plannedAhead }) => `/calendar/planned/${plannedAhead}`,
    steps: [{ click: "Move to another day" }],
  },
];

export const SHOWCASE_PARAMETER = "showcase";

export function showcaseEntry(id: string): ShowcaseEntry | undefined {
  return showcaseEntries.find((entry) => entry.id === id);
}

export const SHOWCASE_WIDTHS = { phone: 390, desktop: 1280 } as const;

export type ShowcaseWidth = keyof typeof SHOWCASE_WIDTHS;

export function framePath(entry: ShowcaseEntry, path: string): string {
  const url = new URL(path, "http://showcase.invalid");
  url.searchParams.set(SHOWCASE_PARAMETER, entry.id);
  return `${url.pathname}${url.search}`;
}
