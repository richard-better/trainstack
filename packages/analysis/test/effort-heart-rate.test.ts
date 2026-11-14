import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { emptyProfile } from "@trainstack/zones";

import {
  type AnalysisRecord,
  analyzeActivity,
  samplesOf,
  statisticsOf,
  sustainedMaxHeartRate,
} from "../src/index.ts";

const analysed = (sport: string, records: AnalysisRecord[]) => ({
  statistics: statisticsOf(
    analyzeActivity(
      {
        summary: {
          startTime: new Date("2026-11-01T07:00:00Z"),
          sport,
          subSport: undefined,
          elapsedSeconds: records.at(-1)?.elapsedSeconds ?? 0,
        },
        records,
      },
      emptyProfile(),
    ),
  ),
});

describe("per activity", () => {
  test("the sustained max ignores one record, even one held for 20 seconds", () => {
    const records = Array.from({ length: 120 }, (_, second) => ({
      elapsedSeconds: second,
      heartRate: second === 30 ? 240 : 150,
    }));
    assert.equal(sustainedMaxHeartRate(samplesOf(records, null)), 150);
    const smart = [
      { elapsedSeconds: 0, heartRate: 150 },
      { elapsedSeconds: 10, heartRate: 230 },
      { elapsedSeconds: 30, heartRate: 151 },
      { elapsedSeconds: 50, heartRate: 152 },
    ];
    assert.equal(sustainedMaxHeartRate(samplesOf(smart, null)), 151);
  });

  test("the effort heart rate is the last two thirds of the best 30 minutes", () => {
    const records = Array.from({ length: 3600 }, (_, second) => ({
      elapsedSeconds: second,
      power: second >= 600 && second < 2400 ? 280 : 150,
      heartRate: second >= 1200 && second < 2400 ? 172 : 140,
    }));
    const ride = analysed("cycling", records);
    assert.equal(ride.statistics.best_power_1800s_w, 280);
    assert.equal(ride.statistics.best_power_1800s_heart_rate_bpm, 172);
  });

  test("an effort with too little heart rate has none", () => {
    const records = Array.from({ length: 2400 }, (_, second) => ({
      elapsedSeconds: second,
      power: 250,
      ...(second < 1200 ? { heartRate: 160 } : {}),
    }));
    const ride = analysed("cycling", records);
    assert.equal(ride.statistics.best_power_1800s_heart_rate_bpm, undefined);
  });
});
