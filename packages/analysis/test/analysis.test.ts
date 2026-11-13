import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { profileOn, type SettingChange } from "@trainstack/zones";

import {
  type AnalysisActivity,
  type AnalysisRecord,
  analysisStatistics,
  analyzeActivity,
  bestEfforts,
  gradeAdjustment,
  grades,
  heartRateStressScore,
  intensity,
  maxActivitySeconds,
  minettiCost,
  normalizedPower,
  perSecond,
  powerCurve,
  samplesOf,
  statisticsOf,
  stressScore,
  timeInZones,
  workKilojoules,
  zoneSport,
} from "../src/index.ts";
import { zones } from "./ride-reference.ts";

const samples = (records: AnalysisRecord[], sport: string | null = null) =>
  samplesOf(records, sport);
const powerPerSecond = (records: AnalysisRecord[]) => {
  const all = samples(records);
  return perSecond(all, all.power);
};
const seconds = (
  count: number,
  record: (second: number) => Omit<AnalysisRecord, "elapsedSeconds">,
) => Array.from({ length: count }, (_, second) => ({ elapsedSeconds: second, ...record(second) }));

const profile = (changes: SettingChange[]) =>
  profileOn(
    changes.map((change) => ({ day: "2026-01-01", change })),
    "2026-06-01",
  );
const threshold = (
  name: Extract<SettingChange, { kind: "threshold" }>["threshold"],
  value: number,
  sport: string | null = null,
): SettingChange => ({ kind: "threshold", sport, threshold: name, value });
const listed = (sport: string): SettingChange => ({ kind: "sport", sport, listed: true });

const activity = (
  sport: string,
  records: AnalysisRecord[],
  laps: AnalysisActivity["laps"] = [],
): AnalysisActivity => ({
  summary: {
    startTime: new Date("2026-05-01T08:00:00Z"),
    sport,
    subSport: undefined,
    elapsedSeconds: records.at(-1)?.elapsedSeconds ?? 0,
  },
  records,
  laps,
});

describe("as Ride's RideAnalysisTests", () => {
  const heartRateZones = zones("percent_of_max", { max_heart_rate: 200 });

  test("shares time across zones and leaves pauses out", () => {
    const shares = timeInZones(
      samples([
        { elapsedSeconds: 0, heartRate: 100 },
        { elapsedSeconds: 1, heartRate: 100 },
        { elapsedSeconds: 2, heartRate: 190 },
        { elapsedSeconds: 3, heartRate: 190 },
        { elapsedSeconds: 63, heartRate: 190 },
      ]),
      heartRateZones,
    );
    assert.deepEqual(
      shares.map((share) => share.zone),
      heartRateZones.zones,
    );
    assert.equal(shares[0]!.seconds, 2);
    assert.equal(shares[4]!.seconds, 1);
    assert.equal(shares[0]!.fraction, 2 / 3);
  });

  test("has no zones without heart rate", () => {
    const ride = samples(seconds(2, () => ({ power: 100 })));
    assert.deepEqual(timeInZones(ride, heartRateZones), []);
  });

  test("finds the best average power per duration", () => {
    const powers = [100, 100, 300, 300, 100, 100];
    const curve = powerCurve(
      powerPerSecond(seconds(6, (second) => ({ power: powers[second] }))),
      [1, 2, 4, 10],
    );
    assert.deepEqual(curve, [
      { durationSeconds: 1, watts: 300 },
      { durationSeconds: 2, watts: 300 },
      { durationSeconds: 4, watts: 200 },
    ]);
  });

  test("shares time across pace zones while moving", () => {
    const paceZones = zones("friel_running_pace", { threshold_pace: 300 });
    const run = samples([
      { elapsedSeconds: 0, speedMetresPerSecond: 1000 / 300 },
      { elapsedSeconds: 1, speedMetresPerSecond: 0 },
      { elapsedSeconds: 2, speedMetresPerSecond: 1000 / 400 },
      { elapsedSeconds: 3, speedMetresPerSecond: 1000 / 400 },
    ]);
    assert.deepEqual(timeInZones(run, paceZones), []);
    assert.deepEqual(
      timeInZones(run, paceZones, 1000).map((share) => share.seconds),
      [1, 0, 0, 0, 1, 0, 0],
    );
  });

  test("an hour at FTP is an intensity of one and a score of a hundred", () => {
    const normalized = normalizedPower(powerPerSecond(seconds(3600, () => ({ power: 250 }))));
    assert.equal(normalized, 250);
    assert.equal(intensity(normalized, 250), 1);
    assert.equal(stressScore(3599, intensity(normalized, 250)), 100);
    assert.equal(intensity(normalized, 0), null);
  });

  test("adds a minute at 100 W and a minute at 300 W up to 24 kJ", () => {
    assert.equal(workKilojoules(samples(seconds(120, (s) => ({ power: s < 60 ? 100 : 300 })))), 24);
    assert.equal(workKilojoules(samples([{ elapsedSeconds: 0, heartRate: 120 }])), null);
  });

  for (const interval of [1, 1.2, 2]) {
    test(`adds up the same work and power with ${interval} s between samples`, () => {
      const count = Math.round(120 / interval) + 1;
      const records = Array.from({ length: count }, (_, index) => ({
        elapsedSeconds: index * interval,
        power: 200,
      }));
      assert.equal(workKilojoules(samples(records)), 24);
      assert.equal(normalizedPower(powerPerSecond(records)), 200);
      assert.deepEqual(
        powerCurve(powerPerSecond(records), [5, 60]).map(({ watts }) => watts),
        [200, 200],
      );
    });
  }

  test("leaves pauses out of the power per second and the work", () => {
    const paused = powerPerSecond([
      { elapsedSeconds: 0, power: 300 },
      { elapsedSeconds: 60, power: 300 },
    ]);
    assert.equal(paused.filter((power) => power > 0).length, 2);
    const records = [...seconds(61, () => ({ power: 300 })), { elapsedSeconds: 120, power: 300 }];
    assert.equal(workKilojoules(samples(records)), 18);
  });

  test("has no normalized power for a ride shorter than its 30 second window", () => {
    assert.equal(normalizedPower(powerPerSecond(seconds(10, () => ({ power: 200 })))), null);
  });
});

describe("dropouts, spikes and sampling", () => {
  test("counts a power spike as a dropout, which Ride counts as zero watts", () => {
    const spiked = seconds(60, (second) => ({ power: second === 30 ? 65_000 : 200 }));
    const dropped = seconds(60, (second) => ({ power: second === 30 ? undefined : 200 }));
    assert.deepEqual(powerPerSecond(spiked), powerPerSecond(dropped));
    assert.equal(powerPerSecond(spiked)[30], 0);
  });

  test("leaves implausible heart rates and running speeds out of the zones", () => {
    const heartRates = timeInZones(
      samples(seconds(4, (second) => ({ heartRate: [0, 150, 255, 150][second] }))),
      zones("percent_of_max", { max_heart_rate: 200 }),
    );
    assert.equal(
      heartRates.reduce((sum, share) => sum + share.seconds, 0),
      1,
    );
    const run = samplesOf(
      seconds(3, (second) => ({ speedMetresPerSecond: [3, 20, 3][second] })),
      "running",
    );
    assert.ok(Number.isNaN(run.speed[1]!));
  });

  test("takes records in time order", () => {
    const shuffled = [
      { elapsedSeconds: 2, power: 300 },
      { elapsedSeconds: 0, power: 100 },
      { elapsedSeconds: 1, power: 200 },
    ];
    assert.deepEqual([...powerPerSecond(shuffled)], [100, 200, 300]);
  });

  test("ignores records more than a week after the start, so a broken timestamp cannot exhaust memory", () => {
    const perSecondPower = powerPerSecond([
      { elapsedSeconds: 0, power: 200 },
      { elapsedSeconds: 1, power: 200 },
      { elapsedSeconds: 4_000_000_000, power: 200 },
    ]);
    assert.equal(perSecondPower.length, 2);
    assert.ok(maxActivitySeconds >= 24 * 60 * 60);
  });

  test("takes speed from distance when the records carry none", () => {
    const run = samplesOf(
      seconds(3, (second) => ({ distanceMetres: second * 3 })),
      "running",
    );
    assert.deepEqual([...run.speed].slice(1), [3, 3]);
  });
});

describe("grade-adjusted pace", () => {
  test("follows Minetti's cost of running on a slope", () => {
    assert.equal(minettiCost(0), 3.6);
    assert.ok(Math.abs(gradeAdjustment(0.1) - 5.968214 / 3.6) < 1e-9);
    assert.ok(gradeAdjustment(-0.1) < 1);
    assert.equal(gradeAdjustment(0.9), gradeAdjustment(0.45));
  });

  const hill = (grade: number) =>
    seconds(600, (second) => ({
      speedMetresPerSecond: 3,
      distanceMetres: second * 3,
      altitudeMetres: 100 + second * 3 * grade,
    }));

  test("finds the grade of a steady climb and of flat ground under noisy altitude", () => {
    const climb = grades(samplesOf(hill(0.1), "running"));
    assert.ok(climb.every((grade) => Math.abs(grade - 0.1) < 1e-9));
    const noisy = grades(
      samplesOf(
        seconds(600, (second) => ({
          distanceMetres: second * 3,
          altitudeMetres: second % 2 ? 102 : 98,
        })),
        "running",
      ),
    );
    assert.ok(noisy.slice(17, -17).every((grade) => Math.abs(grade) <= 0.04));
  });

  test("runs faster up a climb, slower down it, and as run on the flat", () => {
    const average = (records: AnalysisRecord[]) =>
      analyzeActivity(activity("running", records), profile([])).averageGradeAdjustedSpeed!;
    assert.ok(Math.abs(average(hill(0)) - 3) < 1e-9);
    assert.ok(Math.abs(average(hill(0.1)) - 3 * gradeAdjustment(0.1)) < 1e-9);
    assert.ok(average(hill(-0.1)) < 3);
  });

  test("scores an hour at threshold pace on the flat as a hundred", () => {
    const records = seconds(3601, (second) => ({
      speedMetresPerSecond: 1000 / 300,
      distanceMetres: (second * 1000) / 300,
    }));
    const analysis = analyzeActivity(
      activity("running", records),
      profile([listed("running"), threshold("threshold_pace", 300, "running")]),
    );
    assert.ok(Math.abs(analysis.paceIntensity! - 1) < 1e-9);
    assert.equal(analysis.paceStressScore, 100);
    assert.deepEqual(analysis.load, { stressScore: 100, source: "pace" });
  });
});

describe("best efforts", () => {
  test("times each standard distance a steady run covers", () => {
    const efforts = bestEfforts(
      samplesOf(
        seconds(751, (second) => ({ distanceMetres: second * 4 })),
        "running",
      ),
    );
    assert.deepEqual(
      efforts.map(({ name, seconds }) => [name, seconds]),
      [
        ["400m", 100],
        ["1km", 250],
        ["mile", 402.336],
      ],
    );
  });

  test("finds the fastest stretch, wherever it starts", () => {
    let distance = 0;
    const records = seconds(1200, (second) => {
      distance += second >= 500 && second < 700 ? 5 : 2.5;
      return { distanceMetres: distance };
    });
    const [lap] = bestEfforts(samplesOf(records, "running"));
    assert.equal(lap!.seconds, 80);
    assert.ok(lap!.startSeconds >= 499 && lap!.endSeconds <= 700);
  });

  test("holds the distance where the device took some back, instead of starting over", () => {
    const efforts = bestEfforts(
      samplesOf(
        seconds(200, (second) => ({ distanceMetres: second === 100 ? 0 : second * 4 })),
        "running",
      ),
    );
    assert.equal(efforts[0]!.seconds, 99);
  });
});

describe("heart rate stress", () => {
  const thresholds = { resting: 50, max: 190, lactateThreshold: 165 };

  test("scores an hour at lactate threshold heart rate as a hundred", () => {
    assert.equal(
      heartRateStressScore(samples(seconds(3601, () => ({ heartRate: 165 }))), thresholds),
      100,
    );
    assert.equal(
      heartRateStressScore(samples(seconds(3601, () => ({ heartRate: 45 }))), thresholds),
      0,
    );
  });

  test("weighs hard minutes more than easy ones", () => {
    const easy = heartRateStressScore(
      samples(seconds(3601, () => ({ heartRate: 130 }))),
      thresholds,
    )!;
    const hard = heartRateStressScore(
      samples(seconds(3601, () => ({ heartRate: 180 }))),
      thresholds,
    )!;
    assert.ok(easy < 50 && hard > 115, `${easy} ${hard}`);
  });

  test("has no score without heart rate or with thresholds out of order", () => {
    assert.equal(
      heartRateStressScore(samples(seconds(60, () => ({ power: 100 }))), thresholds),
      null,
    );
    assert.equal(
      heartRateStressScore(samples(seconds(60, () => ({ heartRate: 150 }))), {
        ...thresholds,
        lactateThreshold: 200,
      }),
      null,
    );
  });
});

describe("the activity's load", () => {
  const hour = seconds(3601, (second) => ({
    power: 250,
    heartRate: 165,
    speedMetresPerSecond: 1000 / 300,
    distanceMetres: (second * 1000) / 300,
  }));
  const heartRate = [
    threshold("resting_heart_rate", 50),
    threshold("max_heart_rate", 190),
    threshold("lactate_threshold_heart_rate", 165),
  ];

  test("is the power score for a ride, then heart rate", () => {
    const withFtp = analyzeActivity(
      activity("cycling", hour),
      profile([threshold("ftp", 250), ...heartRate]),
    );
    assert.deepEqual(withFtp.load, { stressScore: 100, source: "power" });
    const withoutFtp = analyzeActivity(activity("cycling", hour), profile(heartRate));
    assert.deepEqual(withoutFtp.load, { stressScore: 100, source: "heart_rate" });
    assert.equal(analyzeActivity(activity("cycling", hour), profile([])).load, null);
  });

  test("is the pace score for a run, then power, then heart rate", () => {
    const everything = profile([
      listed("running"),
      threshold("threshold_pace", 300, "running"),
      threshold("ftp", 200),
      ...heartRate,
    ]);
    assert.equal(analyzeActivity(activity("running", hour), everything).load?.source, "pace");
    const noPace = profile([listed("running"), threshold("ftp", 200), ...heartRate]);
    assert.deepEqual(analyzeActivity(activity("running", hour), noPace).load, {
      stressScore: 156,
      source: "power",
    });
  });
});

describe("laps", () => {
  const start = new Date("2026-05-01T08:00:00Z").getTime();
  const lap = (from: number, seconds: number | undefined) => ({
    startTime: new Date(start + from * 1000),
    elapsedSeconds: seconds,
  });
  const lapsOf = (records: AnalysisRecord[], laps: AnalysisActivity["laps"]) =>
    analyzeActivity(activity("cycling", records, laps), profile([])).laps.map(
      ({ startSeconds, endSeconds, normalizedPowerWatts, workKilojoules }) => [
        startSeconds,
        endSeconds,
        normalizedPowerWatts,
        workKilojoules,
      ],
    );

  test("analyzes each lap on its own, up to its last second", () => {
    const records = seconds(121, (second) => ({ power: second < 60 ? 1000 : 3000 }));
    assert.deepEqual(lapsOf(records, [lap(0, 60), lap(60, undefined)]), [
      [0, 60, 1000, 60],
      [60, 120, 3000, 180],
    ]);
  });

  test("starts a lap that overlaps the one before where that one ended", () => {
    const records = seconds(121, () => ({ power: 1000 }));
    assert.deepEqual(lapsOf(records, [lap(0, 90), lap(60, 60)]), [
      [0, 90, 1000, 90],
      [90, 120, 1000, 30],
    ]);
  });

  test("stays bounded with a record timestamped long before the start", () => {
    const records = [{ elapsedSeconds: -1e9, power: 200 }, ...seconds(121, () => ({ power: 200 }))];
    assert.deepEqual(lapsOf(records, [lap(-1e9, 1e9 + 60), lap(60, 60)]), [
      [-1e9, 60, 200, 12],
      [60, 120, 200, 12],
    ]);
    assert.deepEqual(lapsOf(records, [lap(Number.NaN, 60)]), []);
  });
});

test("names every statistic <what>_<unit>, as the contract's statistics are", () => {
  const records = seconds(3601, (second) => ({
    power: 250,
    heartRate: 165,
    speedMetresPerSecond: 4,
    distanceMetres: second * 4,
  }));
  const analysis = analyzeActivity(
    activity("running", records),
    profile([
      listed("running"),
      threshold("threshold_pace", 300, "running"),
      threshold("ftp", 250),
      threshold("max_heart_rate", 190),
      threshold("resting_heart_rate", 50),
      threshold("lactate_threshold_heart_rate", 165),
    ]),
  );
  const statistics = statisticsOf(analysis);
  const known = new Set(analysisStatistics.map(({ name }) => name));
  for (const name of Object.keys(statistics)) {
    assert.match(name, /^[a-z0-9]+(_[a-z0-9]+)*_(s|mps|w|kj|ratio|tss)$/);
    assert.ok(known.has(name) || name.startsWith("time_in_"), name);
  }
  assert.equal(statistics.best_time_10km_s, 2500);
  assert.equal(statistics.time_in_heart_rate_zone_4_s, 3600);
  assert.equal(statistics.load_tss, statistics.pace_stress_tss);
  assert.equal(statistics.best_power_3600s_w, 250);
});

test("maps FIT sports onto the sports zones are kept for", () => {
  assert.equal(zoneSport("cycling", "indoorCycling"), "cycling");
  assert.equal(zoneSport("training", "strengthTraining"), "strength");
  assert.equal(zoneSport("walking", undefined), "walking");
  assert.equal(zoneSport(254, undefined), null);
  assert.equal(zoneSport(undefined, undefined), null);
});
