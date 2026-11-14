import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isDefinedError, safe } from "@orpc/client";
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
  const signedIn = await apple.signIn(runtime, { email: `${randomUUID()}@example.com` });
  const client = rpcClient(runtime, { token: signedIn.token });
  const { today } = await client.readiness.range({ from: "2026-01-01", through: "2026-01-01" });
  return { ...signedIn, client, today };
}

const at = (minute) => new Date(Date.UTC(2026, 10, 13, 9, minute));
const shifted = (day, days) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const measured = (day, values = {}, updatedAt = at(0)) => ({
  day,
  source: "apple_health",
  sleepSeconds: 7.5 * 3600,
  restingHeartRateBpm: 50,
  hrvMs: 62,
  ...values,
  updatedAt,
});

const everything = (client) =>
  client.healthDays.range({ from: "2026-01-01", through: "2026-12-31" }).then((r) => r.days);

test("a device stores measured days, and the later read of a day wins", async () => {
  const { client } = await athlete();
  const first = measured("2026-03-02");
  assert.deepEqual(await client.healthDays.put({ days: [first] }), { days: [first] });

  const stale = measured("2026-03-02", { sleepSeconds: 3600 }, new Date(at(0).getTime() - 1));
  assert.deepEqual(
    await client.healthDays.put({ days: [stale] }),
    { days: [first] },
    "a stale device learns what won",
  );
  const later = measured("2026-03-02", { hrvMs: 70, restingHeartRateBpm: null }, at(5));
  const nextDay = measured("2026-03-03");
  assert.deepEqual(await client.healthDays.put({ days: [nextDay, later] }), {
    days: [later, nextDay],
  });
  assert.deepEqual(await everything(client), [later, nextDay]);
});

test("a write from the future is refused, and one athlete never sees another's days", async () => {
  const ada = await athlete();
  const grace = await athlete();
  await ada.client.healthDays.put({ days: [measured("2026-03-02")] });
  const [error] = await safe(
    grace.client.healthDays.put({
      days: [measured("2026-03-02", {}, new Date(Date.now() + 3_600_000))],
    }),
  );
  assert.ok(isDefinedError(error));
  assert.equal(error.code, "EDITED_IN_THE_FUTURE");
  assert.deepEqual(await everything(grace.client), []);
});

test("a day sent twice in one write is refused", async () => {
  const { client } = await athlete();
  const [error] = await safe(
    client.healthDays.put({ days: [measured("2026-03-02"), measured("2026-03-02")] }),
  );
  assert.equal(error?.status, 400);
});

test("a bad night lowers readiness, and readiness says what it measured", async () => {
  const { client, today } = await athlete();
  const days = [];
  for (let back = 30; back >= 1; back--) {
    days.push(
      measured(shifted(today, -back), {
        sleepSeconds: 7.5 * 3600 + (back % 3) * 600,
        restingHeartRateBpm: 49 + (back % 3),
        hrvMs: 60 + (back % 5),
      }),
    );
  }
  await client.healthDays.put({ days });
  const usualNight = measured(today);
  await client.healthDays.put({ days: [usualNight] });
  const before = (await client.readiness.range({ from: today, through: today })).days[0];
  assert.deepEqual(
    before.reasons
      .filter(({ kind }) => kind === "measured")
      .map(({ item, effect }) => [item, effect]),
    [
      ["sleep", "steady"],
      ["resting_heart_rate", "steady"],
      ["hrv", "steady"],
    ],
  );
  assert.deepEqual(before.basis.unmeasured, []);

  await client.healthDays.put({
    days: [
      measured(today, { sleepSeconds: 4.3 * 3600, restingHeartRateBpm: 61, hrvMs: 31 }, at(1)),
    ],
  });
  const after = (await client.readiness.range({ from: today, through: today })).days[0];
  assert.equal(after.level, "fair");
  assert.deepEqual(
    after.reasons
      .filter(({ kind }) => kind === "measured")
      .map(({ item, weight }) => [item, weight]),
    [
      ["sleep", 2],
      ["resting_heart_rate", 2],
      ["hrv", 2],
    ],
  );
});

test("measured values never reach the logs", async () => {
  const { client } = await athlete();
  const written = [];
  const write = process.stdout.write.bind(process.stdout);
  const writeError = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk, ...rest) => {
    written.push(String(chunk));
    return write(chunk, ...rest);
  };
  process.stderr.write = (chunk, ...rest) => {
    written.push(String(chunk));
    return writeError(chunk, ...rest);
  };
  try {
    await client.healthDays.put({
      days: [
        measured("2026-04-01", { sleepSeconds: 27_183, restingHeartRateBpm: 47.31, hrvMs: 83.77 }),
      ],
    });
    await client.healthDays.range({ from: "2026-04-01", through: "2026-04-01" });
    await new Promise((resolve) => setTimeout(resolve, 200));
  } finally {
    process.stdout.write = write;
    process.stderr.write = writeError;
  }
  const logs = written.join("");
  assert.match(logs, /healthDays\/put/, "the request itself is logged");
  for (const value of ["27183", "47.31", "83.77"]) assert.ok(!logs.includes(value), value);
});
