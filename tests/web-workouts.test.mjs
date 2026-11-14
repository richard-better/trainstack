import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { MAX_WORKOUT_FILE_BYTES } from "@trainstack/contract";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { profileOn } from "@trainstack/zones";
import {
  appendedTo,
  durationFilter,
  emptyLibrary,
  exportWorkout,
  forgetIn,
  importWorkoutFile,
  isBehind,
  placementFor,
  readWorkoutFile,
  refreshLibrary,
  rememberIn,
} from "../hosted/apps/account/src/lib/library.ts";
import { datedChanges, put } from "../hosted/apps/account/src/lib/settings.ts";
import {
  durationText,
  formatSpan,
  noReference,
  overviewOf,
  referenceFor,
  targetText,
} from "../hosted/apps/account/src/lib/workout-profile.ts";
import { mockApple } from "./helpers/apple.mjs";
import { signInOnTheWeb as signInWithApple } from "./helpers/web.mjs";
import { migrate, startWorker } from "./helpers/worker.mjs";

const FIXTURES = "packages/workout/test/fixtures";

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

const power = (seconds, level, unit = "ftp") => ({
  type: "step",
  duration: { type: "time", seconds },
  target: { type: "power", unit, level },
});
const constant = (value) => ({ kind: "constant", value });

const workout = (name, steps, extra = {}) => ({ name, sport: "cycling", steps, ...extra });

const fixture = async (name) => new File([await readFile(`${FIXTURES}/${name}`)], name);

async function referenceOf(webApp, sport) {
  const history = await webApp.settings.history({});
  return referenceFor(profileOn(datedChanges(history.entries), "2026-11-14"), sport);
}

test("the web keeps a copy of the library and catches up when another device writes", async () => {
  const { webApp, ride } = await signInOnTheWeb();
  const first = randomUUID();
  const second = randomUUID();
  await webApp.workouts.put({
    id: first,
    workout: workout("Openers", [power(600, constant(0.6))]),
    updatedAt: minutesAgo(5),
  });
  await webApp.workouts.put({
    id: second,
    workout: workout("Sweet spot", [power(1200, constant(0.9))]),
    updatedAt: minutesAgo(5),
  });
  const library = await refreshLibrary(webApp, emptyLibrary);
  assert.deepEqual(Object.keys(library.workouts).toSorted(), [first, second].toSorted());

  await ride.workouts.put({
    id: first,
    workout: workout("Openers, longer", [power(900, constant(0.6))]),
    updatedAt: minutesAgo(1),
  });
  await ride.workouts.delete({ id: second });
  const { workouts: summaries } = await webApp.workouts.list({});
  assert.equal(isBehind(library, summaries), true, "the list shows an edit the copy lacks");

  const caughtUp = await refreshLibrary(webApp, library);
  assert.deepEqual(Object.keys(caughtUp.workouts), [first]);
  assert.equal(caughtUp.workouts[first].name, "Openers, longer");
  assert.equal(isBehind(caughtUp, summaries), false);
});

test("a workout's profile is drawn in the athlete's power zones once FTP is set", async () => {
  const { webApp } = await signInOnTheWeb();
  const steps = [
    power(600, { kind: "ramp", from: 0.5, to: 1 }),
    power(1200, constant(1.05)),
    power(600, { kind: "range", low: 0.55, high: 0.65 }),
  ];
  const before = overviewOf({ steps }, noReference("cycling"));
  assert.deepEqual(
    before.segments.map((segment) => segment.zone?.label),
    ["3", "5", "2"],
    "without settings, zones are estimated from shares of FTP",
  );
  assert.equal(targetText(steps[1].target, noReference("cycling")).detail, null);

  await webApp.settings.write({
    writes: [put("2026-01-01", { kind: "threshold", sport: null, threshold: "ftp", value: 250 })],
  });
  const reference = await referenceOf(webApp, "cycling");
  const overview = overviewOf({ steps }, reference);
  assert.equal(reference.ftp, 250);
  assert.deepEqual(
    overview.segments.map((segment) => [segment.shape, segment.zone?.label]),
    [
      ["ramp", "2"],
      ["level", "4"],
      ["range", "2"],
    ],
  );
  assert.deepEqual(targetText(steps[0].target, reference), {
    main: "50% to 100% FTP",
    detail: "125 to 250 W",
  });
  assert.deepEqual(targetText(steps[2].target, reference), {
    main: "55-65% FTP",
    detail: "138-163 W",
  });
  assert.equal(overview.seconds, 2400);
  assert.equal(overview.load.score, Math.round(((600 * 7) / 12 + 1200 * 1.1025 + 600 * 0.36) / 36));
  assert.equal(overview.averagePower, Math.round((600 * 187.5 + 1200 * 262.5 + 600 * 150) / 2400));
});

test("a step in watts reads as a share of FTP, and without FTP keeps its watts", async () => {
  const step = power(300, constant(300), "watts");
  assert.deepEqual(targetText(step.target, noReference("cycling")), {
    main: "300 W",
    detail: null,
  });
  const overview = overviewOf({ steps: [step] }, noReference("cycling"));
  assert.equal(overview.load, null, "no load without FTP");
  assert.equal(overview.segments[0].scaled, true);
  const withFtp = { ...noReference("cycling"), ftp: 250 };
  assert.deepEqual(targetText(step.target, withFtp), { main: "300 W", detail: "120% FTP" });
  assert.equal(overviewOf({ steps: [step] }, withFtp).segments[0].from, 1.2);
});

test("a distance step's time comes from its pace and the athlete's threshold pace", async () => {
  const { webApp } = await signInOnTheWeb();
  await webApp.settings.write({
    writes: [
      put("2026-01-01", { kind: "sport", sport: "running", listed: true }),
      put("2026-01-01", {
        kind: "threshold",
        sport: "running",
        threshold: "threshold_pace",
        value: 240,
      }),
    ],
  });
  const reference = await referenceOf(webApp, "running");
  const kilometre = {
    type: "step",
    duration: { type: "distance", meters: 1000 },
    target: { type: "pace", unit: "threshold", level: constant(0.8) },
  };
  const overview = overviewOf({ steps: [kilometre] }, reference);
  assert.equal(Math.round(overview.seconds), 300);
  assert.equal(overview.estimated, true);
  assert.equal(overview.meters, 1000);
  assert.deepEqual(targetText(kilometre.target, reference), {
    main: "80% threshold pace",
    detail: "5:00 /km",
  });
  assert.equal(durationText(kilometre), "1 km");
  assert.equal(formatSpan(5430), "1 h 30 min 30 s");
});

test("repeats expand into the profile, each round its own segment of the same step", () => {
  const overview = overviewOf(
    {
      steps: [
        {
          type: "repeat",
          count: 3,
          steps: [
            power(120, constant(1.1)),
            { type: "repeat", count: 2, steps: [power(30, constant(0.5))] },
          ],
        },
      ],
    },
    noReference("cycling"),
  );
  assert.equal(overview.segments.length, 9);
  assert.equal(overview.seconds, 3 * (120 + 60));
  assert.deepEqual(
    overview.segments.slice(0, 3).map((segment) => segment.path.join(".")),
    ["0.0", "0.1.0", "0.1.0"],
  );
  assert.equal(new Set(overview.segments.map((segment) => segment.key)).size, 9);
});

test("the duration filter finds workouts by the server's buckets", async () => {
  const { webApp } = await signInOnTheWeb();
  for (const minutes of [30, 60, 100]) {
    await webApp.workouts.put({
      id: randomUUID(),
      workout: workout(`${minutes} minutes`, [power(minutes * 60, constant(0.7))]),
      updatedAt: new Date(),
    });
  }
  const names = async (bucket) =>
    (await webApp.workouts.list({ ...durationFilter(bucket), sort: "duration" })).workouts.map(
      (summary) => summary.name,
    );
  assert.deepEqual(await names("short"), ["30 minutes"]);
  assert.deepEqual(await names("medium"), ["60 minutes"]);
  assert.deepEqual(await names("long"), ["100 minutes"]);
  assert.deepEqual(await names(undefined), ["30 minutes", "60 minutes", "100 minutes"]);
});

test("a list is reordered by placing a workout after the one it lands behind", async () => {
  const { webApp } = await signInOnTheWeb();
  const ids = [];
  for (const name of ["A", "B", "C", "D"]) {
    const id = randomUUID();
    ids.push(id);
    await webApp.workouts.put({
      id,
      workout: workout(name, [power(600, constant(0.6))]),
      updatedAt: new Date(),
    });
  }
  let list = await webApp.workoutLists.put({
    id: randomUUID(),
    name: "Week",
    updatedAt: new Date(),
  });
  for (const id of ids) {
    list = await webApp.workoutLists.place({
      id: list.id,
      ...appendedTo(list, id),
      updatedAt: new Date(),
    });
  }
  assert.deepEqual(list.workoutIds, ids);

  const moves = [
    [3, 0],
    [0, 2],
    [1, 3],
    [2, 1],
  ];
  for (const [from, to] of moves) {
    const expected = list.workoutIds.filter((_, index) => index !== from);
    expected.splice(to, 0, list.workoutIds[from]);
    list = await webApp.workoutLists.place({
      id: list.id,
      ...placementFor(list.workoutIds, from, to),
      updatedAt: new Date(),
    });
    assert.deepEqual(list.workoutIds, expected, `moving ${from} to ${to}`);
  }
  assert.equal(placementFor(list.workoutIds, 1, 1), null);
  assert.equal(placementFor(list.workoutIds, 0, 4), null);

  list = await webApp.workoutLists.remove({
    id: list.id,
    workoutId: ids[0],
    updatedAt: new Date(),
  });
  assert.equal(list.workoutIds.includes(ids[0]), false);
});

test("an imported file shows the reader's warnings before saving, the same the server gives", async () => {
  const { webApp } = await signInOnTheWeb();
  for (const name of [
    "sweet-spot.erg",
    "over-unders.mrc",
    "tempo-run.zwo",
    "threshold-builder.zwo",
  ]) {
    const file = await fixture(name);
    const reading = await readWorkoutFile(file, MAX_WORKOUT_FILE_BYTES);
    assert.equal(reading.kind, "ready", name);
    const saved = await importWorkoutFile(webApp, file);
    assert.equal(saved.kind, "saved", name);
    assert.deepEqual(saved.workout.workout, reading.workout, name);
    assert.deepEqual(
      saved.warnings.map((warning) => warning.message),
      reading.warnings.map((warning) => warning.message),
      name,
    );
  }
  const erg = await readWorkoutFile(await fixture("sweet-spot.erg"), MAX_WORKOUT_FILE_BYTES);
  assert.ok(erg.warnings.length > 0, "the .erg file's FTP header is reported");
});

test("a file that is not a workout is refused in the browser and by the server, with why", async () => {
  const { webApp } = await signInOnTheWeb();
  const wrongKind = await readWorkoutFile(new File(["x"], "ride.fit"), MAX_WORKOUT_FILE_BYTES);
  assert.equal(wrongKind.kind, "refused");
  const tooLarge = await readWorkoutFile(new File(["x".repeat(2048)], "big.zwo"), 1024);
  assert.equal(tooLarge.kind, "refused");
  assert.match(tooLarge.issues[0].message, /at most 1 KB/);

  const broken = new File(["<workout_file><workout>"], "broken.zwo");
  const reading = await readWorkoutFile(broken, MAX_WORKOUT_FILE_BYTES);
  assert.equal(reading.kind, "refused");
  assert.ok(reading.issues.length > 0);
  const refused = await importWorkoutFile(webApp, broken);
  assert.equal(refused.kind, "refused");
  assert.ok(refused.issues.length > 0);
  assert.deepEqual((await webApp.workouts.list({})).workouts, []);
});

test("export writes power in watts with the athlete's FTP, and says why it cannot without", async () => {
  const { webApp } = await signInOnTheWeb();
  const id = randomUUID();
  await webApp.workouts.put({
    id,
    workout: workout("Two by twenty", [power(1200, constant(0.9)), power(1200, constant(0.9))], {
      description: "Steady",
    }),
    updatedAt: new Date(),
  });

  const refused = await exportWorkout(webApp, { kind: "own", id }, "erg", null);
  assert.equal(refused.kind, "refused");
  assert.ok(refused.issues.some((issue) => /FTP/i.test(issue.message)));

  const erg = await exportWorkout(webApp, { kind: "own", id }, "erg", 250);
  assert.equal(erg.kind, "file");
  assert.match(erg.file.text, /225/);
  const zwo = await exportWorkout(webApp, { kind: "own", id }, "zwo", null);
  assert.equal(zwo.kind, "file");
  assert.equal(zwo.file.fileName.endsWith(".zwo"), true);

  const builtin = await exportWorkout(
    webApp,
    { kind: "builtin", id: "threshold-classic-60" },
    "mrc",
    null,
  );
  assert.equal(builtin.kind, "file");
  assert.match(builtin.file.text, /PERCENT/);
});

test("a copied built-in workout is the athlete's own, with the same steps", async () => {
  const { webApp } = await signInOnTheWeb();
  const builtin = await webApp.builtinWorkouts.get({ id: "over-unders-2x10" });
  const copy = await webApp.builtinWorkouts.copy({
    id: builtin.id,
    as: randomUUID(),
    updatedAt: new Date(),
  });
  assert.deepEqual(copy.workout, builtin.workout);
  assert.deepEqual(copy.origin, { kind: "builtin", id: builtin.id });
  const library = await refreshLibrary(webApp, emptyLibrary);
  assert.equal(library.workouts[copy.id].name, builtin.name);
});

test("a workout saved while the library is being read stays in it when the read lands", async () => {
  const { webApp } = await signInOnTheWeb();
  const queryClient = new QueryClient();
  const queryKey = ["library"];
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let reads = 0;
  const slowFirstRead = {
    workouts: {
      changes: async (input) => {
        reads += 1;
        const answer = await webApp.workouts.changes(input);
        if (reads === 1) await held;
        return answer;
      },
    },
  };
  const observer = new QueryObserver(queryClient, {
    queryKey,
    queryFn: () =>
      refreshLibrary(slowFirstRead, queryClient.getQueryData(queryKey) ?? emptyLibrary),
  });
  const unsubscribe = observer.subscribe(() => {});
  while (reads === 0) await new Promise((resolve) => setTimeout(resolve, 5));
  await new Promise((resolve) => setTimeout(resolve, 50));

  const id = randomUUID();
  const saved = await webApp.workouts.put({
    id,
    workout: workout("Saved meanwhile", [power(600, constant(0.6))]),
    updatedAt: new Date(),
  });
  await rememberIn(queryClient, queryKey, saved);
  release();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(queryClient.getQueryData(queryKey).workouts[id]?.name, "Saved meanwhile");

  await webApp.workouts.delete({ id });
  await forgetIn(queryClient, queryKey, id);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(queryClient.getQueryData(queryKey).workouts[id], undefined);
  unsubscribe();
  queryClient.clear();
});

test("trying an import again after a lost answer saves the same workout, not a second one", async () => {
  const { webApp } = await signInOnTheWeb();
  const file = await fixture("sweet-spot.erg");
  const id = randomUUID();
  await importWorkoutFile(webApp, file, id);
  const again = await importWorkoutFile(webApp, file, id);
  assert.equal(again.kind, "saved");
  assert.deepEqual(
    (await webApp.workouts.list({})).workouts.map((summary) => summary.id),
    [id],
  );
});
