import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { workoutSchema } from "@trainstack/workout";
import {
  canDragLevel,
  draggedSeconds,
  nudgeLength,
  nudgeLevel,
  withLength,
  withLevelShare,
} from "../hosted/apps/account/src/lib/chart-edit.ts";
import {
  blankWorkout,
  duplicateBlock,
  edit,
  groupIntoRepeat,
  groupable,
  insertAt,
  moveBlock,
  newStep,
  pathAfterMove,
  problemsByPath,
  problemsOf,
  redo,
  removeBlocks,
  startHistory,
  undo,
  ungroup,
  updateStep,
  withDurationType,
  withLevelKind,
  withTargetType,
  withUnit,
} from "../hosted/apps/account/src/lib/workout-editor.ts";
import { noReference } from "../hosted/apps/account/src/lib/workout-profile.ts";
import { sameWorkout, saveWorkout } from "../hosted/apps/account/src/lib/workout-save.ts";
import { mockApple } from "./helpers/apple.mjs";
import { signInOnTheWeb as signInWithApple } from "./helpers/web.mjs";
import { migrate, startWorker } from "./helpers/worker.mjs";

const apple = mockApple();
let worker;
let runtime;

before(
  async () => {
    worker = await startWorker({
      bindings: {
        NODE_ENV: "production",
        APPLE_SIGN_IN_KEY_ID: "TESTKEY123",
        APPLE_SIGN_IN_PRIVATE_KEY: generateKeyPairSync("ec", { namedCurve: "P-256" })
          .privateKey.export({ type: "pkcs8", format: "pem" })
          .toString(),
      },
      outboundService: (r) => apple.fetch(r),
    });
    runtime = worker.runtime;
    await migrate(runtime);
  },
  { timeout: 60_000 },
);

after(async () => {
  await worker?.dispose();
});

const signInOnTheWeb = () => signInWithApple(runtime, apple);

const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000);

const at = (seconds, value) => ({
  type: "step",
  duration: { type: "time", seconds },
  target: { type: "power", unit: "ftp", level: { kind: "constant", value } },
});

const names = (blocks) =>
  blocks.map((block) =>
    block.type === "step"
      ? block.target.level.value
      : { count: block.count, steps: names(block.steps) },
  );

test("an over-under with nested repeats is built from a blank workout, step by step", () => {
  let workout = blankWorkout("cycling");
  const steps = () => workout.steps;
  const set = (blocks) => {
    workout = { ...workout, steps: blocks };
  };
  set(
    updateStep(steps(), [0], (step) => ({
      ...step,
      target: at(600, 0.55).target,
      duration: { type: "time", seconds: 600 },
    })),
  );
  set(insertAt(steps(), [1], [at(60, 1.05), at(60, 0.95)]));
  const inner = groupIntoRepeat(steps(), [[1], [2]], 3);
  set(inner.blocks);
  assert.deepEqual(inner.path, [1]);
  set(insertAt(steps(), [2], [at(240, 0.5)]));
  const outer = groupIntoRepeat(steps(), [[1], [2]], 3);
  set(outer.blocks);
  set(insertAt(steps(), [2], [at(480, 0.4)]));

  assert.deepEqual(names(steps()), [
    0.55,
    { count: 3, steps: [{ count: 3, steps: [1.05, 0.95] }, 0.5] },
    0.4,
  ]);
  assert.equal(workoutSchema.safeParse(workout).success, true);
  assert.deepEqual(problemsOf(workout), []);
});

test("steps move within their repeat, duplicate after themselves, and delete without leaving an empty repeat", () => {
  const blocks = [
    at(60, 0.5),
    { type: "repeat", count: 2, steps: [at(30, 1.2), at(30, 0.6)] },
    at(60, 0.4),
  ];
  const down = moveBlock(blocks, [1, 0], 1);
  assert.deepEqual(names(down.blocks)[1].steps, [0.6, 1.2]);
  assert.deepEqual(down.path, [1, 1]);
  assert.equal(moveBlock(blocks, [1, 1], 1), null, "a step does not leave its repeat by moving");
  assert.equal(moveBlock(blocks, [0], -1), null);

  const copied = duplicateBlock(blocks, [1]);
  assert.deepEqual(copied.path, [2]);
  assert.equal(copied.blocks.length, 4);
  copied.blocks[2].steps[0].duration.seconds = 999;
  assert.equal(
    blocks[1].steps[0].duration.seconds,
    30,
    "a duplicate shares nothing with its original",
  );

  assert.deepEqual(
    names(
      removeBlocks(blocks, [
        [1, 0],
        [1, 1],
      ]),
    ),
    [0.5, 0.4],
  );
  assert.deepEqual(names(ungroup(blocks, [1])), [0.5, 1.2, 0.6, 0.4]);
});

test("only neighbouring blocks at one level can become a repeat", () => {
  assert.deepEqual(groupable([[2], [1]]), { parent: [], from: 1, to: 2 });
  assert.equal(groupable([[0], [2]]), null);
  assert.equal(groupable([[0], [1, 0]]), null);
  assert.equal(groupable([]), null);
});

test("undo and redo step through edits, and typing in one field is one step", () => {
  const first = blankWorkout("cycling");
  let history = startHistory(first);
  history = edit(history, { ...first, name: "T" }, "name", 1000);
  history = edit(history, { ...first, name: "Th" }, "name", 1200);
  history = edit(history, { ...first, name: "Thr" }, "name", 1400);
  history = edit(history, { ...first, name: "Thr", focus: "threshold" }, null, 1500);
  assert.equal(history.past.length, 2);
  history = undo(history);
  assert.equal(history.draft.focus, undefined);
  assert.equal(history.draft.name, "Thr");
  history = undo(history);
  assert.equal(history.draft.name, "New workout");
  assert.equal(undo(history), history, "nothing before the start");
  history = redo(redo(history));
  assert.equal(history.draft.focus, "threshold");
  history = undo(history);
  history = edit(history, { ...history.draft, name: "Other" }, null, 5000);
  assert.equal(history.future.length, 0, "a new edit drops what was undone");

  let paused = startHistory(first);
  paused = edit(paused, { ...first, name: "A" }, "name", 1000);
  paused = edit(paused, { ...first, name: "AB" }, "name", 4000);
  assert.equal(paused.past.length, 2, "a pause in typing starts a new undo step");
});

test("what is wrong is placed on the step it concerns", () => {
  const workout = {
    name: "",
    sport: "cycling",
    steps: [
      at(60, 0.5),
      {
        type: "repeat",
        count: 2,
        steps: [
          {
            ...at(60, 1),
            target: { type: "power", unit: "ftp", level: { kind: "range", low: 1.1, high: 0.9 } },
          },
        ],
        cues: [{ at: { type: "time", seconds: 500 }, text: "Too late" }],
      },
    ],
  };
  const byPath = problemsByPath(problemsOf(workout));
  assert.deepEqual(
    [...byPath.keys()].toSorted(),
    ["", "1", "1.0"],
    "the name, the repeat's cue and the range",
  );
  assert.equal(byPath.get("1.0")[0].field, "target.level.high");
  assert.equal(byPath.get("")[0].field, "name");
  assert.match(byPath.get("1")[0].message, /after the repeat ends/);
});

test("changing a target's kind, unit and level keeps what can be kept", () => {
  const reference = { ...noReference("cycling"), ftp: 250 };
  const power = at(300, 0.9).target;
  assert.deepEqual(withLevelKind(power.level, "range"), { kind: "range", low: 0.85, high: 0.95 });
  assert.deepEqual(withLevelKind({ kind: "constant", value: 0.97 }, "range"), {
    kind: "range",
    low: 0.92,
    high: 1.02,
  });
  assert.deepEqual(withLevelKind({ kind: "constant", value: 250 }, "range"), {
    kind: "range",
    low: 237,
    high: 263,
  });
  assert.deepEqual(withLevelKind({ kind: "range", low: 0.8, high: 1 }, "ramp"), {
    kind: "ramp",
    from: 0.8,
    to: 1,
  });
  assert.deepEqual(withLevelKind({ kind: "ramp", from: 0.5, to: 1 }, "constant"), {
    kind: "constant",
    value: 0.75,
  });
  assert.deepEqual(withUnit(power, "watts", reference).level, { kind: "constant", value: 225 });
  assert.deepEqual(withUnit(withUnit(power, "watts", reference), "ftp", reference).level, {
    kind: "constant",
    value: 0.9,
  });
  assert.deepEqual(withTargetType(power, "heartRate"), {
    type: "heartRate",
    unit: "threshold",
    level: power.level,
  });
  assert.equal(withTargetType(power, "free"), undefined);
  assert.deepEqual(withTargetType(undefined, "maxEffort"), { type: "maxEffort" });

  const distance = withDurationType(
    { ...at(300, 0.9), cues: [{ at: { type: "time", seconds: 10 }, text: "Go" }] },
    "distance",
    1 / 3,
  );
  assert.deepEqual(distance.duration, { type: "distance", meters: 900 });
  assert.equal(distance.cues.length, 0, "a cue by time cannot stay on a step by distance");
  assert.deepEqual(newStep("swimming").duration, { type: "distance", meters: 100 });
});

test("dragging and the arrow keys on the chart change a step's level and length", () => {
  const reference = { ...noReference("cycling"), ftp: 250 };
  const steady = at(300, 0.9);
  assert.equal(withLevelShare(steady, "whole", 0.9, 1.06, reference).target.level.value, 1.06);
  const range = {
    ...steady,
    target: { ...steady.target, level: { kind: "range", low: 0.8, high: 0.9 } },
  };
  assert.deepEqual(withLevelShare(range, "whole", 0.85, 0.95, reference).target.level, {
    kind: "range",
    low: 0.9,
    high: 1,
  });
  const ramp = {
    ...steady,
    target: { ...steady.target, level: { kind: "ramp", from: 0.5, to: 0.7 } },
  };
  assert.deepEqual(withLevelShare(ramp, "to", 0.7, 0.8, reference).target.level, {
    kind: "ramp",
    from: 0.5,
    to: 0.8,
  });
  const watts = {
    ...steady,
    target: { type: "power", unit: "watts", level: { kind: "constant", value: 200 } },
  };
  assert.equal(withLevelShare(watts, "whole", 0.8, 1, reference).target.level.value, 250);
  assert.equal(
    canDragLevel(watts, noReference("cycling")),
    false,
    "watts without FTP have no scale",
  );
  assert.equal(nudgeLevel(steady, 1, false, reference).target.level.value, 0.91);
  assert.equal(nudgeLevel(steady, -1, true, reference).target.level.value, 0.85);
  assert.deepEqual(withLength(steady, 431, 0).duration, { type: "time", seconds: 435 });
  assert.deepEqual(nudgeLength(steady, 1).duration, { type: "time", seconds: 315 });
  const metres = { ...steady, duration: { type: "distance", meters: 400 } };
  assert.deepEqual(withLength(metres, 100, 4.04).duration, { type: "distance", meters: 400 });
});

test("a save writes the workout, and a later edit from another device is offered before overwriting", async () => {
  const { webApp, ride } = await signInOnTheWeb();
  const id = randomUUID();
  const draft = { name: "Threshold", sport: "cycling", steps: [at(1200, 0.95)] };
  const created = await saveWorkout(webApp, { id, workout: draft, base: null, overwrite: false });
  assert.equal(created.kind, "saved");
  assert.equal(sameWorkout(created.stored.workout, draft), true);

  await ride.workouts.put({
    id,
    workout: { ...draft, name: "Threshold from Ride" },
    updatedAt: new Date(),
  });
  const mine = { ...draft, steps: [at(1500, 0.95)] };
  const changed = await saveWorkout(webApp, {
    id,
    workout: mine,
    base: created.stored.updatedAt,
    overwrite: false,
  });
  assert.equal(changed.kind, "changed");
  assert.equal(changed.stored.name, "Threshold from Ride");
  assert.equal(
    (await webApp.workouts.get({ id })).name,
    "Threshold from Ride",
    "nothing was written",
  );

  const kept = await saveWorkout(webApp, {
    id,
    workout: mine,
    base: created.stored.updatedAt,
    overwrite: true,
  });
  assert.equal(kept.kind, "saved");
  assert.equal((await webApp.workouts.get({ id })).workout.steps[0].duration.seconds, 1500);
});

test("an edit stamped before another device's later edit loses, and the page is told which one won", async () => {
  const { webApp, ride } = await signInOnTheWeb();
  const id = randomUUID();
  const draft = { name: "Sweet spot", sport: "cycling", steps: [at(1200, 0.88)] };
  const created = await saveWorkout(webApp, {
    id,
    workout: draft,
    base: null,
    overwrite: false,
    now: minutesAgo(10),
  });
  await ride.workouts.put({
    id,
    workout: { ...draft, name: "Sweet spot, Ride" },
    updatedAt: minutesAgo(1),
  });
  const lost = await saveWorkout(webApp, {
    id,
    workout: { ...draft, name: "Sweet spot, web" },
    base: created.stored.updatedAt,
    overwrite: true,
    now: minutesAgo(2),
  });
  assert.equal(lost.kind, "overruled");
  assert.equal(lost.stored.name, "Sweet spot, Ride");
});

test("a workout deleted on another device is reported, and the draft can be kept as a new one", async () => {
  const { webApp, ride } = await signInOnTheWeb();
  const id = randomUUID();
  const draft = { name: "Openers", sport: "cycling", steps: [at(300, 0.6)] };
  const created = await saveWorkout(webApp, { id, workout: draft, base: null, overwrite: false });
  await ride.workouts.delete({ id });
  const before = await saveWorkout(webApp, {
    id,
    workout: draft,
    base: created.stored.updatedAt,
    overwrite: false,
  });
  assert.equal(before.kind, "deleted");
  const forced = await saveWorkout(webApp, {
    id,
    workout: draft,
    base: created.stored.updatedAt,
    overwrite: true,
  });
  assert.equal(forced.kind, "deleted", "a deleted workout stays deleted");
  const copy = await saveWorkout(webApp, {
    id: randomUUID(),
    workout: draft,
    base: null,
    overwrite: false,
  });
  assert.equal(copy.kind, "saved");
});

test("a draft equals what the server returns however its keys are ordered", () => {
  const draft = {
    steps: [{ duration: { seconds: 60, type: "time" }, type: "step", name: undefined }],
    sport: "cycling",
    name: "X",
  };
  assert.equal(
    sameWorkout(draft, {
      name: "X",
      sport: "cycling",
      steps: [{ type: "step", duration: { type: "time", seconds: 60 } }],
    }),
    true,
  );
  assert.equal(sameWorkout(draft, { name: "Y", sport: "cycling", steps: draft.steps }), false);
});

test("the open step stays open on the same step when it, its repeat or a neighbour moves", () => {
  assert.deepEqual(pathAfterMove([1, 2], [1], [2]), [2, 2], "a step inside a moved repeat");
  assert.deepEqual(pathAfterMove([2], [1], [2]), [1], "the neighbour a block moved past");
  assert.deepEqual(pathAfterMove([1], [2], [1]), [2]);
  assert.deepEqual(pathAfterMove([0], [1], [2]), [0], "a block the move did not reach");
  assert.deepEqual(pathAfterMove([1, 0], [1, 1], [1, 0]), [1, 1], "inside one repeat");
  assert.deepEqual(pathAfterMove([2, 0], [1, 1], [1, 0]), [2, 0], "another repeat's step");
});

test("dragging a bar's right edge lengthens it by the distance dragged, the last bar too", () => {
  assert.equal(draggedSeconds(300, 500, 560, 2), 420);
  assert.equal(draggedSeconds(300, 500, 300, 2), 1, "never shorter than a second");
  const last = withLength(at(300, 0.5), draggedSeconds(300, 900, 940, 3.3), 0);
  assert.deepEqual(last.duration, { type: "time", seconds: 435 });
});

test("Alt and left never lengthen a short step, and a drag that only moves sideways keeps the level", () => {
  const reference = { ...noReference("cycling"), ftp: 250 };
  assert.deepEqual(nudgeLength(at(1, 0.5), -1).duration, { type: "time", seconds: 1 });
  assert.deepEqual(nudgeLength(at(7, 0.5), -1).duration, { type: "time", seconds: 1 });
  const metres = { ...at(60, 0.5), duration: { type: "distance", meters: 10 } };
  assert.deepEqual(nudgeLength(metres, -1).duration, { type: "distance", meters: 1 });
  const ramp = {
    ...at(300, 0.5),
    target: { ...at(300, 0.5).target, level: { kind: "ramp", from: 0.5, to: 0.7 } },
  };
  assert.deepEqual(
    withLevelShare(ramp, "to", 0.62, 0.62, reference).target.level,
    ramp.target.level,
  );
  assert.equal(
    withLevelShare(at(300, 0.9), "whole", 0.85, 0.85, reference).target.level.value,
    0.9,
  );
});

test("a workout that expands past the limit shows the schema's problem instead of failing", () => {
  const huge = {
    name: "Too many",
    sport: "cycling",
    steps: [
      {
        type: "repeat",
        count: 1000,
        steps: [{ type: "repeat", count: 1000, steps: [at(1, 0.5)] }],
      },
    ],
  };
  const problems = problemsOf(huge);
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /at most/);
});
