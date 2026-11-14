import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { type DatedChange, profileOn, zonesFor } from "@trainstack/zones";

import { athleteThresholds, fitAthlete, parseFit } from "../src/index.ts";

const changes: DatedChange[] = [
  { day: "2026-01-01", change: { kind: "sport", sport: "running", listed: true } },
  {
    day: "2026-01-01",
    change: { kind: "threshold", sport: null, threshold: "max_heart_rate", value: 190 },
  },
  {
    day: "2026-01-01",
    change: {
      kind: "threshold",
      sport: null,
      threshold: "lactate_threshold_heart_rate",
      value: 170,
    },
  },
  { day: "2026-01-01", change: { kind: "threshold", sport: null, threshold: "ftp", value: 250 } },
  {
    day: "2026-01-01",
    change: { kind: "threshold", sport: "running", threshold: "threshold_pace", value: 250 },
  },
];

const profile = profileOn(changes, "2026-11-14");

test("thresholds for writing come from the athlete's settings for the sport", () => {
  assert.deepEqual(athleteThresholds(profile, "running"), {
    ftp: 250,
    thresholdHeartRate: 170,
    thresholdPace: 4,
  });
  assert.deepEqual(athleteThresholds(profile, "cycling"), {
    ftp: 250,
    thresholdHeartRate: 170,
    thresholdPace: undefined,
  });
});

test("zones for reading are the athlete's zones, with pace turned into speed", () => {
  const athlete = fitAthlete(profile, "running", "your zones on 2026-11-14");
  assert.equal(athlete.maxHeartRate, 190);
  const heartRate = zonesFor(profile, "heart_rate", "running")!;
  assert.deepEqual(
    athlete.zones?.heartRate,
    heartRate.zones.map(({ start, end }) => ({ low: start, high: end })),
  );
  const pace = zonesFor(profile, "pace", "running")!;
  assert.deepEqual(
    athlete.zones?.speed,
    pace.zones.map(({ start, end }) => ({
      low: start === null ? null : 1000 / start,
      high: end === null ? null : 1000 / end,
    })),
  );
  for (const zone of athlete.zones?.speed ?? []) {
    if (zone.low !== null && zone.high !== null) assert.ok(zone.low < zone.high);
  }
  assert.equal(fitAthlete(profile, "cycling", "x").zones?.speed, undefined);
});

test("a Garmin heart rate zone imports as the athlete's own zone", () => {
  const bytes = new Uint8Array(
    readFileSync(
      new URL("../../fit/test/fixtures/workouts/garmin-connect-run-intervals.fit", import.meta.url),
    ),
  );
  const { value, warnings } = parseFit(bytes, {
    athlete: (sport) => fitAthlete(profile, sport, "your zones on 2026-11-14"),
  });
  const zone2 = zonesFor(profile, "heart_rate", "running")!.zones[1]!;
  assert.deepEqual(value.steps[0]?.type === "step" && value.steps[0].target, {
    type: "heartRate",
    unit: "bpm",
    level: { kind: "range", low: zone2.start, high: zone2.end },
  });
  assert.equal(
    warnings[0]?.message,
    `Heart rate zone 2 became ${zone2.start}-${zone2.end} bpm from your zones on 2026-11-14`,
  );
});
