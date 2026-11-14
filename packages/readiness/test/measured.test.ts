import assert from "node:assert/strict";
import { test } from "node:test";

import { maxMeasuredWeight, readinessOn, type Reason } from "../src/index.ts";
import {
  athlete,
  checkIn,
  checkedInFor,
  keySession,
  measuredFor,
  shift,
  today,
  trainedFor,
} from "./athletes.ts";

const measuredReasons = (reasons: readonly Reason[]) =>
  Object.fromEntries(
    reasons.flatMap((reason) =>
      reason.kind === "measured" ? [[reason.item, [reason.effect, reason.weight]]] : [],
    ),
  );

const rested = {
  stress: trainedFor(120, shift(today, -1)),
  checkIns: [...checkedInFor(28, today), checkIn(today)],
  planned: [keySession],
};

test("a usual night reads steady on all three, and readiness stays where the check-in puts it", () => {
  const readiness = readinessOn(athlete({ ...rested, measured: measuredFor(70, today) }), today);
  assert.deepEqual(measuredReasons(readiness.reasons), {
    sleep: ["steady", 0],
    resting_heart_rate: ["steady", 0],
    hrv: ["steady", 0],
  });
  assert.deepEqual(readiness.basis.unmeasured, []);
  assert.equal(readiness.level, "ready");
});

test("a bad night, short sleep with a raised resting heart rate and low HRV, eases a key session", () => {
  const usual = readinessOn(athlete({ ...rested, measured: measuredFor(70, today) }), today);
  const badNight = readinessOn(
    athlete({
      ...rested,
      measured: measuredFor(70, today, (back) =>
        back === 0 ? { sleepSeconds: 4.3 * 3600, restingHeartRateBpm: 61, hrvMs: 31 } : {},
      ),
    }),
    today,
  );
  assert.deepEqual(measuredReasons(badNight.reasons), {
    sleep: ["lowers", 2],
    resting_heart_rate: ["lowers", 2],
    hrv: ["lowers", 2],
  });
  assert.equal(usual.level, "ready");
  assert.equal(badNight.level, "fair", "measured alone weighs at most 3");
  assert.equal(maxMeasuredWeight, 3);
  assert.deepEqual(
    badNight.suggestions.map(({ action }) => action),
    ["ease"],
  );
});

test("a bad night and a check-in that says so too take readiness further down", () => {
  const readiness = readinessOn(
    athlete({
      ...rested,
      checkIns: [...checkedInFor(28, today), checkIn(today, { sleep: 1, energy: 2 })],
      measured: measuredFor(70, today, (back) =>
        back === 0 ? { sleepSeconds: 4.3 * 3600, restingHeartRateBpm: 61, hrvMs: 31 } : {},
      ),
    }),
    today,
  );
  assert.equal(readiness.level, "poor");
});

test("one hour short of usual sleep weighs 1, and a little short weighs nothing", () => {
  const sleep = (hours: number) =>
    measuredReasons(
      readinessOn(
        athlete({
          ...rested,
          measured: measuredFor(30, today, (back) =>
            back === 0 ? { sleepSeconds: hours * 3600 } : { sleepSeconds: 7.5 * 3600 },
          ),
        }),
        today,
      ).reasons,
    ).sleep;
  assert.deepEqual(sleep(6.5), ["lowers", 1]);
  assert.deepEqual(sleep(7), ["steady", 0]);
  assert.deepEqual(sleep(9), ["raises", 0]);
});

test("a measure without enough days before it is a gap, not a reason", () => {
  const readiness = readinessOn(athlete({ ...rested, measured: measuredFor(5, today) }), today);
  assert.deepEqual(measuredReasons(readiness.reasons), {});
  assert.deepEqual(
    readiness.gaps.map((gap) =>
      gap.kind === "short_measured_baseline" ? [gap.item, gap.days] : gap.kind,
    ),
    [
      ["sleep", 4],
      ["resting_heart_rate", 4],
      ["hrv", 4],
    ],
  );
  assert.equal(readiness.confidence, "medium");
});

test("a day without a value leaves that measure unmeasured", () => {
  const readiness = readinessOn(
    athlete({
      ...rested,
      measured: measuredFor(70, today, (back) => (back === 0 ? { hrvMs: null } : {})),
    }),
    today,
  );
  assert.deepEqual(readiness.basis.unmeasured, ["hrv"]);
});

test("measured alone, with no check-in and no training, still gives a level", () => {
  const readiness = readinessOn(
    athlete({
      measured: measuredFor(70, today, (back) =>
        back === 0 ? { sleepSeconds: 4 * 3600, restingHeartRateBpm: 62, hrvMs: 30 } : {},
      ),
    }),
    today,
  );
  assert.equal(readiness.level, "fair");
  assert.equal(readiness.confidence, "low");
});
