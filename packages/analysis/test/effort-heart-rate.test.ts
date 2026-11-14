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

  test("the sustained max matches the rule on random records, with gaps, pauses and dropouts", () => {
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const byTheRule = (samples: ReturnType<typeof samplesOf>) => {
      const { held, heartRate } = samples;
      let best = -Infinity;
      for (let first = 0; first < held.count; first++) {
        let lowest = heartRate[held.record[first]!]!;
        for (let last = first + 1; last < held.count && !Number.isNaN(lowest); last++) {
          if (held.start[last] !== held.end[last - 1]) break;
          lowest = Math.min(lowest, heartRate[held.record[last]!]!);
          if (held.end[last]! - held.start[first]! >= 5) {
            if (lowest > best) best = lowest;
            break;
          }
        }
      }
      return Number.isFinite(best) ? Math.round(best) : null;
    };
    for (let round = 0; round < 200; round++) {
      let elapsed = 0;
      const records = Array.from({ length: 5 + Math.floor(random() * 80) }, () => {
        elapsed += random() < 0.1 ? 31 + random() * 20 : random() * 4;
        return {
          elapsedSeconds: elapsed,
          ...(random() < 0.1 ? {} : { heartRate: 100 + Math.floor(random() * 90) }),
        };
      });
      const samples = samplesOf(records, null);
      assert.equal(sustainedMaxHeartRate(samples), byTheRule(samples), JSON.stringify(records));
    }
  });

  test("the sustained max stays linear when records crowd into a few seconds", () => {
    const records = Array.from({ length: 200_000 }, (_, index) => ({
      elapsedSeconds: index / 20_000,
      heartRate: 120 + (index % 50),
    }));
    const started = performance.now();
    assert.equal(sustainedMaxHeartRate(samplesOf(records, null)), 120);
    assert.ok(performance.now() - started < 1000);
  });
});
