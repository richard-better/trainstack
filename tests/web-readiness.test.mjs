import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { rangeKey } from "../hosted/apps/account/src/lib/calendar.ts";
import { createCalendarWrites } from "../hosted/apps/account/src/lib/calendar-writes.ts";
import {
  actionWords,
  easySwapFor,
  gapLines,
  headlineOf,
  readinessKey,
  readinessQueryKey,
  reasonLines,
  restFrom,
  swapForEasy,
  swapSkipReason,
  unmeasuredLine,
} from "../hosted/apps/account/src/lib/readiness.ts";
import { mockApple } from "./helpers/apple.mjs";
import { migrate, rpcClient, startWorker } from "./helpers/worker.mjs";

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
  const { token } = await apple.signIn(runtime, { email: `${randomUUID()}@example.com` });
  const client = rpcClient(runtime, { token });
  await client.settings.setTimeZone({ timeZone: "UTC" });
  await client.settings.write({
    writes: [
      {
        day: "2026-01-01",
        change: { kind: "threshold", sport: null, threshold: "ftp", value: 200 },
        updatedAt: new Date(Date.now() - 60_000),
      },
    ],
  });
  const { today } = await client.readiness.range({ from: "2026-01-01", through: "2026-01-01" });
  return { client, today };
}

const normal = { sleep: 3, energy: 3, soreness: 3, stress: 3, mood: 3 };
const checkIn = (day, ratings = {}, extra = {}) => ({
  day,
  ratings: { ...normal, ...ratings },
  illness: null,
  injury: null,
  note: null,
  ...extra,
  updatedAt: new Date(),
});

const threshold = (minutes = 60) => ({
  kind: "workout",
  workout: {
    name: "Threshold hour",
    sport: "cycling",
    steps: [
      {
        type: "step",
        duration: { type: "time", seconds: minutes * 60 },
        target: { type: "power", unit: "ftp", level: { kind: "constant", value: 0.95 } },
      },
    ],
  },
  source: null,
  notes: null,
});

const plan = (client, day, content = threshold(), position = 1) =>
  client.plannedWorkouts.put({ id: randomUUID(), day, position, content, updatedAt: new Date() });

function device(client, day) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const writes = createCalendarWrites({
    queryClient,
    api: { calendar: client.calendar, plannedWorkouts: client.plannedWorkouts },
    retryDelays: [5],
    whenOnline: () => () => {},
  });
  const load = () =>
    queryClient.fetchQuery({
      queryKey: rangeKey(day, day),
      queryFn: () => client.calendar.range({ from: day, through: day }),
    });
  return { queryClient, writes, load };
}

const readinessOn = async (client, day) =>
  (await client.readiness.range({ from: day, through: day })).days[0];

test("a poor night reads as fair, says why first, and what it did not read", async () => {
  const { client, today } = await athlete();
  await client.checkIns.put(checkIn(today, { sleep: 1 }));
  const readiness = await readinessOn(client, today);
  assert.deepEqual(headlineOf(readiness), {
    title: "Fair",
    line: "Some strain. Go easier on the hard parts.",
  });
  assert.deepEqual(reasonLines(readiness), [
    { effect: "lowers", text: "Sleep: Hardly slept, against normal" },
    { effect: "steady", text: "Energy, soreness, stress and mood as usual" },
  ]);
  assert.deepEqual(gapLines(readiness), [
    "0 of 7 check-ins in the last four weeks: until there are 7, your answers are read against normal rather than your own usual.",
    "No training yet, so this comes from your check-in alone.",
  ]);
  assert.match(unmeasuredLine, /sleep, resting heart rate and HRV/);
});

test("illness says rest in the athlete's own terms, and nothing at all says so plainly", async () => {
  const { client, today } = await athlete();
  assert.deepEqual(headlineOf(await readinessOn(client, today)), {
    title: "Not enough to go on",
    line: "Check in, and readiness reads your answers against your usual.",
  });
  await client.checkIns.put(checkIn(today, {}, { illness: { kind: "fever" } }));
  const ill = await readinessOn(client, today);
  assert.deepEqual(headlineOf(ill), { title: "Poor", line: "You said you are ill. Rest today." });
  assert.deepEqual(reasonLines(ill)[0], {
    effect: "lowers",
    text: "Ill: fever or aching all over",
  });
});

test("swapping a hard session for easy skips it with its reason and plans an easy ride after it", async () => {
  const { client, today } = await athlete();
  const hard = await plan(client, today);
  await client.checkIns.put(checkIn(today, { sleep: 1, energy: 1, soreness: 2 }));
  const before = await readinessOn(client, today);
  assert.equal(before.level, "low");
  assert.deepEqual(
    before.suggestions.map(({ plannedId, action }) => [plannedId, action]),
    [[hard.id, "swap_easy"]],
  );
  assert.equal(actionWords.swap_easy.title, "Swap for easy");

  const { writes, load } = device(client, today);
  const range = await load();
  const easyId = randomUUID();
  await swapForEasy(writes, hard, range.days[0].planned, today, easyId);

  const [skipped, easy] = (await client.calendar.range({ from: today, through: today })).days[0]
    .planned;
  assert.equal(skipped.id, hard.id);
  assert.deepEqual(skipped.skipped, { reason: swapSkipReason });
  assert.equal(easy.id, easyId);
  assert.ok(easy.position > skipped.position);
  assert.equal(easy.content.workout.name, "Easy ride");
  assert.equal(easy.planned.seconds, 3600);
  assert.ok(easy.planned.load < 50, `${easy.planned.load}`);

  const after = await readinessOn(client, today);
  assert.deepEqual(
    after.suggestions.map(({ plannedId, intensity, action }) => [plannedId, intensity, action]),
    [[easyId, "easy", "as_planned"]],
    "the skipped session drops out, and the easy one is fine as planned",
  );
});

test("resting skips the session with the day's readiness as the reason, and it can be undone", async () => {
  const { client, today } = await athlete();
  const hard = await plan(client, today);
  await client.checkIns.put(checkIn(today, {}, { injury: { area: "knee", training: "none" } }));
  const readiness = await readinessOn(client, today);
  assert.equal(readiness.suggestions[0].action, "rest");
  const { writes, load } = device(client, today);
  await load();
  await restFrom(writes, hard, readiness);
  const stored = await client.plannedWorkouts.get({ id: hard.id });
  assert.deepEqual(stored.skipped, { reason: "Rest on a poor readiness day" });
  assert.deepEqual((await readinessOn(client, today)).suggestions, []);
  await writes.skip(stored, null);
  assert.equal((await readinessOn(client, today)).suggestions[0].plannedId, hard.id);
});

test("an easy swap keeps the sport, lasts at most an hour, and a note or rest day has none", () => {
  const item = (content, seconds) => ({
    id: randomUUID(),
    day: "2030-03-04",
    position: 1,
    content,
    planned: { seconds, meters: null, load: null },
  });
  const run = {
    kind: "workout",
    workout: { name: "Long run", sport: "running", steps: [] },
    source: null,
    notes: null,
  };
  const swapped = easySwapFor(item(run, 2 * 3600));
  assert.equal(swapped.workout.sport, "running");
  assert.equal(swapped.workout.name, "Easy run");
  assert.equal(swapped.workout.steps[0].duration.seconds, 3600);
  assert.equal(swapped.notes, "Instead of Long run, on a low readiness day.");
  assert.equal(easySwapFor(item(threshold(40), 40 * 60)).workout.steps[0].duration.seconds, 2400);
  assert.equal(easySwapFor(item({ kind: "rest", notes: null }, null)), null);
});

test("a change to the calendar makes the readiness on screen stale, so it is read again", async () => {
  const { client, today } = await athlete();
  const hard = await plan(client, today);
  const { queryClient, writes, load } = device(client, today);
  await load();
  const key = readinessQueryKey(today, today);
  await queryClient.fetchQuery({
    queryKey: key,
    queryFn: () => client.readiness.range({ from: today, through: today }),
  });
  assert.equal(queryClient.getQueryState(key).isInvalidated, false);
  await writes.skip(hard, { reason: "Busy" });
  await writes.settled();
  assert.equal(queryClient.getQueryState(key).isInvalidated, true);
  assert.deepEqual(key.slice(0, 1), [...readinessKey]);
});
