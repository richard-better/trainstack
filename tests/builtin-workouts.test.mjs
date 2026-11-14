import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isDefinedError, safe } from "@orpc/client";
import { mockApple } from "./helpers/apple.mjs";
import { api, migrate, rpcClient, startWorker } from "./helpers/worker.mjs";

let worker;
let runtime;
const apple = mockApple();

before(
  async () => {
    worker = await startWorker({ outboundService: apple.fetch });
    runtime = worker.runtime;
    await migrate(runtime);
  },
  { timeout: 60_000 },
);

after(async () => {
  await worker?.dispose();
});

async function athlete() {
  const signedIn = await apple.signIn(runtime, { email: `${randomUUID()}@example.com` });
  return { ...signedIn, client: rpcClient(runtime, { token: signedIn.token }) };
}

const at = (minute) => new Date(Date.UTC(2026, 10, 13, 9, minute));

test("every athlete reads Ride's eleven bundled workouts, in the app's order", async () => {
  const { client } = await athlete();
  const { workouts } = await client.builtinWorkouts.list({});
  assert.deepEqual(
    workouts.map((workout) => [workout.id, workout.name, workout.focus, workout.totals.seconds]),
    [
      ["zone-3-3x10", "Zone 3 · 3×10", "tempo", 3240],
      ["threshold-waves-3x12", "Threshold waves 3×12", "threshold", 3600],
      ["ramp-openers-30", "Ramp openers 30", "vo2Max", 1800],
      ["over-unders-2x10", "Over-unders 2×10", "threshold", 3960],
      ["long-endurance-90", "Long endurance 90", "endurance", 5400],
      ["vo2-max-booster", "VO2 max booster", "vo2Max", 3600],
      ["tabata-4x40-20", "Tabata 4×40/20", "anaerobic", 1980],
      ["recovery-30", "Recovery 30", "endurance", 1800],
      ["threshold-classic-60", "Threshold classic 60", "threshold", 3600],
      ["pixel-sprints-30", "Pixel sprints 30", "endurance", 1800],
      ["quick-test-45s", "Quick test 45s", "vo2Max", 45],
    ],
  );
  assert.ok(workouts.every((workout) => workout.sport === "cycling" && workout.description));

  const tabata = await client.builtinWorkouts.get({ id: "tabata-4x40-20" });
  assert.equal(tabata.workout.name, "Tabata 4×40/20");
  assert.deepEqual(tabata.workout.steps.slice(4, 6), [
    {
      type: "step",
      duration: { type: "time", seconds: 40 },
      target: { type: "power", unit: "ftp", level: { kind: "constant", value: 1.7 } },
      cues: [{ at: { type: "time", seconds: 0 }, text: "Sprint 1 of 4. All out" }],
    },
    {
      type: "step",
      duration: { type: "time", seconds: 20 },
      target: { type: "power", unit: "ftp", level: { kind: "constant", value: 0.4 } },
    },
  ]);

  const [missing] = await safe(client.builtinWorkouts.get({ id: "no-such-workout" }));
  assert.ok(isDefinedError(missing));
  assert.equal(missing.code, "NOT_FOUND");

  const anonymous = await runtime.dispatchFetch(`${api}/api-reference/builtin-workouts`);
  assert.equal(anonymous.status, 401);
});

test("built-in workouts are searched and sorted the same way as the athlete's own", async () => {
  const { client } = await athlete();
  const ids = async (input) => (await client.builtinWorkouts.list(input)).workouts.map((w) => w.id);
  assert.deepEqual(await ids({ query: "THRESHOLD FTP" }), [
    "threshold-waves-3x12",
    "threshold-classic-60",
  ]);
  assert.deepEqual(await ids({ query: "3x10" }), ["zone-3-3x10"]);
  assert.deepEqual(
    await ids({ query: "legs race" }),
    ["ramp-openers-30"],
    "descriptions are searched",
  );
  assert.deepEqual(await ids({ focus: "anaerobic" }), ["tabata-4x40-20"]);
  assert.deepEqual(await ids({ sport: "running" }), []);
  assert.deepEqual(await ids({ maxSeconds: 1799 }), ["quick-test-45s"]);
  assert.deepEqual(await ids({ minSeconds: 3601 }), ["over-unders-2x10", "long-endurance-90"]);
  assert.deepEqual((await ids({ sort: "name" })).slice(0, 3), [
    "long-endurance-90",
    "over-unders-2x10",
    "pixel-sprints-30",
  ]);
  assert.deepEqual((await ids({ sort: "duration" })).slice(0, 2), [
    "quick-test-45s",
    "pixel-sprints-30",
  ]);

  const own = await client.workouts.put({
    id: randomUUID(),
    workout: (await client.builtinWorkouts.get({ id: "zone-3-3x10" })).workout,
    updatedAt: at(0),
  });
  assert.deepEqual(
    (await client.workouts.list({ query: "3x10" })).workouts.map((w) => w.id),
    [own.id],
  );
});

test("an athlete copies a built-in workout into their own and changes the copy, never the original", async () => {
  const { client } = await athlete();
  const id = randomUUID();
  const builtin = await client.builtinWorkouts.get({ id: "recovery-30" });
  const copy = await client.builtinWorkouts.copy({ id: "recovery-30", as: id, updatedAt: at(0) });
  assert.equal(copy.id, id);
  assert.deepEqual(copy.workout, builtin.workout);
  assert.deepEqual(copy.origin, { kind: "builtin", id: "recovery-30" });
  assert.deepEqual(
    await client.builtinWorkouts.copy({ id: "recovery-30", as: id, updatedAt: at(0) }),
    copy,
  );

  const changed = await client.workouts.put({
    id,
    workout: { ...copy.workout, name: "My recovery" },
    updatedAt: at(1),
  });
  assert.equal(changed.name, "My recovery");
  assert.deepEqual(
    changed.origin,
    { kind: "builtin", id: "recovery-30" },
    "an edit keeps the origin",
  );
  assert.deepEqual(await client.builtinWorkouts.get({ id: "recovery-30" }), builtin);

  const other = await athlete();
  assert.deepEqual(await other.client.builtinWorkouts.get({ id: "recovery-30" }), builtin);
  assert.deepEqual((await other.client.workouts.list({})).workouts, []);

  await client.workouts.delete({ id });
  const [refused] = await safe(
    client.builtinWorkouts.copy({ id: "recovery-30", as: id, updatedAt: at(2) }),
  );
  assert.equal(refused.code, "WORKOUT_DELETED");
});

test("a built-in workout comes out in each format", async () => {
  const { client } = await athlete();
  const zwo = await client.builtinWorkouts.export({ id: "zone-3-3x10", format: "zwo" });
  assert.equal(zwo.fileName, "zone-3-3x10.zwo");
  assert.match(zwo.text, /<name>Zone 3 · 3×10<\/name>/);
  const erg = await client.builtinWorkouts.export({ id: "zone-3-3x10", format: "erg", ftp: 200 });
  assert.match(erg.text, /^0\t100\n6\t100\n6\t130$/m, "50% then 65% of 200 W");
  const [noFtp] = await safe(client.builtinWorkouts.export({ id: "zone-3-3x10", format: "erg" }));
  assert.equal(noFtp.code, "WORKOUT_FORMAT_ERROR");
});
