import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  analysisStatistics,
  detectThresholds,
  type ThresholdActivity,
  type ThresholdDetection,
  type ThresholdEstimate,
  thresholdStatistics,
} from "../src/index.ts";
import {
  activityOf,
  athlete,
  cyclingTests,
  dayBefore,
  easy,
  frielHeartRate,
  maximal,
  race,
  recordsOf,
  season,
  seeded,
  trainingRide,
  trueFtp,
} from "./synthetic-athlete.ts";

const today = "2026-11-01";
const withMax = { max_heart_rate: athlete.maxHeartRate };

const find = (detections: ThresholdDetection[], threshold: ThresholdDetection["threshold"]) => {
  const found = detections.find((detection) => detection.threshold === threshold);
  assert.ok(found, threshold);
  return found;
};

function estimate(
  detections: ThresholdDetection[],
  threshold: ThresholdDetection["threshold"],
): ThresholdEstimate {
  const found = find(detections, threshold);
  assert.notEqual(found.value, null, `${threshold}: ${"reason" in found ? found.reason : ""}`);
  return found as ThresholdEstimate;
}

const within = (actual: number, expected: number, tolerance: number) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );

const cyclist = season({
  today,
  days: 120,
  sport: "cycling",
  seed: 1,
  tests: cyclingTests(athlete, 30),
});

const runner = season({
  today,
  days: 120,
  sport: "running",
  seed: 2,
  tests: [
    { daysAgo: 20, blocks: race(athlete, 10_000) },
    { daysAgo: 45, blocks: race(athlete, 5000) },
  ],
});

const easyRiding = (random: () => number) =>
  Array.from({ length: 6 }, () => easy(600 + Math.round(random() * 600), 0.58 + random() * 0.14));

describe("a cyclist with four months of training and maximal tests", () => {
  const detections = detectThresholds(cyclist, "cycling", { today, current: withMax });

  test("recovers FTP within 3 % by a critical power fit the 20 minute rule agrees with", () => {
    const ftp = estimate(detections, "ftp");
    within(ftp.value, trueFtp(athlete), 0.03 * trueFtp(athlete));
    assert.equal(ftp.method, "critical_power");
    assert.equal(ftp.confidence, "high");
    assert.deepEqual(ftp.signals, ["heart_rate_maximal", "curve_plausible", "methods_agree"]);
    assert.deepEqual(
      ftp.evidence.map(({ statistic }) => statistic),
      [
        "best_power_300s_w",
        "best_power_600s_w",
        "best_power_1200s_w",
        "best_power_1200s_heart_rate_bpm",
      ],
    );
    assert.equal(ftp.activityId, "cycling-23");
    assert.equal(ftp.day, dayBefore(today, 23));
  });

  test("recovers lactate threshold heart rate within 3 bpm from the 30 minute effort", () => {
    const heartRate = estimate(detections, "lactate_threshold_heart_rate");
    within(heartRate.value, frielHeartRate(athlete, "cycling"), 3);
    assert.equal(heartRate.method, "friel_thirty_minute");
    assert.equal(heartRate.activityId, "cycling-19");
    assert.equal(heartRate.confidence, "medium");
  });

  test("observes max heart rate within 3 bpm", () => {
    within(estimate(detections, "max_heart_rate").value, athlete.maxHeartRate, 3);
  });

  test("gives the same numbers with low confidence when no max heart rate is set", () => {
    const unset = detectThresholds(cyclist, "cycling", { today });
    const ftp = estimate(unset, "ftp");
    assert.equal(ftp.value, estimate(detections, "ftp").value);
    assert.equal(ftp.confidence, "low");
    assert.ok(ftp.signals.includes("heart_rate_unclear"));
    assert.equal(estimate(unset, "lactate_threshold_heart_rate").confidence, "low");
  });

  test("uses the athlete's FTP to find a qualifying 30 minute effort without an estimate", () => {
    const noTests = season({ today, days: 60, sport: "cycling", seed: 4 });
    const tt = activityOf(
      "time-trial",
      dayBefore(today, 3),
      "cycling",
      recordsOf(
        athlete,
        "cycling",
        [easy(900, 0.55), maximal(athlete, "cycling", 1800)],
        seeded(5),
      ),
    );
    const heartRate = estimate(
      detectThresholds([...noTests, tt], "cycling", { today, current: { ftp: 262 } }),
      "lactate_threshold_heart_rate",
    );
    assert.equal(heartRate.activityId, "time-trial");
    within(heartRate.value, frielHeartRate(athlete, "cycling"), 3);
  });
});

describe("a runner with a 5 km and a 10 km race", () => {
  const detections = detectThresholds(runner, "running", { today, current: withMax });

  test("recovers threshold pace within 2 % by Riegel's model, corroborated by both races", () => {
    const pace = estimate(detections, "threshold_pace");
    within(pace.value, 1000 / athlete.hourSpeed, 0.02 * (1000 / athlete.hourSpeed));
    assert.equal(pace.method, "riegel");
    assert.equal(pace.confidence, "high");
    assert.ok(pace.signals.includes("corroborated"));
    assert.equal(pace.activityId, "running-20");
  });

  test("recovers lactate threshold heart rate within 3 bpm from the 10 km race", () => {
    const heartRate = estimate(detections, "lactate_threshold_heart_rate");
    within(heartRate.value, frielHeartRate(athlete, "running"), 3);
    assert.equal(heartRate.activityId, "running-20");
  });

  test("keeps treadmill runs out of threshold pace", () => {
    const treadmill = runner.map((activity) => ({ ...activity, indoor: true }));
    const pace = find(detectThresholds(treadmill, "running", { today }), "threshold_pace");
    assert.equal(pace.value, null);
    assert.equal("reason" in pace && pace.reason, "no_data");
  });
});

describe("awkward athletes", () => {
  test("only easy riding gives no FTP against a set max heart rate", () => {
    const rides = season({ today, days: 120, sport: "cycling", seed: 3, training: easyRiding });
    const ftp = find(detectThresholds(rides, "cycling", { today, current: withMax }), "ftp");
    assert.equal(ftp.value, null);
    assert.equal("reason" in ftp && ftp.reason, "efforts_not_maximal");
  });

  test("a steady ride at a stale FTP is no threshold heart rate effort", () => {
    const steady = activityOf(
      "steady",
      dayBefore(today, 2),
      "cycling",
      Array.from({ length: 1800 }, (_, second) => ({
        elapsedSeconds: second,
        power: 200,
        heartRate: 140,
      })),
    );
    const heartRate = find(
      detectThresholds([steady], "cycling", { today, current: { ftp: 200, ...withMax } }),
      "lactate_threshold_heart_rate",
    );
    assert.equal(heartRate.value, null);
    assert.equal("reason" in heartRate && heartRate.reason, "efforts_not_maximal");
  });

  test("an old hour that raises FTP makes the estimate as old as it", () => {
    const ride = (statistics: Record<string, number>, id: string, daysAgo: number) => ({
      id,
      day: dayBefore(today, daysAgo),
      sport: "cycling",
      statistics,
    });
    const ftp = estimate(
      detectThresholds(
        [
          ride({ best_power_1200s_w: 300, best_power_1200s_heart_rate_bpm: 176 }, "fresh", 1),
          ride({ best_power_1200s_w: 290, best_power_3600s_w: 310 }, "old-hour", 100),
        ],
        "cycling",
        { today, current: withMax },
      ),
      "ftp",
    );
    assert.equal(ftp.method, "hour");
    assert.equal(ftp.confidence, "low");
    assert.ok(ftp.signals.includes("efforts_stale"));
  });

  test("only easy riding gives at most a low-confidence FTP without one", () => {
    const rides = season({ today, days: 120, sport: "cycling", seed: 3, training: easyRiding });
    const detections = detectThresholds(rides, "cycling", { today });
    const ftp = estimate(detections, "ftp");
    assert.equal(ftp.confidence, "low");
    assert.notEqual(estimate(detections, "max_heart_rate").confidence, "high");
  });

  test("one freak spike changes neither FTP nor max heart rate", () => {
    const random = seeded(9);
    const spiked = recordsOf(athlete, "cycling", trainingRide(random), random).map(
      (record, second) =>
        second === 1000
          ? { ...record, power: 2900, heartRate: 240 }
          : second === 2000
            ? { ...record, heartRate: 235 }
            : record,
    );
    const smartSpike = spiked.filter(
      ({ elapsedSeconds }) => elapsedSeconds <= 2000 || elapsedSeconds >= 2020,
    );
    const cadenceLock = recordsOf(athlete, "cycling", [easy(1800)], random).map((record, second) =>
      second >= 600 && second < 1200 ? { ...record, heartRate: 205 } : record,
    );
    const withSpikes = [
      ...cyclist,
      activityOf("spike", dayBefore(today, 5), "cycling", smartSpike),
      activityOf("cadence-lock", dayBefore(today, 7), "cycling", cadenceLock),
    ];
    const clean = detectThresholds(cyclist, "cycling", { today, current: withMax });
    const spikedDetections = detectThresholds(withSpikes, "cycling", { today, current: withMax });
    assert.equal(estimate(spikedDetections, "ftp").value, estimate(clean, "ftp").value);
    const max = estimate(spikedDetections, "max_heart_rate");
    within(max.value, athlete.maxHeartRate, 3);
    assert.ok(max.signals.includes("spike_discarded"));
  });

  test("indoor workouts in ERG mode without a maximal effort give no confident FTP", () => {
    const rides = season({ today, days: 120, sport: "cycling", seed: 6, indoor: true });
    const ftp = find(detectThresholds(rides, "cycling", { today, current: withMax }), "ftp");
    assert.ok(ftp.value === null || ftp.confidence === "low", JSON.stringify(ftp));
    if (ftp.value !== null) assert.ok(ftp.value < trueFtp(athlete));
  });

  test("indoor riding with tests is read like outdoor riding", () => {
    const rides = season({
      today,
      days: 120,
      sport: "cycling",
      seed: 1,
      indoor: true,
      tests: cyclingTests(athlete, 30),
    });
    const ftp = estimate(detectThresholds(rides, "cycling", { today, current: withMax }), "ftp");
    assert.equal(
      ftp.value,
      estimate(detectThresholds(cyclist, "cycling", { today, current: withMax }), "ftp").value,
    );
  });

  test("after a long break old tests count less and with low confidence", () => {
    const year = season({
      today,
      days: 175,
      sport: "cycling",
      seed: 7,
      tests: cyclingTests(athlete, 165),
    });
    const ageOf = ({ day }: ThresholdActivity) =>
      (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000;
    const brokeOff = year.filter((activity) => ageOf(activity) > 130 || ageOf(activity) < 14);
    const ftp = estimate(detectThresholds(brokeOff, "cycling", { today, current: withMax }), "ftp");
    assert.equal(ftp.confidence, "low");
    assert.ok(ftp.signals.includes("efforts_stale"));
    assert.ok(ftp.value < trueFtp(athlete));
  });

  test("tests older than the window are forgotten", () => {
    const old = cyclist.map((activity) => ({
      ...activity,
      day: dayBefore(activity.day, 200),
    }));
    const ftp = find(detectThresholds(old, "cycling", { today, current: withMax }), "ftp");
    assert.equal(ftp.value, null);
    assert.equal("reason" in ftp && ftp.reason, "no_data");
  });

  test("a single 20 minute test reads as the 20 minute rule", () => {
    const random = seeded(8);
    const test20 = activityOf(
      "twenty",
      dayBefore(today, 2),
      "cycling",
      recordsOf(
        athlete,
        "cycling",
        [easy(900, 0.55), maximal(athlete, "cycling", 1200), easy(600, 0.5)],
        random,
      ),
    );
    const ftp = estimate(detectThresholds([test20], "cycling", { today, current: withMax }), "ftp");
    assert.equal(ftp.method, "twenty_minute");
    assert.equal(ftp.confidence, "medium");
    assert.ok(ftp.signals.includes("curve_flat"));
    within(ftp.value, 0.95 * test20.statistics.best_power_1200s_w!, 1);
  });

  test("a sub-maximal 20 minutes does not hide another ride's maximal one", () => {
    const ride = (id: string, watts: number, heartRate: number): ThresholdActivity => ({
      id,
      day: dayBefore(today, 1),
      sport: "cycling",
      statistics: { best_power_1200s_w: watts, best_power_1200s_heart_rate_bpm: heartRate },
    });
    const ftp = estimate(
      detectThresholds([ride("maximal", 300, 180), ride("odd", 310, 150)], "cycling", {
        today,
        current: withMax,
      }),
      "ftp",
    );
    assert.equal(ftp.value, 285);
    assert.equal(ftp.activityId, "maximal");
  });

  test("an hour held above the estimate raises it to the hour", () => {
    const ride = (statistics: Record<string, number>, id: string): ThresholdActivity => ({
      id,
      day: dayBefore(today, 1),
      sport: "cycling",
      statistics,
    });
    const ftp = estimate(
      detectThresholds(
        [
          ride({ best_power_1200s_w: 250, best_power_1200s_heart_rate_bpm: 175 }, "short"),
          ride({ best_power_1200s_w: 245, best_power_3600s_w: 248 }, "hour"),
        ],
        "cycling",
        { today, current: withMax },
      ),
      "ftp",
    );
    assert.equal(ftp.method, "hour");
    assert.equal(ftp.value, 248);
    assert.equal(ftp.activityId, "hour");
  });

  test("says why when there is nothing to read", () => {
    const short: ThresholdActivity = {
      id: "short",
      day: today,
      sport: "cycling",
      statistics: { best_power_600s_w: 300 },
    };
    assert.deepEqual(
      detectThresholds([], "cycling", { today }).map((detection) => [
        detection.threshold,
        "reason" in detection && detection.reason,
      ]),
      [
        ["ftp", "no_data"],
        ["lactate_threshold_heart_rate", "no_data"],
        ["max_heart_rate", "no_data"],
      ],
    );
    const ftp = find(detectThresholds([short], "cycling", { today }), "ftp");
    assert.equal("reason" in ftp && ftp.reason, "too_short");
    const lthr = find(
      detectThresholds(
        [
          {
            ...short,
            statistics: { best_power_1800s_w: 200, best_power_1800s_heart_rate_bpm: 150 },
          },
        ],
        "cycling",
        { today },
      ),
      "lactate_threshold_heart_rate",
    );
    assert.equal("reason" in lthr && lthr.reason, "needs_threshold");
  });
});

test("reads five years of activities in well under a Worker's budget", () => {
  const random = seeded(10);
  const source = [...cyclist, ...runner];
  const activities: ThresholdActivity[] = Array.from({ length: 5000 }, (_, index) => {
    const from = source[index % source.length]!;
    return {
      ...from,
      id: `copy-${index}`,
      day: dayBefore(today, Math.floor(random() * 1800)),
    };
  });
  const started = performance.now();
  for (const sport of ["cycling", "running"]) {
    detectThresholds(activities, sport, { today, current: withMax });
  }
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 100, `${elapsed} ms`);
});

test("reads only statistics the analysis stores, and no others from the synthetic athletes", () => {
  const stored = new Set(analysisStatistics.map(({ name }) => name));
  for (const name of thresholdStatistics) assert.ok(stored.has(name), name);
  const narrowed = [...cyclist, ...runner].map((activity) => ({
    ...activity,
    statistics: Object.fromEntries(
      Object.entries(activity.statistics).filter(([name]) => thresholdStatistics.includes(name)),
    ),
  }));
  for (const sport of ["cycling", "running"]) {
    assert.deepEqual(
      detectThresholds(narrowed, sport, { today, current: withMax }),
      detectThresholds([...cyclist, ...runner], sport, { today, current: withMax }),
    );
  }
});
