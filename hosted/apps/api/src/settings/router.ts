import type {
  AthleteSettings,
  SettingEntry,
  SettingRemoval,
  SettingWrite,
} from "@trainstack/contract";
import {
  type DatedChange,
  listedSports,
  type MetricZones,
  missingThresholds,
  profileOn,
  type SettingChange,
  usesDefault,
  zoneMetricsFor,
  zonesFor,
  zonesOf,
} from "@trainstack/zones";
import { eq, sql } from "drizzle-orm";

import { isTimeZone } from "../activities/local-day";
import type { Database } from "../db";
import { activityAnalysis, athleteSetting, athleteTimeZone } from "../db/schema";
import { signedIn } from "../procedures";
import { getDb } from "../services";
import { ALLOWED_CLOCK_AHEAD_MS, canonical, keyOf, storedKey, validated } from "./changes";

type SettingRow = typeof athleteSetting.$inferSelect;

const rowsOf = (db: Database, userId: string) =>
  db.select().from(athleteSetting).where(eq(athleteSetting.userId, userId));

const isLive = (row: SettingRow) => !row.removed;

export const settingsHistoryOf = async (db: Database, userId: string) =>
  datedChanges(await rowsOf(db, userId));

export async function timeZoneOf(db: Database, userId: string) {
  const row = await db
    .select({ timeZone: athleteTimeZone.timeZone })
    .from(athleteTimeZone)
    .where(eq(athleteTimeZone.userId, userId))
    .get();
  return row?.timeZone ?? null;
}

const changeOf = (row: SettingRow) => JSON.parse(row.value) as SettingChange;

const datedChanges = (rows: SettingRow[]): DatedChange[] =>
  rows.filter(isLive).map((row) => ({ day: row.day, change: changeOf(row) }));

function changes(rows: SettingRow[], after = 0) {
  const changed = rows
    .filter((row) => row.revision > after)
    .toSorted(
      (a, b) =>
        a.day.localeCompare(b.day) ||
        a.kind.localeCompare(b.kind) ||
        a.scope.localeCompare(b.scope) ||
        a.name.localeCompare(b.name),
    );
  const entries: SettingEntry[] = changed
    .filter(isLive)
    .map((row) => ({ day: row.day, change: changeOf(row), updatedAt: row.updatedAt }));
  const removed: SettingRemoval[] = changed
    .filter((row) => row.removed)
    .map((row) => ({ day: row.day, key: keyOf(row), updatedAt: row.updatedAt }));
  return { entries, removed };
}

function history(rows: SettingRow[], since?: string) {
  const after = since === undefined ? 0 : Number(since);
  const cursor = Math.max(after, ...rows.map((row) => row.revision));
  return { ...changes(rows, after), cursor: String(cursor) };
}

const metricOutput = (settings: MetricZones) => ({
  model: settings.model,
  customLimits: settings.customLimits,
  thresholds: settings.thresholds,
  zones: zonesOf(settings),
  missingThresholds: missingThresholds(settings),
});

export function settingWriteStatements(
  db: Database,
  userId: string,
  writes: readonly SettingWrite[],
  invalid: (index: number, reason: string) => never,
) {
  const latestAllowed = Date.now() + ALLOWED_CLOCK_AHEAD_MS;
  return writes.map((write, index) => {
    if (write.updatedAt.getTime() > latestAllowed) {
      invalid(index, "updatedAt is later than the server's clock");
    }
    let key;
    let value = "";
    if ("remove" in write) {
      key = storedKey(write.key);
    } else {
      const change = validated(write.change);
      if (typeof change === "string") {
        invalid(index, change);
      }
      key = storedKey(change);
      value = JSON.stringify(canonical(change));
    }
    return db
      .insert(athleteSetting)
      .values({
        userId,
        ...key,
        day: write.day,
        value,
        removed: "remove" in write,
        updatedAt: write.updatedAt,
        revision: sql`(SELECT coalesce(max(revision), 0) + 1 FROM ${athleteSetting} WHERE user_id = ${userId})`,
      })
      .onConflictDoUpdate({
        target: [
          athleteSetting.userId,
          athleteSetting.kind,
          athleteSetting.scope,
          athleteSetting.name,
          athleteSetting.day,
        ],
        set: {
          value: sql`excluded.value`,
          removed: sql`excluded.removed`,
          updatedAt: sql`excluded.updated_at`,
          revision: sql`excluded.revision`,
        },
        setWhere: sql`(excluded.updated_at, excluded.removed, excluded.value) > (${athleteSetting.updatedAt}, ${athleteSetting.removed}, ${athleteSetting.value})`,
      });
  });
}

export const analysesDueAfterSettings = (db: Database, userId: string) =>
  db.run(sql`
    UPDATE ${activityAnalysis} SET due = 1, generation = generation + 1
    WHERE user_id = ${userId}
  `);

export const settingsRouter = {
  get: signedIn.settings.get.handler(async ({ context, input }) => {
    const db = getDb();
    const userId = context.session.user.id;
    const [rows, zone] = await Promise.all([rowsOf(db, userId), timeZoneOf(db, userId)]);
    const day = input.day ?? null;
    const profile = profileOn(datedChanges(rows), day);
    const settings: AthleteSettings = {
      day,
      timeZone: zone,
      weightKg: profile.weightKg,
      defaults: {},
      sports: {},
    };
    for (const [metric, zones] of Object.entries(profile.defaults)) {
      settings.defaults[metric as keyof typeof profile.defaults] = metricOutput(zones);
    }
    for (const sport of listedSports(profile)) {
      const metrics: AthleteSettings["sports"][string] = {};
      for (const metric of zoneMetricsFor(profile, sport)) {
        const own = profile.sports[sport]?.[metric];
        const zones = own ?? (metric === "pace" ? undefined : profile.defaults[metric]);
        if (zones) {
          metrics[metric] = {
            ...metricOutput(zones),
            usesDefault: usesDefault(profile, metric, sport),
          };
        }
      }
      settings.sports[sport] = metrics;
    }
    return settings;
  }),

  zones: signedIn.settings.zones.handler(async ({ context, input }) => {
    const rows = await rowsOf(getDb(), context.session.user.id);
    const sport = input.sport ?? null;
    const profile = profileOn(datedChanges(rows), input.day);
    const zones: Record<string, NonNullable<ReturnType<typeof zonesFor>>> = {};
    for (const metric of zoneMetricsFor(profile, sport)) {
      const set = zonesFor(profile, metric, sport);
      if (set) zones[metric] = set;
    }
    return { day: input.day, sport, zones };
  }),

  setTimeZone: signedIn.settings.setTimeZone.handler(async ({ context, input, errors }) => {
    if (!isTimeZone(input.timeZone)) throw errors.INVALID_TIME_ZONE();
    await getDb()
      .insert(athleteTimeZone)
      .values({ userId: context.session.user.id, timeZone: input.timeZone })
      .onConflictDoUpdate({ target: athleteTimeZone.userId, set: { timeZone: input.timeZone } });
    return { timeZone: input.timeZone };
  }),

  history: signedIn.settings.history.handler(async ({ context, input }) => {
    const rows = await rowsOf(getDb(), context.session.user.id);
    return history(rows, input.since);
  }),

  write: signedIn.settings.write.handler(async ({ context, input, errors }) => {
    const db = getDb();
    const userId = context.session.user.id;
    const statements = settingWriteStatements(db, userId, input.writes, (index, reason) => {
      throw errors.INVALID_SETTING({ data: { index, reason } });
    });
    const [first, ...rest] = statements;
    await db.batch([first!, ...rest, analysesDueAfterSettings(db, userId)]);
    const rows = await rowsOf(db, userId);
    const written = new Set(
      input.writes.map((write) => {
        const key = storedKey("remove" in write ? write.key : write.change);
        return JSON.stringify([key.kind, key.scope, key.name, write.day]);
      }),
    );
    const affected = rows.filter((row) =>
      written.has(JSON.stringify([row.kind, row.scope, row.name, row.day])),
    );
    return changes(affected);
  }),
};
