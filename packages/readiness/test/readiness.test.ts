import assert from "node:assert/strict";
import { test } from "node:test";

import {
  actionFor,
  intensityFactorOf,
  intensityOf,
  readinessOn,
  readinessRange,
  type Reason,
} from "../src/index.ts";
import {
  athlete,
  checkIn,
  checkedInFor,
  enduranceRide,
  keySession,
  recoverySpin,
  shift,
  today,
  trainedFor,
  week,
  workout,
} from "./athletes.ts";

const kinds = (reasons: readonly Reason[]) => reasons.map((reason) => reason.kind);
const actions = (readiness: ReturnType<typeof readinessOn>) =>
  Object.fromEntries(readiness.suggestions.map(({ plannedId, action }) => [plannedId, action]));
const lowering = (readiness: ReturnType<typeof readinessOn>) =>
  readiness.reasons.filter((reason) => "effect" in reason && reason.effect === "lowers");

test("a fresh, rested athlete after an easy week is ready for a key session as planned", () => {
  const recoveryWeek = (back: number) => (back <= 7 ? week[back % 7]! / 2 : week[back % 7]!);
  const readiness = readinessOn(
    athlete({
      stress: trainedFor(120, shift(today, -1), recoveryWeek),
      checkIns: [
        ...checkedInFor(28, today, (back) => (back % 3 === 0 ? { energy: 4 } : {})),
        checkIn(today, { sleep: 4, energy: 4 }),
      ],
      planned: [keySession],
    }),
    today,
  );
  assert.equal(readiness.level, "ready");
  assert.equal(readiness.confidence, "high");
  assert.deepEqual(readiness.gaps, []);
  assert.deepEqual(actions(readiness), { key: "as_planned" });
  assert.deepEqual(lowering(readiness), []);
  const form = readiness.reasons.find((reason) => reason.kind === "form");
  assert.equal(form?.kind === "form" && form.band, "fresh");
  const sleep = readiness.reasons.find(
    (reason) => reason.kind === "check_in" && reason.item === "sleep",
  );
  assert.equal(sleep?.kind === "check_in" && sleep.effect, "raises");
});

test("deep in a block, with three hard days behind and sore legs, a key session becomes easy", () => {
  const block = (back: number) =>
    back <= 3 ? 130 : back <= 21 ? week[back % 7]! * 1.4 : week[back % 7]!;
  const readiness = readinessOn(
    athlete({
      stress: trainedFor(140, shift(today, -1), block),
      checkIns: [...checkedInFor(28, today), checkIn(today, { soreness: 2, energy: 2 })],
      planned: [keySession, recoverySpin],
    }),
    today,
  );
  assert.equal(readiness.level, "low");
  assert.deepEqual(
    kinds(lowering(readiness)).sort(),
    ["check_in", "check_in", "form", "hard_days"].sort(),
  );
  const hardDays = readiness.reasons.find((reason) => reason.kind === "hard_days");
  assert.equal(hardDays?.kind === "hard_days" && hardDays.days, 3);
  assert.deepEqual(actions(readiness), { key: "swap_easy", recovery: "as_planned" });
});

test("deep in a block but feeling normal, the athlete is fair and eases the key session", () => {
  const block = (back: number) =>
    back <= 3 ? 130 : back <= 21 ? week[back % 7]! * 1.4 : week[back % 7]!;
  const readiness = readinessOn(
    athlete({
      stress: trainedFor(140, shift(today, -1), block),
      checkIns: [...checkedInFor(28, today), checkIn(today)],
      planned: [keySession],
    }),
    today,
  );
  assert.equal(readiness.level, "fair");
  assert.deepEqual(actions(readiness), { key: "ease" });
});

const steadyAthlete = (todays = checkIn(today), planned = [keySession]) =>
  athlete({
    stress: trainedFor(120, shift(today, -1)),
    checkIns: [...checkedInFor(28, today, (back) => (back % 2 ? { sleep: 4 } : {})), todays],
    planned,
  });

test("a poor night before a key session eases it, and sleep is the reason given first", () => {
  const readiness = readinessOn(steadyAthlete(checkIn(today, { sleep: 1 })), today);
  assert.equal(readiness.level, "fair");
  assert.deepEqual(actions(readiness), { key: "ease" });
  const [first] = readiness.reasons;
  assert.equal(first?.kind === "check_in" && first.item, "sleep");
  assert.equal(first?.kind === "check_in" && first.against, "own");
  assert.ok(first?.kind === "check_in" && Math.abs(first.usual - 3.5) < 0.01);
});

test("a poor night leaves an easy session as planned", () => {
  const readiness = readinessOn(
    steadyAthlete(checkIn(today, { sleep: 1 }), [recoverySpin, enduranceRide]),
    today,
  );
  assert.deepEqual(actions(readiness), { recovery: "as_planned", endurance: "as_planned" });
});

test("an ill athlete is told to rest whatever the rest of the check-in says", () => {
  const readiness = readinessOn(
    steadyAthlete(checkIn(today, { energy: 5 }, { illness: { kind: "respiratory" } }), [
      keySession,
      recoverySpin,
    ]),
    today,
  );
  assert.equal(readiness.level, "poor");
  assert.equal(readiness.confidence, "high");
  assert.deepEqual(readiness.reasons[0], { kind: "ill", illness: "respiratory" });
  assert.deepEqual(actions(readiness), { key: "rest", recovery: "rest" });
});

test("coming back from illness, a key session is eased for a week after the last ill day", () => {
  const ill = { illness: { kind: "fever" as const } };
  const checkIns = [
    ...checkedInFor(28, shift(today, -5)),
    checkIn(shift(today, -5), {}, ill),
    checkIn(shift(today, -4), {}, ill),
    checkIn(shift(today, -3), { energy: 2 }, ill),
    checkIn(shift(today, -2)),
    checkIn(shift(today, -1)),
    checkIn(today),
  ];
  const input = athlete({
    stress: trainedFor(120, shift(today, -6)),
    checkIns,
    planned: [keySession],
  });
  const readiness = readinessOn(input, today);
  assert.equal(readiness.level, "fair");
  assert.deepEqual(readiness.reasons[0], {
    kind: "recently_ill",
    lastDay: shift(today, -3),
    daysAgo: 3,
  });
  assert.deepEqual(actions(readiness), { key: "ease" });
  const later = readinessOn(
    { ...input, planned: new Map([[shift(today, 5), [keySession]]]) },
    shift(today, 5),
  );
  assert.ok(!kinds(later.reasons).includes("recently_ill"));
});

test("days marked ill are left out of the athlete's usual", () => {
  const checkIns = [
    ...checkedInFor(28, today, (back) => (back <= 10 ? { energy: 1 } : { energy: 4 })).map(
      (entry, index, all) =>
        index >= all.length - 10 ? { ...entry, illness: { kind: "other" as const } } : entry,
    ),
    checkIn(today, { energy: 3 }),
  ];
  const readiness = readinessOn(athlete({ checkIns }), today);
  const energy = readiness.reasons.find((r) => r.kind === "check_in" && r.item === "energy");
  assert.equal(energy?.kind === "check_in" && energy.usual, 4);
  assert.equal(energy?.kind === "check_in" && energy.effect, "lowers");
});

test("an injury that stops training means rest; one that limits it swaps hard for easy", () => {
  const stops = readinessOn(
    steadyAthlete(checkIn(today, {}, { injury: { area: "knee", training: "none" } })),
    today,
  );
  assert.equal(stops.level, "poor");
  assert.deepEqual(actions(stops), { key: "rest" });
  const limits = readinessOn(
    steadyAthlete(checkIn(today, {}, { injury: { area: "knee", training: "reduced" } }), [
      keySession,
      enduranceRide,
      recoverySpin,
    ]),
    today,
  );
  assert.equal(limits.level, "low");
  assert.deepEqual(actions(limits), {
    key: "swap_easy",
    endurance: "ease",
    recovery: "as_planned",
  });
  const full = readinessOn(
    steadyAthlete(checkIn(today, {}, { injury: { area: "knee", training: "full" } })),
    today,
  );
  assert.equal(full.level, "ready");
  assert.deepEqual(full.reasons[0], { kind: "injured", area: "knee", training: "full" });
});

test("in a first week with no history, the check-in is read against the scale's normal and confidence is medium", () => {
  const readiness = readinessOn(
    athlete({
      stress: trainedFor(4, shift(today, -1), () => 60),
      checkIns: [...checkedInFor(3, today), checkIn(today, { energy: 2 })],
      planned: [keySession],
    }),
    today,
  );
  assert.equal(readiness.level, "ready");
  assert.equal(readiness.confidence, "medium");
  assert.deepEqual(readiness.gaps, [
    { kind: "short_baseline", checkIns: 3 },
    { kind: "short_training_history", days: 4 },
  ]);
  const energy = readiness.reasons.find((r) => r.kind === "check_in" && r.item === "energy");
  assert.equal(energy?.kind === "check_in" && energy.against, "scale");
  assert.equal(energy?.kind === "check_in" && energy.usual, 3);
  assert.ok(!kinds(readiness.reasons).includes("form"));
});

test("without a check-in, readiness comes from training alone, with low confidence", () => {
  const readiness = readinessOn(
    athlete({ stress: trainedFor(120, shift(today, -1)), planned: [keySession] }),
    today,
  );
  assert.equal(readiness.level, "ready");
  assert.equal(readiness.confidence, "low");
  assert.deepEqual(readiness.gaps, [{ kind: "no_check_in" }]);
  assert.equal(readiness.basis.checkIn, false);
  assert.deepEqual(readiness.basis.unmeasured, ["sleep", "resting_heart_rate", "hrv"]);
});

test("with no check-in and too little training, there is no level and no suggestion", () => {
  const readiness = readinessOn(
    athlete({ stress: trainedFor(10, shift(today, -1)), planned: [keySession] }),
    today,
  );
  assert.equal(readiness.level, null);
  assert.deepEqual(readiness.suggestions, []);
  assert.deepEqual(kinds(readiness.reasons), []);
});

test("today's own training does not count against this morning's readiness", () => {
  const stress = trainedFor(120, shift(today, -1));
  const before = readinessOn(athlete({ stress, checkIns: [checkIn(today)] }), today);
  stress.set(today, 400);
  const after = readinessOn(athlete({ stress, checkIns: [checkIn(today)] }), today);
  assert.deepEqual(after, before);
});

test("only workouts still to do get a suggestion", () => {
  const readiness = readinessOn(
    steadyAthlete(checkIn(today), [
      workout("done", 3600, 90, "completed"),
      workout("skipped", 3600, 90, "skipped"),
      { id: "note", kind: "note", state: "planned", seconds: null, load: null },
      keySession,
    ]),
    today,
  );
  assert.deepEqual(Object.keys(actions(readiness)), ["key"]);
  assert.deepEqual(readiness.suggestions[0], {
    plannedId: "key",
    intensity: "hard",
    action: "as_planned",
    plannedLoad: 90,
    plannedSeconds: 3600,
  });
});

test("a session's intensity follows Allen and Coggan's intensity factor, and a long day is hard", () => {
  assert.ok(Math.abs(intensityFactorOf(keySession)! - Math.sqrt(0.9)) < 1e-9);
  assert.equal(intensityOf(keySession, 50), "hard");
  assert.equal(intensityOf(enduranceRide, 50), "moderate");
  assert.equal(intensityOf(recoverySpin, 50), "easy");
  assert.equal(intensityOf(workout("long", 5 * 3600, 245), 50), "hard");
  assert.equal(intensityOf(workout("unknown", 3600, null), 50), "unknown");
  assert.equal(actionFor("low", "unknown"), "ease");
});

test("a fast ramp in fitness counts against readiness", () => {
  const ramp = (back: number) => (back <= 14 ? 160 : 40);
  const readiness = readinessOn(
    athlete({ stress: trainedFor(140, shift(today, -1), ramp), checkIns: [checkIn(today)] }),
    today,
  );
  const reason = readiness.reasons.find((r) => r.kind === "ramp");
  assert.ok(reason?.kind === "ramp" && reason.perWeek > 8);
  assert.equal(readiness.level, "fair");
});

test("a range gives each day what readiness on that day gives", () => {
  const input = {
    ...steadyAthlete(checkIn(today, { sleep: 1 })),
    planned: new Map([
      [today, [keySession]],
      [shift(today, -2), [recoverySpin]],
    ]),
  };
  const days = readinessRange(input, shift(today, -6), today);
  assert.equal(days.length, 7);
  for (const day of days) assert.deepEqual(day, readinessOn(input, day.day));
});

test("a check-in with nothing rated and no illness or injury counts as no check-in", () => {
  const unrated = {
    ...checkIn(today),
    ratings: { sleep: null, energy: null, soreness: null, stress: null, mood: null },
  };
  const readiness = readinessOn(
    athlete({
      stress: trainedFor(10, shift(today, -1)),
      checkIns: [...checkedInFor(3, today), unrated],
      planned: [keySession],
    }),
    today,
  );
  assert.equal(readiness.level, null);
  assert.deepEqual(readiness.suggestions, []);
  assert.equal(readiness.basis.checkIn, false);
  assert.deepEqual(readiness.gaps[0], { kind: "no_check_in" });
});

test("check-ins that rated nothing that is rated today do not make a baseline for it", () => {
  const injuredOnly = checkedInFor(10, today).map((entry) => ({
    ...entry,
    ratings: { sleep: null, energy: null, soreness: null, stress: null, mood: null },
    injury: { area: "knee", training: "full" as const },
  }));
  const readiness = readinessOn(
    athlete({
      stress: trainedFor(120, shift(today, -1)),
      checkIns: [...injuredOnly, checkIn(today, { sleep: 2 })],
    }),
    today,
  );
  assert.equal(readiness.confidence, "medium");
  assert.deepEqual(readiness.gaps, [{ kind: "short_baseline", checkIns: 0 }]);
  assert.equal(readiness.basis.baselineCheckIns, 0);
  const sleep = readiness.reasons.find((r) => r.kind === "check_in" && r.item === "sleep");
  assert.equal(sleep?.kind === "check_in" && sleep.against, "scale");
});

test("before load can be read, a session is hard by its intensity alone, not by a small early fitness", () => {
  const readiness = readinessOn(
    athlete({
      stress: trainedFor(20, shift(today, -1), () => 30),
      checkIns: [checkIn(today)],
      planned: [workout("long", 3 * 3600, 150)],
    }),
    today,
  );
  assert.deepEqual(readiness.gaps.at(-1), { kind: "short_training_history", days: 20 });
  assert.equal(readiness.suggestions[0]?.intensity, "easy");
});
