import assert from "node:assert/strict";
import { test } from "node:test";

import { emptyProfile, profileOn } from "@trainstack/zones";

import {
  historySources,
  NEW_ACCOUNT_DAYS,
  onboardingOf,
  quickFields,
  quickWrites,
  showsGettingStarted,
} from "../hosted/apps/account/src/lib/onboarding.ts";

const DAY_MS = 86_400_000;

const ride = (overrides = {}) => ({
  sport: "cycling",
  missingThresholds: [],
  statistics: { load_tss: 80, power_stress_tss: 80 },
  localDay: "2026-11-10",
  analysisDue: false,
  ...overrides,
});

const unscoredRide = ride({ missingThresholds: ["ftp", "max_heart_rate"], statistics: {} });

const profileWith = (changes) =>
  profileOn(
    changes.map((change) => ({ day: "2026-11-01", change })),
    "2026-11-14",
  );

const ftp = { kind: "threshold", sport: null, threshold: "ftp", value: 250 };

const facts = (overrides = {}) => ({
  activities: [],
  moreActivities: false,
  profile: emptyProfile(),
  planned: false,
  ...overrides,
});

test("a new account has every step to do", () => {
  const onboarding = onboardingOf(facts());
  assert.equal(onboarding.history.state, "open");
  assert.equal(onboarding.thresholds.state, "open");
  assert.equal(onboarding.plan.state, "open");
  assert.equal(onboarding.done, false);
});

test("thresholds typed in before any activity count as set", () => {
  assert.equal(onboardingOf(facts({ profile: profileWith([ftp]) })).thresholds.state, "done");
});

test("activities that miss a threshold for a better load keep the thresholds step open, and say which", () => {
  const onboarding = onboardingOf(facts({ activities: [unscoredRide, ride()] }));
  assert.equal(onboarding.history.state, "done");
  assert.equal(onboarding.thresholds.state, "open");
  assert.equal(onboarding.thresholds.unscored, 1);
});

test("a ride scored from power is done even while heart rate zones miss a max heart rate", () => {
  const scored = ride({ missingThresholds: ["max_heart_rate"] });
  assert.equal(onboardingOf(facts({ activities: [scored] })).thresholds.state, "done");
});

test("while new activities are still being analysed, the thresholds step waits for them", () => {
  const due = ride({ analysisDue: true, statistics: {} });
  assert.equal(onboardingOf(facts({ activities: [due] })).thresholds.state, "waiting");
});

test("strength and bouldering sessions need no thresholds", () => {
  const logged = { ...ride(), sport: "strength", statistics: { load_tss: 40 } };
  assert.equal(onboardingOf(facts({ activities: [logged] })).thresholds.state, "done");
});

test("everything done, with something planned, finishes getting started", () => {
  const onboarding = onboardingOf(facts({ activities: [ride()], planned: true }));
  assert.equal(onboarding.done, true);
});

test("getting started shows for an empty account of any age, and for a new account until it is done", () => {
  const now = new Date("2026-11-14T10:00:00Z");
  const old = new Date(now.getTime() - (NEW_ACCOUNT_DAYS + 1) * DAY_MS);
  const young = new Date(now.getTime() - 2 * DAY_MS);
  const empty = onboardingOf(facts());
  const withHistory = onboardingOf(facts({ activities: [unscoredRide] }));
  const finished = onboardingOf(facts({ activities: [ride()], planned: true }));
  assert.equal(showsGettingStarted(empty, old, now), true);
  assert.equal(showsGettingStarted(withHistory, young, now), true);
  assert.equal(showsGettingStarted(withHistory, old, now), false);
  assert.equal(showsGettingStarted(withHistory, null, now), false);
  assert.equal(showsGettingStarted(finished, young, now), false);
});

test("the quick form asks only for what is not set or suggested yet", () => {
  assert.deepEqual(
    quickFields(emptyProfile()).map((field) => field.id),
    ["ftp", "max_heart_rate", "lactate_threshold_heart_rate", "threshold_pace", "weight"],
  );
  assert.deepEqual(
    quickFields(profileWith([ftp, { kind: "weight", kg: 70 }])).map((field) => field.id),
    ["max_heart_rate", "lactate_threshold_heart_rate", "threshold_pace"],
  );
  assert.deepEqual(
    quickFields(emptyProfile(), [
      { threshold: "ftp", sport: null },
      { threshold: "threshold_pace", sport: "running" },
      { threshold: "max_heart_rate", sport: "cycling" },
    ]).map((field) => field.id),
    ["max_heart_rate", "lactate_threshold_heart_rate", "weight"],
    "a suggestion stands in for the field it fills",
  );
  const pace = quickFields(emptyProfile()).find((field) => field.id === "threshold_pace");
  assert.equal(pace.label, "Running threshold pace");
  assert.equal(pace.unit, "/km");
});

test("the quick form writes each value it was given for today, and adds running for a run pace", () => {
  const now = new Date("2026-11-14T10:00:00Z");
  const answer = quickWrites(
    [],
    { ftp: " 262 ", threshold_pace: "4:20", weight: "71,5", max_heart_rate: "" },
    "2026-11-14",
    now,
  );
  assert.equal(answer.kind, "writes");
  assert.deepEqual(
    answer.writes.map(({ day, change }) => ({ day, change })),
    [
      { day: "2026-11-14", change: { ...ftp, value: 262 } },
      { day: "2026-11-14", change: { kind: "sport", sport: "running", listed: true } },
      {
        day: "2026-11-14",
        change: { kind: "threshold", sport: "running", threshold: "threshold_pace", value: 260 },
      },
      { day: "2026-11-14", change: { kind: "weight", kg: 71.5 } },
    ],
  );
});

test("the quick form refuses a value out of range and says what it takes", () => {
  const answer = quickWrites([], { ftp: "2000", max_heart_rate: "190" }, "2026-11-14");
  assert.equal(answer.kind, "problems");
  assert.match(answer.problems.ftp, /^Enter a whole number from /);
  assert.equal(answer.problems.max_heart_rate, undefined);
  assert.equal(quickWrites([], { ftp: " " }, "2026-11-14").kind, "empty");
});

test("each history source says honestly whether it works, and has its own id", () => {
  const ids = historySources.map((source) => source.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const source of historySources) {
    assert.equal(source.state === "available", source.action !== undefined, source.id);
  }
});
