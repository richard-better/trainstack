import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isDefinedError, safe } from "@orpc/client";
import { mockApple } from "./helpers/apple.mjs";
import { api, migrate, rpcClient, send, startWorker } from "./helpers/worker.mjs";

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

const todayIn = (timeZone) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
const shifted = (day, days) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const normal = { sleep: 3, energy: 3, soreness: 3, stress: 3, mood: 3 };

const checkIn = (day, { updatedAt = at(0), ...answers } = {}) => ({
  day,
  ratings: normal,
  illness: null,
  injury: null,
  note: null,
  ...answers,
  updatedAt,
});

const removal = (day, updatedAt = at(0)) => ({ day, updatedAt });

async function definedError(promise, code) {
  const [error] = await safe(promise);
  assert.ok(isDefinedError(error), `expected ${code}, got ${error}`);
  assert.equal(error.code, code);
  return error;
}

const everything = (client) =>
  client.checkIns.range({ from: "2026-01-01", through: "2026-12-31" }).then((r) => r.checkIns);

test("an athlete checks in for a day with ratings, illness, injury and a note, and edits it", async () => {
  const { client } = await athlete();
  const written = checkIn("2026-03-02", {
    ratings: { sleep: 2, energy: 1, soreness: 4, stress: null, mood: 5 },
    illness: { kind: "respiratory" },
    injury: { area: "knee", training: "reduced" },
    note: "  Sniffles, knee niggle on the stairs  ",
  });
  const held = await client.checkIns.put(written);
  assert.deepEqual(held, {
    day: "2026-03-02",
    checkIn: { ...written, note: "Sniffles, knee niggle on the stairs" },
  });

  const edited = checkIn("2026-03-02", { ratings: normal, updatedAt: at(1) });
  assert.deepEqual((await client.checkIns.put(edited)).checkIn, edited);
  assert.deepEqual(
    await everything(client),
    [edited],
    "one check-in per day, the edit replaces it",
  );
});

test("the range gives only days with a check-in, earliest first, with today in the athlete's time zone", async () => {
  const { client } = await athlete();
  await client.settings.setTimeZone({ timeZone: "Pacific/Kiritimati" });
  const today = todayIn("Pacific/Kiritimati");
  for (const day of [today, shifted(today, -3), shifted(today, -10)]) {
    await client.checkIns.put(checkIn(day));
  }
  const range = await client.checkIns.range({ from: shifted(today, -5), through: today });
  assert.equal(range.today, today);
  assert.deepEqual(
    range.checkIns.map((entry) => entry.day),
    [shifted(today, -3), today],
  );
});

test("a check-in is for today or before it, by the athlete's time zone", async () => {
  const { client } = await athlete();
  await client.settings.setTimeZone({ timeZone: "Pacific/Pago_Pago" });
  const today = todayIn("Pacific/Pago_Pago");
  await client.checkIns.put(checkIn(today));
  await client.checkIns.put(checkIn(shifted(today, -400)));
  await definedError(client.checkIns.put(checkIn(shifted(today, 1))), "DAY_NOT_YET");

  await client.settings.setTimeZone({ timeZone: "Pacific/Kiritimati" });
  await client.checkIns.put(checkIn(shifted(today, 1)));
});

test("an edit stamped later than the server's clock is refused", async () => {
  const { client } = await athlete();
  const later = new Date(Date.now() + 60 * 60 * 1000);
  await definedError(
    client.checkIns.put(checkIn("2026-03-01", { updatedAt: later })),
    "EDITED_IN_THE_FUTURE",
  );
  await definedError(client.checkIns.remove(removal("2026-03-01", later)), "EDITED_IN_THE_FUTURE");
});

test("answers outside the scale and its categories are refused", async () => {
  const { client } = await athlete();
  for (const bad of [
    checkIn("2026-03-01", { ratings: { ...normal, soreness: 0 } }),
    checkIn("2026-03-01", { ratings: { ...normal, mood: 6 } }),
    checkIn("2026-03-01", { ratings: { ...normal, sleep: 2.5 } }),
    checkIn("2026-03-01", { illness: { kind: "hangover" } }),
    checkIn("2026-03-01", { injury: { area: "tail", training: "full" } }),
    checkIn("2026-03-01", { injury: { area: "knee", training: "some" } }),
    checkIn("2026-03-01", { note: "x".repeat(1001) }),
    checkIn("2026-03-01", { note: "   " }),
    checkIn("2026-02-30"),
  ]) {
    await assert.rejects(client.checkIns.put(bad), { code: "BAD_REQUEST" });
  }
  await assert.rejects(client.checkIns.range({ from: "2026-03-02", through: "2026-03-01" }), {
    code: "BAD_REQUEST",
  });
  await assert.rejects(client.checkIns.range({ from: "2023-01-01", through: "2026-03-01" }), {
    code: "BAD_REQUEST",
  });
  assert.deepEqual(await everything(client), []);
});

test("two devices checking in for the same day converge on the later edit, in either order", async () => {
  const phone = checkIn("2026-06-01", { ratings: { ...normal, soreness: 1 }, updatedAt: at(5) });
  const laptop = checkIn("2026-06-01", { note: "Fine", updatedAt: at(3) });
  for (const order of [
    [phone, laptop],
    [laptop, phone],
  ]) {
    const { client } = await athlete();
    for (const written of order) await client.checkIns.put(written);
    assert.deepEqual(await everything(client), [phone]);
  }

  const { client } = await athlete();
  await client.checkIns.put(phone);
  assert.deepEqual(
    await client.checkIns.put(laptop),
    { day: "2026-06-01", checkIn: phone },
    "a stale device learns the check-in that won",
  );
});

test("two check-ins stamped the same moment converge on the same one, in either order", async () => {
  const one = checkIn("2026-06-01", { note: "One", updatedAt: at(5) });
  const two = checkIn("2026-06-01", { note: "Two", updatedAt: at(5) });
  const results = [];
  for (const order of [
    [one, two],
    [two, one],
  ]) {
    const { client } = await athlete();
    for (const written of order) await client.checkIns.put(written);
    results.push(await everything(client));
  }
  assert.deepEqual(results[0], results[1]);
  assert.equal(results[0].length, 1);
});

test("a removal racing an edit: the later one wins, in either order, and a tie removes", async () => {
  const scenarios = [
    { edit: checkIn("2026-06-01", { updatedAt: at(5) }), gone: removal("2026-06-01", at(4)) },
    { edit: checkIn("2026-06-01", { updatedAt: at(4) }), gone: removal("2026-06-01", at(5)) },
    { edit: checkIn("2026-06-01", { updatedAt: at(5) }), gone: removal("2026-06-01", at(5)) },
  ];
  for (const { edit, gone } of scenarios) {
    const kept = edit.updatedAt > gone.updatedAt;
    for (const order of ["edit first", "removal first"]) {
      const { client } = await athlete();
      await client.checkIns.put(checkIn("2026-06-01", { note: "First", updatedAt: at(1) }));
      if (order === "edit first") {
        await client.checkIns.put(edit);
        await client.checkIns.remove(gone);
      } else {
        await client.checkIns.remove(gone);
        await client.checkIns.put(edit);
      }
      assert.deepEqual(await everything(client), kept ? [edit] : [], `${order}, ${kept}`);
    }
  }
});

test("a removed check-in stays removed for a stale device, and a later check-in brings the day back", async () => {
  const { client } = await athlete();
  await client.checkIns.put(checkIn("2026-06-01", { updatedAt: at(1) }));
  assert.deepEqual(await client.checkIns.remove(removal("2026-06-01", at(2))), {
    day: "2026-06-01",
    checkIn: null,
  });
  assert.deepEqual(
    await client.checkIns.put(checkIn("2026-06-01", { note: "Stale", updatedAt: at(1) })),
    { day: "2026-06-01", checkIn: null },
  );
  const again = checkIn("2026-06-01", { note: "Again", updatedAt: at(3) });
  assert.deepEqual((await client.checkIns.put(again)).checkIn, again);
  assert.deepEqual(await client.checkIns.remove(removal("2026-07-01", at(3))), {
    day: "2026-07-01",
    checkIn: null,
  });
});

test("each athlete reads only their own check-ins, and every call needs a session", async () => {
  const one = await athlete();
  const two = await athlete();
  await one.client.checkIns.put(checkIn("2026-03-01", { note: "Mine" }));
  assert.deepEqual(await everything(two.client), []);
  await two.client.checkIns.remove(removal("2026-03-01", at(9)));
  assert.equal((await everything(one.client))[0].note, "Mine");

  const anonymous = rpcClient(runtime);
  await assert.rejects(anonymous.checkIns.range({ from: "2026-03-01", through: "2026-03-01" }), {
    code: "UNAUTHORIZED",
    status: 401,
  });
  await assert.rejects(anonymous.checkIns.put(checkIn("2026-03-01")), { code: "UNAUTHORIZED" });
  await assert.rejects(anonymous.checkIns.remove(removal("2026-03-01")), {
    code: "UNAUTHORIZED",
  });
});

test("the app can use plain HTTP to check in and read a range", async () => {
  const { token } = await athlete();
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const written = await send(
    runtime,
    new Request(`${api}/api-reference/check-ins/2026-03-01`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ratings: { sleep: 4, energy: null, soreness: null, stress: null, mood: null },
        illness: null,
        injury: null,
        note: null,
        updatedAt: at(0).toISOString(),
      }),
    }),
  );
  assert.equal(written.status, 200, await written.clone().text());
  const read = await send(
    runtime,
    new Request(`${api}/api-reference/check-ins?from=2026-03-01&through=2026-03-01`, { headers }),
  );
  assert.equal(read.status, 200);
  const body = await read.json();
  assert.equal(body.checkIns[0].ratings.sleep, 4);
});
