import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { decodeFit } from "@trainstack/fit";
import { type DatedChange, profileOn } from "@trainstack/zones";

import { sampleRide, trace, traceNames } from "../../fit/test/goldens.ts";
import {
  type AnalysisRecord,
  analyzeActivity,
  intensity,
  normalizedPower,
  perSecond,
  powerCurve,
  samplesOf,
  type SamplesOptions,
  stressScore,
  timerPauses,
  timeInZones,
  trainingLoad,
  workKilojoules,
} from "../src/index.ts";
import { reference, type ReferenceResults, syntheticRecords, zones } from "./ride-reference.ts";
import { restartedWithoutARecord, smartRecordedRide } from "./smart-recorded-ride.ts";

const { ftp, maxHeartRate, thresholdPace } = reference.thresholds;

function computed(
  records: readonly AnalysisRecord[],
  duration: number,
  options: SamplesOptions = {},
): ReferenceResults {
  const samples = samplesOf(records, "cycling", options);
  const powerPerSecond = perSecond(samples, samples.power);
  const normalized = normalizedPower(powerPerSecond);
  const intensityFactor = intensity(normalized, ftp);
  const seconds = (set: Parameters<typeof timeInZones>[1], paceDistance?: number) =>
    timeInZones(samples, set, paceDistance).map((share) => share.seconds);
  const results: ReferenceResults = {
    duration,
    powerCurve: powerCurve(powerPerSecond).map(({ durationSeconds, watts }) => ({
      duration: durationSeconds,
      power: watts,
    })),
    timeInZones: {
      power: seconds(zones("coggan_6", { ftp })),
      heartRate: seconds(zones("percent_of_max", { max_heart_rate: maxHeartRate })),
      pace: seconds(zones("friel_running_pace", { threshold_pace: thresholdPace }), 1000),
    },
  };
  const optional = {
    normalizedPower: normalized,
    intensityFactor,
    trainingStressScore: stressScore(duration, intensityFactor),
    workKilojoules: workKilojoules(samples),
  };
  for (const [key, value] of Object.entries(optional)) {
    if (value !== null) Object.assign(results, { [key]: value });
  }
  return results;
}

const goldens: Record<string, Uint8Array> = {
  "SampleRide.fit": sampleRide(),
  ...Object.fromEntries(traceNames.map((name) => [`${name}.fit`, trace(name)])),
  "smart-recorded-ride.fit": smartRecordedRide(),
  "restarted-without-a-record.fit": restartedWithoutARecord({ recordWhileStopped: false }),
  "restarted-with-a-record-while-stopped.fit": restartedWithoutARecord({
    recordWhileStopped: true,
  }),
};

describe("agrees with Ride's Swift analysis", () => {
  for (const ride of reference.rides) {
    test(`on the golden ride ${ride.file}`, () => {
      const { summary, records, events } = decodeFit(goldens[ride.file]!);
      assert.equal(records.length, ride.samples);
      const pauses = timerPauses(events, summary.startTime);
      assert.deepEqual(computed(records, summary.elapsedSeconds, { pauses }), ride.results);
    });
  }

  for (const { name, seed, count, steps, results } of reference.synthetic) {
    const records = syntheticRecords(seed, count, steps);
    const duration = records.at(-1)!.elapsedSeconds;
    test(`on a synthetic ride, ${name}`, () => {
      assert.deepEqual(computed(records, duration), results);
    });
  }

  test("on fitness, fatigue and form per day", () => {
    const start = Date.UTC(2026, 0, 1);
    const day = (offset: number) =>
      new Date(start + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const stress = new Map(
      Object.entries(reference.trainingLoad.stress).map(([offset, value]) => [
        day(Number(offset)),
        value,
      ]),
    );
    const load = trainingLoad(
      stress,
      day(reference.trainingLoad.from),
      day(reference.trainingLoad.through),
    );
    assert.deepEqual(
      load,
      reference.trainingLoad.days.map(({ day: offset, ...values }) => ({
        day: day(offset),
        ...values,
      })),
    );
  });
});

test("analyzes the sample ride from its file and dated settings as Ride does", () => {
  const decoded = decodeFit(sampleRide());
  const history: DatedChange[] = [
    { day: "2026-01-01", change: { kind: "threshold", sport: null, threshold: "ftp", value: ftp } },
    {
      day: "2026-01-01",
      change: { kind: "threshold", sport: null, threshold: "max_heart_rate", value: maxHeartRate },
    },
    { day: "2026-12-01", change: { kind: "threshold", sport: null, threshold: "ftp", value: 300 } },
  ];
  const analysis = analyzeActivity(decoded, profileOn(history, "2026-10-06"));
  const [ride] = reference.rides;
  assert.equal(analysis.sport, "cycling");
  assert.equal(analysis.normalizedPowerWatts, ride!.results.normalizedPower);
  assert.equal(analysis.powerStressScore, ride!.results.trainingStressScore);
  assert.deepEqual(analysis.load, {
    stressScore: ride!.results.trainingStressScore,
    source: "power",
  });
  assert.deepEqual(
    analysis.timeInZones.power?.map((share) => share.seconds),
    ride!.results.timeInZones.power,
  );
  assert.deepEqual(
    analysis.timeInZones.heart_rate?.map((share) => share.seconds),
    ride!.results.timeInZones.heartRate,
  );
});
