import { ORPCError } from "@orpc/server";
import type { SettingWrite } from "@trainstack/contract";
import { profileOn, thresholds } from "@trainstack/zones";
import { eq } from "drizzle-orm";

import { DEFAULT_TIME_ZONE, dayIn } from "../activities/local-day";
import type { Database } from "../db";
import { thresholdAnswer, thresholdSuggestion } from "../db/schema";
import { signedIn } from "../procedures";
import { getDb } from "../services";
import {
  analysesDueAfterSettings,
  settingsHistoryOf,
  settingWriteStatements,
  timeZoneOf,
} from "../settings/router";
import {
  currentThreshold,
  ownSuggestion,
  sportOf,
  suggestionOf,
  worthSuggesting,
} from "./detection";

async function athleteNow(db: Database, userId: string) {
  const [history, zone] = await Promise.all([
    settingsHistoryOf(db, userId),
    timeZoneOf(db, userId),
  ]);
  const today = dayIn(zone ?? DEFAULT_TIME_ZONE, new Date());
  return { today, history, profile: profileOn(history, today) };
}

async function suggestionById(db: Database, userId: string, id: string) {
  return db.select().from(thresholdSuggestion).where(ownSuggestion(userId, id)).get();
}

export const thresholdsRouter = {
  suggestions: signedIn.thresholds.suggestions.handler(async ({ context }) => {
    const db = getDb();
    const userId = context.session.user.id;
    const [{ profile }, rows] = await Promise.all([
      athleteNow(db, userId),
      db.select().from(thresholdSuggestion).where(eq(thresholdSuggestion.userId, userId)),
    ]);
    const suggestions = rows.flatMap((row) => {
      const current = currentThreshold(profile, row.scope, row.threshold);
      return worthSuggesting(row.threshold, row.value, current, row.confidence)
        ? [suggestionOf(row, current)]
        : [];
    });
    suggestions.sort(
      (a, b) =>
        (a.sport ?? "").localeCompare(b.sport ?? "") || a.threshold.localeCompare(b.threshold),
    );
    return { suggestions };
  }),

  accept: signedIn.thresholds.accept.handler(async ({ context, input, errors }) => {
    const db = getDb();
    const userId = context.session.user.id;
    const [row, { today, history }] = await Promise.all([
      suggestionById(db, userId, input.id),
      athleteNow(db, userId),
    ]);
    if (!row) throw errors.NOT_FOUND();
    const day = input.from === "today" ? today : row.effortDay;
    const sport = sportOf(row.scope);
    const testId = crypto.randomUUID();
    const updatedAt = new Date();
    const writes: SettingWrite[] = [];
    if (sport !== null) {
      const onDay = profileOn(history, day).sports[sport];
      const metric = thresholds[row.threshold].metric;
      if (onDay === undefined) {
        writes.push({ day, change: { kind: "sport", sport, listed: true }, updatedAt });
      }
      if (metric !== "pace" && onDay?.[metric] === undefined) {
        writes.push({ day, change: { kind: "own_zones", sport, metric, own: true }, updatedAt });
      }
    }
    writes.push(
      {
        day,
        change: { kind: "threshold", sport, threshold: row.threshold, value: row.value },
        updatedAt,
      },
      {
        day,
        change: {
          kind: "threshold_test",
          id: testId,
          sport,
          threshold: row.threshold,
          protocol: "detected",
          value: row.value,
          activityId: row.activityId,
        },
        updatedAt,
      },
    );
    const statements = settingWriteStatements(db, userId, writes, (_, reason) => {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: `A detected ${thresholds[row.threshold].name} is not a valid setting: ${reason}`,
      });
    });
    const [first, ...rest] = statements;
    await db.batch([
      first!,
      ...rest,
      analysesDueAfterSettings(db, userId),
      db
        .insert(thresholdAnswer)
        .values({
          userId,
          scope: row.scope,
          threshold: row.threshold,
          fingerprint: row.fingerprint,
          value: row.value,
          answer: "accepted",
          answeredAt: updatedAt,
        })
        .onConflictDoNothing(),
      db.delete(thresholdSuggestion).where(ownSuggestion(userId, row.id)),
    ]);
    return { day, testId };
  }),

  dismiss: signedIn.thresholds.dismiss.handler(async ({ context, input, errors }) => {
    const db = getDb();
    const userId = context.session.user.id;
    const row = await suggestionById(db, userId, input.id);
    if (!row) throw errors.NOT_FOUND();
    await db.batch([
      db
        .insert(thresholdAnswer)
        .values({
          userId,
          scope: row.scope,
          threshold: row.threshold,
          fingerprint: row.fingerprint,
          value: row.value,
          answer: "dismissed",
          answeredAt: new Date(),
        })
        .onConflictDoNothing(),
      db.delete(thresholdSuggestion).where(ownSuggestion(userId, row.id)),
    ]);
    return {};
  }),
};
