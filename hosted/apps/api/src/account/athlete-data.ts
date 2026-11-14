import { getTableName, type Table } from "drizzle-orm";
import type { AnySQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";

import { activityFilePrefix } from "../activities/files";
import * as schema from "../db/schema";

type Schema = typeof schema;

export type TableKey = {
  [K in keyof Schema]: Schema[K] extends SQLiteTable ? K : never;
}[keyof Schema];

type ColumnKey<T extends TableKey> = keyof Schema[T]["_"]["columns"] & string;

export type Exported<T extends TableKey> = {
  about: string;
  owner: (table: Schema[T]) => AnySQLiteColumn;
  withheld?: { columns: ColumnKey<T>[]; why: string };
  readable?: Partial<Record<ColumnKey<T>, (value: unknown) => unknown>>;
};

export type NotExported = { notExported: string };

export type Handling<T extends TableKey> = Exported<T> | NotExported;

const fromUnixSeconds = (value: unknown) =>
  typeof value === "number" ? new Date(value * 1000).toISOString() : value;

const fromUnixMilliseconds = (value: unknown) =>
  typeof value === "number" ? new Date(value).toISOString() : value;

const parsedJson = (value: unknown) =>
  typeof value === "string" && value !== "" ? JSON.parse(value) : null;

export const athleteTables: { [T in TableKey]: Handling<T> } = {
  user: {
    about: "The account: name and email from Sign in with Apple, and when it was made.",
    owner: (table) => table.id,
  },
  account: {
    about:
      "The sign-in identities the account has, such as Sign in with Apple, with the identifier Apple gave.",
    owner: (table) => table.userId,
    withheld: {
      columns: ["accessToken", "refreshToken", "idToken", "password"],
      why: "they are credentials, which would let anyone holding the archive act as the athlete",
    },
  },
  session: {
    about: "The devices and browsers signed in to the account, with their address and browser.",
    owner: (table) => table.userId,
    withheld: { columns: ["token"], why: "it is a credential that signs its holder in" },
  },
  verification: {
    notExported:
      "Better Auth's state for a sign-in under way. It names no account, lasts minutes, and is gone once the sign-in ends.",
  },
  rateLimit: {
    notExported:
      "Request counts per client address and route, kept for a minute to slow down abuse. They name no account.",
  },
  appHandoff: {
    notExported:
      "A two-minute code that hands a browser sign-in to the Ride app. It is used once and is deleted with the account.",
  },
  stravaConnection: {
    about: "The Strava athlete connected to the account, and since when.",
    owner: (table) => table.userId,
    withheld: {
      columns: ["accessToken", "refreshToken"],
      why: "they are Strava's credentials for the athlete's Strava account",
    },
    readable: { expiresAt: fromUnixSeconds },
  },
  stravaLink: {
    notExported:
      "A Strava sign-in under way, which lasts ten minutes and holds only Strava's one-time tokens. It is deleted with the account.",
  },
  stravaBudget: {
    notExported:
      "Counts of recent calls to Strava, kept for fifteen minutes to stay inside Strava's limits. The account's counts are deleted with the account.",
  },
  feedback: {
    about: "Feedback the athlete sent, with the GitHub issue it became.",
    owner: (table) => table.userId,
    readable: { createdAt: fromUnixSeconds },
  },
  activity: {
    about:
      "Every activity: where it came from, its sport, name and start, its file, its summary, and the workout it belongs to. The file itself is under activities/.",
    owner: (table) => table.userId,
    readable: { occurredAt: fromUnixMilliseconds },
  },
  activityStatistic: {
    about: "Numbers that sum up each activity, named <what>_<unit>, such as distance_m.",
    owner: (table) => table.userId,
  },
  activityEvent: {
    about: "Laps, pauses and other events within each activity, in order.",
    owner: (table) => table.userId,
  },
  distinctActivities: {
    about: "Pairs of activities the athlete said are not the same workout.",
    owner: (table) => table.userId,
  },
  deletedActivity: {
    about:
      "Activities the athlete deleted, so that a device sending them again does not bring them back.",
    owner: (table) => table.userId,
  },
  activitySync: {
    about: "How far each source of activities has synced.",
    owner: (table) => table.userId,
  },
  activityAnalysis: {
    about:
      "How each activity was analysed with the thresholds of its day: when, any error, and which thresholds were missing. The numbers it found are in activity_statistic.",
    owner: (table) => table.userId,
  },
  athleteTimeZone: {
    about: "The time zone the athlete lives in, which sets each activity's day.",
    owner: (table) => table.userId,
  },
  athleteSetting: {
    about:
      "Every athlete setting with its history: weight, thresholds, zones and sports, each from the day it applies.",
    owner: (table) => table.userId,
    readable: { value: parsedJson },
  },
  workout: {
    about: "The athlete's workouts, each a whole workout document in body.",
    owner: (table) => table.userId,
    readable: { body: parsedJson },
  },
  workoutList: {
    about: "The athlete's lists of workouts.",
    owner: (table) => table.userId,
  },
  accountFileSweep: {
    notExported:
      "A note that a deleted account's files still need a last sweep, which the scheduled run finishes. It is written as the account is deleted and goes once the sweep is done.",
  },
  workoutListEntry: {
    about: "Which workouts are in which list, and in what order.",
    owner: (table) => table.userId,
  },
};

export type AthleteFiles = {
  bucket: "ACTIVITY_FILES";
  prefix: (userId: string) => string;
  archiveFolder: string;
  about: string;
};

export const athleteFiles: AthleteFiles[] = [
  {
    bucket: "ACTIVITY_FILES",
    prefix: activityFilePrefix,
    archiveFolder: "activities",
    about:
      "The original file of every activity, as it was uploaded, named by its activity id, which is the SHA-256 of the file.",
  },
];

export type AnyExported = {
  about: string;
  owner: (table: never) => AnySQLiteColumn;
  withheld?: { columns: string[]; why: string };
  readable?: Partial<Record<string, (value: unknown) => unknown>>;
};

export const isExported = (handling: AnyExported | NotExported): handling is AnyExported =>
  !("notExported" in handling);

export const handlingOf = (key: TableKey) => athleteTables[key] as AnyExported | NotExported;

export const tableKeys = Object.keys(athleteTables) as TableKey[];

export const tableOf = (key: TableKey) => schema[key] as Table;

export const sqlNameOf = (key: TableKey) => getTableName(tableOf(key));
