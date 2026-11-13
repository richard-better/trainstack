import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { isDefinedError, safe } from "@orpc/client";
import { api, migrate, rpcClient, send, startWorker } from "./helpers/worker.mjs";
import { mockApple } from "./helpers/apple.mjs";

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
  const signedIn = await apple.signIn(runtime, { email: `${crypto.randomUUID()}@example.com` });
  return { ...signedIn, client: rpcClient(runtime, { token: signedIn.token }) };
}

const at = (minute) => new Date(Date.UTC(2026, 10, 13, 9, minute));

const threshold = (name, value, sport = null) => ({
  kind: "threshold",
  sport,
  threshold: name,
  value,
});
const ftp = (value, sport = null) => threshold("ftp", value, sport);
const listed = (sport, isListed = true) => ({ kind: "sport", sport, listed: isListed });

const put = (day, change, updatedAt = at(0)) => ({ day, change, updatedAt });
const remove = (day, key, updatedAt = at(0)) => ({ day, key, updatedAt, remove: true });

const ftpOn = async (client, day) =>
  (await client.settings.get({ day })).defaults.power.thresholds.ftp;

async function invalid(promise) {
  const [error] = await safe(promise);
  assert.ok(isDefinedError(error), `expected a declared error, got ${error}`);
  assert.equal(error.code, "INVALID_SETTING");
  assert.equal(error.status, 422);
  return error.data;
}

test("a new athlete has the default zone models and no thresholds", async () => {
  const { client } = await athlete();
  assert.deepEqual(await client.settings.get({}), {
    day: null,
    weightKg: null,
    defaults: {
      heart_rate: {
        model: "percent_of_max",
        customLimits: null,
        thresholds: {},
        zones: null,
        missingThresholds: ["max_heart_rate"],
      },
      power: {
        model: "coggan_6",
        customLimits: null,
        thresholds: {},
        zones: null,
        missingThresholds: ["ftp"],
      },
    },
    sports: {},
  });
  assert.deepEqual(await client.settings.history({}), { entries: [], removed: [], cursor: "0" });
  assert.deepEqual(await client.settings.zones({ day: "2026-11-13" }), {
    day: "2026-11-13",
    sport: null,
    zones: {},
  });
});

test("an old activity is analysed with the FTP that held on its day", async () => {
  const { client } = await athlete();
  const written = await client.settings.write({
    writes: [put("2026-03-01", ftp(200)), put("2026-06-01", ftp(250))],
  });
  assert.deepEqual(written.entries, [
    { day: "2026-03-01", change: ftp(200), updatedAt: at(0) },
    { day: "2026-06-01", change: ftp(250), updatedAt: at(0) },
  ]);

  const may = await client.settings.zones({ day: "2026-05-31", sport: "cycling" });
  assert.deepEqual(may.zones.power.limits, [111, 151, 181, 211, 241]);
  assert.equal(may.zones.power.zones[5].name, "Anaerobic");
  assert.equal(may.zones.heart_rate, undefined);
  const june = await client.settings.zones({ day: "2026-06-01", sport: "cycling" });
  assert.deepEqual(june.zones.power.limits, [139, 189, 227, 264, 302]);
  assert.equal(await ftpOn(client, "2026-01-01"), 200, "before the first change, the first holds");
  assert.equal((await client.settings.get({})).defaults.power.thresholds.ftp, 250);

  assert.deepEqual((await client.settings.history({})).entries, written.entries);
});

test("an athlete corrects a threshold and removes another", async () => {
  const { client } = await athlete();
  await client.settings.write({
    writes: [put("2026-03-01", ftp(200)), put("2026-06-01", ftp(250))],
  });
  const corrected = await client.settings.write({
    writes: [put("2026-06-01", ftp(245), at(1))],
  });
  assert.deepEqual(corrected.entries, [{ day: "2026-06-01", change: ftp(245), updatedAt: at(1) }]);
  assert.equal(await ftpOn(client, "2026-07-01"), 245);

  const removed = await client.settings.write({
    writes: [remove("2026-06-01", { kind: "threshold", sport: null, threshold: "ftp" }, at(2))],
  });
  assert.deepEqual(removed, {
    entries: [],
    removed: [
      {
        day: "2026-06-01",
        key: { kind: "threshold", sport: null, threshold: "ftp" },
        updatedAt: at(2),
      },
    ],
  });
  assert.equal(await ftpOn(client, "2026-07-01"), 200);
  assert.deepEqual(
    (await client.settings.history({})).entries.map((entry) => entry.day),
    ["2026-03-01"],
  );
});

test("moving an entry to another day is a removal and a write in one request", async () => {
  const { client } = await athlete();
  await client.settings.write({
    writes: [put("2026-03-01", ftp(200)), put("2026-06-01", ftp(250))],
  });
  await client.settings.write({
    writes: [
      remove("2026-06-01", { kind: "threshold", sport: null, threshold: "ftp" }, at(1)),
      put("2026-04-01", ftp(250), at(1)),
    ],
  });
  assert.equal(await ftpOn(client, "2026-04-15"), 250);
  assert.deepEqual(
    (await client.settings.history({})).entries.map((entry) => entry.day),
    ["2026-03-01", "2026-04-01"],
  );
});

test("running and swimming have their own pace zones, from threshold pace and critical swim speed", async () => {
  const { client } = await athlete();
  await client.settings.write({
    writes: [
      put("2026-03-01", threshold("lactate_threshold_heart_rate", 170)),
      put("2026-03-01", {
        kind: "zones",
        sport: null,
        metric: "heart_rate",
        model: "friel_cycling",
        customLimits: null,
      }),
      put("2026-03-01", listed("running")),
      put("2026-03-01", listed("swimming")),
      put("2026-03-01", threshold("threshold_pace", 240, "running")),
      put("2026-03-01", threshold("threshold_pace", 95, "swimming")),
      put("2026-03-01", { kind: "own_zones", sport: "running", metric: "heart_rate", own: true }),
      put("2026-03-01", {
        kind: "zones",
        sport: "running",
        metric: "heart_rate",
        model: "friel_running",
        customLimits: null,
      }),
    ],
  });

  const settings = await client.settings.get({});
  assert.deepEqual(Object.keys(settings.sports), ["running", "swimming"]);
  assert.deepEqual(Object.keys(settings.sports.running), ["heart_rate", "power", "pace"]);
  assert.equal(settings.sports.running.heart_rate.usesDefault, false);
  assert.equal(settings.sports.running.power.usesDefault, true);
  assert.equal(settings.sports.running.pace.model, "friel_running_pace");
  assert.deepEqual(settings.sports.running.pace.zones.limits, [311, 272, 253, 241, 231, 217]);
  assert.equal(settings.sports.running.pace.zones.descending, true);
  assert.deepEqual(settings.sports.swimming.pace.thresholds, { threshold_pace: 95 });
  assert.equal(settings.sports.swimming.pace.model, "critical_swim_speed");

  const run = await client.settings.zones({ day: "2026-11-13", sport: "running" });
  assert.deepEqual(Object.keys(run.zones), ["heart_rate", "pace"]);
  assert.deepEqual(run.zones.heart_rate.limits, [144, 152, 161, 169, 174, 181]);
  const ride = await client.settings.zones({ day: "2026-11-13", sport: "cycling" });
  assert.deepEqual(ride.zones.heart_rate.limits, [137, 152, 159, 169, 174, 181]);
  const swim = await client.settings.zones({ day: "2026-11-13", sport: "swimming" });
  assert.deepEqual(swim.zones.pace.limits, [106, 101, 96, 91]);
});

test("an athlete overrides zone boundaries, and the override outlives threshold changes", async () => {
  const { client } = await athlete();
  await client.settings.write({
    writes: [
      put("2026-03-01", threshold("max_heart_rate", 200)),
      put("2026-03-01", {
        kind: "zones",
        sport: null,
        metric: "heart_rate",
        model: "percent_of_max",
        customLimits: [120, 140, 160, 180],
      }),
      put("2026-05-01", threshold("max_heart_rate", 190)),
    ],
  });
  const { zones } = await client.settings.zones({ day: "2026-06-01" });
  assert.deepEqual(zones.heart_rate.limits, [120, 140, 160, 180]);
  assert.deepEqual(
    zones.heart_rate.zones.map(({ start, end }) => [start, end]),
    [
      [null, 120],
      [121, 140],
      [141, 160],
      [161, 180],
      [181, null],
    ],
  );
});

test("settings that cannot hold are refused with the write's index and reason", async () => {
  const { client } = await athlete();
  const cases = [
    [threshold("vo2_max", 60), "vo2_max is not a threshold"],
    [ftp(5000), "ftp must be a whole number from 50 to 600"],
    [threshold("threshold_pace", 240), "threshold_pace belongs to a sport"],
    [
      { kind: "zones", sport: null, metric: "power", model: "made_up", customLimits: null },
      "made_up is not a zone model",
    ],
    [
      { kind: "zones", sport: null, metric: "power", model: "karvonen", customLimits: null },
      "karvonen draws no power zones",
    ],
    [
      { kind: "zones", sport: null, metric: "power", model: "coggan_6", customLimits: [1, 2] },
      "coggan_6 needs 5 limits, each leaving every zone room",
    ],
    [
      {
        kind: "zones",
        sport: null,
        metric: "power",
        model: "coggan_6",
        customLimits: [5, 4, 3, 2, 1],
      },
      "coggan_6 needs 5 limits, each leaving every zone room",
    ],
    [
      { kind: "own_zones", sport: "running", metric: "pace", own: false },
      "pace zones always belong to their sport",
    ],
  ];
  for (const [change, reason] of cases) {
    assert.deepEqual(
      await invalid(
        client.settings.write({ writes: [put("2026-03-01", ftp(200)), put("2026-03-02", change)] }),
      ),
      { index: 1, reason },
    );
  }
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  assert.deepEqual(
    await invalid(client.settings.write({ writes: [put("2026-03-01", ftp(200), tomorrow)] })),
    {
      index: 0,
      reason: "updatedAt is later than the server's clock",
    },
  );
  await assert.rejects(client.settings.write({ writes: [put("2026-02-30", ftp(200))] }), {
    code: "BAD_REQUEST",
  });
  assert.deepEqual(
    (await client.settings.history({})).entries,
    [],
    "a refused batch writes nothing",
  );
});

test("two devices writing the same setting and day converge on the later edit, in either order", async () => {
  const phone = put("2026-06-01", ftp(260), at(5));
  const mac = put("2026-06-01", ftp(250), at(3));
  for (const order of [
    [phone, mac],
    [mac, phone],
  ]) {
    const { client } = await athlete();
    for (const write of order) await client.settings.write({ writes: [write] });
    assert.deepEqual((await client.settings.history({})).entries, [phone]);
  }

  const stale = await athlete();
  await stale.client.settings.write({ writes: [phone] });
  const answer = await stale.client.settings.write({ writes: [mac] });
  assert.deepEqual(answer.entries, [phone], "a stale device learns the value that won");
});

test("two edits stamped the same moment converge on the same one, in either order", async () => {
  const a = put("2026-06-01", ftp(250), at(5));
  const b = put("2026-06-01", ftp(260), at(5));
  const results = [];
  for (const order of [
    [a, b],
    [b, a],
  ]) {
    const { client } = await athlete();
    for (const write of order) await client.settings.write({ writes: [write] });
    results.push((await client.settings.history({})).entries);
  }
  assert.deepEqual(results[0], results[1]);
  assert.equal(results[0].length, 1);
});

test("a removal racing an edit: the later one wins, in either order, and a tie removes", async () => {
  const key = { kind: "threshold", sport: null, threshold: "ftp" };
  const scenarios = [
    {
      edit: put("2026-06-01", ftp(260), at(5)),
      removal: remove("2026-06-01", key, at(4)),
      kept: true,
    },
    {
      edit: put("2026-06-01", ftp(260), at(4)),
      removal: remove("2026-06-01", key, at(5)),
      kept: false,
    },
    {
      edit: put("2026-06-01", ftp(260), at(5)),
      removal: remove("2026-06-01", key, at(5)),
      kept: false,
    },
  ];
  for (const { edit, removal, kept } of scenarios) {
    for (const order of [
      [edit, removal],
      [removal, edit],
    ]) {
      const { client } = await athlete();
      await client.settings.write({ writes: [put("2026-03-01", ftp(200))] });
      for (const write of order) await client.settings.write({ writes: [write] });
      const history = await client.settings.history({});
      assert.deepEqual(
        history.entries.map((entry) => entry.change.value),
        kept ? [200, 260] : [200],
      );
      assert.equal(history.removed.length, kept ? 0 : 1);
      assert.equal(await ftpOn(client, "2026-07-01"), kept ? 260 : 200);
    }
  }
});

test("a replayed write changes nothing, and a device syncs only what changed since its cursor", async () => {
  const { client } = await athlete();
  const writes = [put("2026-03-01", ftp(200)), put("2026-03-01", { kind: "weight", kg: 72.5 })];
  const written = await client.settings.write({ writes });
  const first = await client.settings.history({});
  assert.deepEqual(await client.settings.write({ writes }), written);
  assert.deepEqual(await client.settings.history({ since: first.cursor }), {
    entries: [],
    removed: [],
    cursor: first.cursor,
  });

  await client.settings.write({
    writes: [put("2026-06-01", ftp(240), at(1)), remove("2026-03-01", { kind: "weight" }, at(1))],
  });
  const since = await client.settings.history({ since: first.cursor });
  assert.deepEqual(since.entries, [put("2026-06-01", ftp(240), at(1))]);
  assert.deepEqual(since.removed, [
    { day: "2026-03-01", key: { kind: "weight" }, updatedAt: at(1) },
  ]);
  assert.ok(Number(since.cursor) > Number(first.cursor));
  assert.equal((await client.settings.get({})).weightKg, null);
});

test("a device that writes still syncs what another device wrote before it", async () => {
  const { client } = await athlete();
  const phone = client;
  const mac = client;
  const synced = await mac.settings.history({});
  await phone.settings.write({ writes: [put("2026-03-01", { kind: "weight", kg: 71 })] });
  const written = await mac.settings.write({ writes: [put("2026-03-01", ftp(250))] });
  assert.deepEqual(Object.keys(written), ["entries", "removed"]);
  const since = await mac.settings.history({ since: synced.cursor });
  assert.deepEqual(
    since.entries.map((entry) => entry.change.kind),
    ["threshold", "weight"],
  );
});

test("a sport named like an Object property is just a sport", async () => {
  const { client } = await athlete();
  await client.settings.write({
    writes: [
      put("2026-03-01", ftp(250)),
      put("2026-03-01", listed("constructor")),
      put("2026-03-01", { kind: "own_zones", sport: "constructor", metric: "power", own: true }),
      put("2026-03-01", ftp(300, "constructor")),
    ],
  });
  const settings = await client.settings.get({});
  assert.deepEqual(Object.keys(settings.sports), ["constructor"]);
  assert.equal(settings.sports.constructor.power.thresholds.ftp, 300);
  const other = await athlete();
  assert.deepEqual((await other.client.settings.get({})).sports, {});
  assert.equal(
    (await other.client.settings.zones({ day: "2026-03-01", sport: "constructor" })).zones.power,
    undefined,
  );
});

test("writes from several devices at once all land", async () => {
  const { client } = await athlete();
  await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      client.settings.write({
        writes: [put(`2026-03-${String(index + 1).padStart(2, "0")}`, ftp(200 + index))],
      }),
    ),
  );
  const history = await client.settings.history({});
  assert.equal(history.entries.length, 10);
  assert.equal(history.cursor, "10");
  assert.equal(await ftpOn(client, "2026-03-10"), 209);
});

test("a threshold test is kept with its activity and changes no threshold by itself", async () => {
  const { client } = await athlete();
  const test = {
    kind: "threshold_test",
    id: crypto.randomUUID(),
    sport: "cycling",
    threshold: "ftp",
    protocol: "ramp",
    value: 265,
    activityId: "a".repeat(64),
  };
  await client.settings.write({ writes: [put("2026-03-01", ftp(250)), put("2026-04-01", test)] });
  assert.equal(await ftpOn(client, "2026-05-01"), 250);
  assert.deepEqual(
    (await client.settings.history({})).entries.map((entry) => entry.change),
    [ftp(250), test],
  );
});

test("each athlete has their own settings, and reading them needs a session", async () => {
  const one = await athlete();
  const two = await athlete();
  await one.client.settings.write({ writes: [put("2026-03-01", ftp(300))] });
  assert.deepEqual((await two.client.settings.history({})).entries, []);
  assert.equal((await two.client.settings.get({})).defaults.power.thresholds.ftp, undefined);

  const anonymous = rpcClient(runtime);
  await assert.rejects(anonymous.settings.get({}), { code: "UNAUTHORIZED", status: 401 });
  await assert.rejects(anonymous.settings.write({ writes: [put("2026-03-01", ftp(300))] }), {
    code: "UNAUTHORIZED",
  });
});

test("the app can use plain HTTP to write history and read zones", async () => {
  const { token } = await athlete();
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const written = await send(
    runtime,
    new Request(`${api}/api-reference/settings/history`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        writes: [{ day: "2026-03-01", change: ftp(200), updatedAt: "2026-11-13T09:00:00.000Z" }],
      }),
    }),
  );
  assert.equal(written.status, 200, await written.clone().text());
  assert.deepEqual((await written.json()).entries, [
    { day: "2026-03-01", change: ftp(200), updatedAt: "2026-11-13T09:00:00.000Z" },
  ]);

  const zones = await runtime.dispatchFetch(
    `${api}/api-reference/settings/zones?day=2026-04-01&sport=cycling`,
    { headers },
  );
  assert.equal(zones.status, 200);
  assert.deepEqual((await zones.json()).zones.power.limits, [111, 151, 181, 211, 241]);

  const history = await runtime.dispatchFetch(`${api}/api-reference/settings/history?since=0`, {
    headers,
  });
  assert.equal(history.status, 200);
  assert.equal((await history.json()).entries.length, 1);
});
