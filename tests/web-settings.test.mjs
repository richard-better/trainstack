import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import {
  limitsSettingZoneEnd,
  metricSettings,
  missingThresholds,
  profileOn,
  usesDefault,
  zonesOf,
} from "@trainstack/zones";
import { readActivityFile } from "../hosted/apps/account/src/lib/activity-file.ts";
import { traceOf } from "../hosted/apps/account/src/lib/series.ts";
import { analysisOf, recordedMetrics } from "../hosted/apps/account/src/lib/activity-zones.ts";
import {
  changeSummary,
  corrected,
  datedChanges,
  formatValue,
  historyByDay,
  latestDayOf,
  localDay,
  overruled,
  parseValue,
  parseWeight,
  put,
  removal,
  scopeSetUpOn,
  withAnswer,
} from "../hosted/apps/account/src/lib/settings.ts";
import { mockApple } from "./helpers/apple.mjs";
import { signInOnTheWeb as signInWithApple } from "./helpers/web.mjs";
import { migrate, startWorker } from "./helpers/worker.mjs";

const SAMPLE_RIDE = "apps/ride/RideKit/Sources/RideData/Resources/SampleRide.fit";

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
const ftp = (value, sport = null) => ({ kind: "threshold", sport, threshold: "ftp", value });

async function save(webApp, writes) {
  const answer = await webApp.settings.write({ writes });
  return { answer, lost: overruled(writes, answer) };
}

const ftpOn = (history, day, sport = null) =>
  metricSettings(profileOn(datedChanges(history.entries), day), "power", sport)?.thresholds.ftp;

test("the athlete sets FTP as of a day, and every day before the next change uses it", async () => {
  const { webApp } = await signInOnTheWeb();
  const { lost } = await save(webApp, [put("2026-09-01", ftp(240)), put("2026-10-15", ftp(255))]);
  assert.deepEqual(lost, []);

  const history = await webApp.settings.history({});
  assert.equal(ftpOn(history, "2026-08-01"), 240, "before the first change, the earliest holds");
  assert.equal(ftpOn(history, "2026-10-14"), 240);
  assert.equal(ftpOn(history, "2026-10-15"), 255);
  assert.equal(
    latestDayOf(history.entries, (change) => change.kind === "threshold", "2026-10-01"),
    "2026-09-01",
  );
  assert.deepEqual(
    historyByDay(history.entries).map(({ day, entries }) => [
      day,
      entries.map((entry) => changeSummary(entry.change)),
    ]),
    [
      ["2026-10-15", ["Default: FTP 255 W"]],
      ["2026-09-01", ["Default: FTP 240 W"]],
    ],
  );
});

test("a later edit from another device wins, and the page shows what the server kept", async () => {
  const { webApp, ride } = await signInOnTheWeb();
  await ride.settings.write({ writes: [put("2026-11-01", ftp(262), minutesAgo(1))] });

  const stale = await webApp.settings.history({});
  const writes = [put("2026-11-01", ftp(250), minutesAgo(2))];
  const { answer, lost } = await save(webApp, writes);

  assert.equal(lost.length, 1);
  assert.equal(changeSummary(lost[0].kept.change), "Default: FTP 262 W");
  const shown = withAnswer(stale, answer);
  assert.equal(ftpOn(shown, "2026-11-01"), 262);
  assert.deepEqual(shown, { ...(await webApp.settings.history({})), cursor: stale.cursor });
});

test("an edit after another device's wins, and the page shows its own value", async () => {
  const { webApp, ride } = await signInOnTheWeb();
  await ride.settings.write({ writes: [put("2026-11-01", ftp(262), minutesAgo(2))] });
  const stale = await webApp.settings.history({});

  const { answer, lost } = await save(webApp, [put("2026-11-01", ftp(250))]);
  assert.deepEqual(lost, []);
  assert.equal(ftpOn(withAnswer(stale, answer), "2026-11-01"), 250);
});

test("removing a change another device edited later keeps that device's change", async () => {
  const { webApp, ride } = await signInOnTheWeb();
  await webApp.settings.write({ writes: [put("2026-10-01", ftp(230), minutesAgo(3))] });
  await ride.settings.write({ writes: [put("2026-10-01", ftp(235), minutesAgo(1))] });

  const { lost } = await save(webApp, [
    removal("2026-10-01", { kind: "threshold", sport: null, threshold: "ftp" }, minutesAgo(2)),
  ]);
  assert.equal(lost.length, 1);
  assert.equal(changeSummary(lost[0].kept.change), "Default: FTP 235 W");
});

test("the athlete corrects a past FTP's value and day, and removes another", async () => {
  const { webApp } = await signInOnTheWeb();
  await webApp.settings.write({
    writes: [
      put("2026-09-01", ftp(240), minutesAgo(5)),
      put("2026-10-01", ftp(260), minutesAgo(5)),
      put("2026-10-01", { kind: "weight", kg: 71.5 }, minutesAgo(5)),
    ],
  });
  const history = await webApp.settings.history({});
  const september = history.entries.find((entry) => entry.day === "2026-09-01");

  const { lost } = await save(webApp, corrected(september, "2026-08-20", ftp(245)));
  assert.deepEqual(lost, []);
  const weight = history.entries.find((entry) => entry.change.kind === "weight");
  await save(webApp, [removal(weight.day, { kind: "weight" })]);

  const after = await webApp.settings.history({});
  assert.deepEqual(
    after.entries.map((entry) => [entry.day, changeSummary(entry.change)]),
    [
      ["2026-08-20", "Default: FTP 245 W"],
      ["2026-10-01", "Default: FTP 260 W"],
    ],
  );
  assert.deepEqual(after.removed.map((entry) => [entry.day, entry.key.kind]).toSorted(), [
    ["2026-09-01", "threshold"],
    ["2026-10-01", "weight"],
  ]);
  assert.equal(profileOn(datedChanges(after.entries), "2026-11-01").weightKg, null);
});

test("a sport's threshold set before the sport was added holds from its day", async () => {
  const { webApp } = await signInOnTheWeb();
  const today = "2026-11-10";
  await save(webApp, [
    put(today, { kind: "sport", sport: "running", listed: true }),
    put(today, { kind: "sport", sport: "cycling", listed: true }),
    put(today, { kind: "own_zones", sport: "cycling", metric: "power", own: true }),
    put("2026-01-01", ftp(240)),
  ]);
  const history = async () => (await webApp.settings.history({})).entries;
  const pace = { kind: "threshold", sport: "running", threshold: "threshold_pace", value: 270 };
  const october = "2026-10-01";
  await save(webApp, [
    ...scopeSetUpOn(await history(), october, "running", "pace"),
    put(october, pace),
  ]);
  await save(webApp, [
    ...scopeSetUpOn(await history(), october, "cycling", "power"),
    put(october, ftp(280, "cycling")),
  ]);

  const on = async (day) => profileOn(datedChanges(await history()), day);
  assert.equal(
    metricSettings(await on("2026-10-15"), "pace", "running").thresholds.threshold_pace,
    270,
  );
  assert.equal(
    metricSettings(await on("2026-11-12"), "pace", "running").thresholds.threshold_pace,
    270,
  );
  assert.equal(metricSettings(await on("2026-10-15"), "power", "cycling").thresholds.ftp, 280);
  assert.equal(metricSettings(await on("2026-11-12"), "power", "cycling").thresholds.ftp, 280);
  assert.equal(metricSettings(await on("2026-10-15"), "power", null).thresholds.ftp, 240);
  assert.deepEqual(scopeSetUpOn(await history(), "2026-10-20", "cycling", "power"), []);
  assert.deepEqual(scopeSetUpOn(await history(), "2026-10-20", null, "power"), []);
});

test("an old ride's time in power zones follows the FTP that held on its day", async () => {
  const { webApp, ride } = await signInOnTheWeb();
  const bytes = await readFile(SAMPLE_RIDE);
  const { id, startedAt } = await ride.activities.upload({
    file: new File([bytes], "ride.fit"),
    source: "trainstack",
  });
  const detail = await webApp.activities.get({ id });
  const day = localDay(startedAt);
  const reading = readActivityFile(
    new Uint8Array(await (await webApp.activities.file({ id })).arrayBuffer()),
  );
  assert.deepEqual(recordedMetrics(traceOf(reading.activity), "cycling"), ["power", "heart_rate"]);

  const powerShares = async () => {
    const history = await webApp.settings.history({});
    const profile = profileOn(datedChanges(history.entries), day);
    const analysis = analysisOf(reading.activity, detail.sport, profile);
    assert.equal(analysis.sport, "cycling");
    const shares = analysis.timeInZones.power;
    if (!shares) return { missing: missingThresholds(metricSettings(profile, "power", "cycling")) };
    return {
      minutes: shares.map((share) => Math.round(share.seconds / 60)),
      seconds: shares.reduce((sum, share) => sum + share.seconds, 0),
    };
  };

  assert.deepEqual(
    await powerShares(),
    { missing: ["ftp"] },
    "with no FTP there are no power zones",
  );

  await save(webApp, [put(localDay(new Date()), ftp(250))]);
  assert.deepEqual((await powerShares()).minutes, [16, 14, 0, 0, 0, 0]);

  await save(webApp, [put(day, ftp(200))]);
  const withItsDaysFtp = await powerShares();
  assert.deepEqual(withItsDaysFtp.minutes, [1, 22, 6, 0, 0, 0]);
  assert.equal(withItsDaysFtp.seconds, 1800, "every second of a 30 minute ride lands in a zone");
});

test("a sport with its own zones uses them, and its own boundaries override the model", async () => {
  const { webApp } = await signInOnTheWeb();
  const day = "2026-10-01";
  await save(webApp, [
    put(day, ftp(250)),
    put(day, { kind: "sport", sport: "cycling", listed: true }),
    put(day, { kind: "own_zones", sport: "cycling", metric: "power", own: true }),
    put(day, ftp(280, "cycling")),
  ]);
  let profile = profileOn(datedChanges((await webApp.settings.history({})).entries), day);
  assert.equal(usesDefault(profile, "power", "cycling"), false);
  const zones = zonesOf(metricSettings(profile, "power", "cycling"));
  assert.equal(zones.limits[0], 156);

  const limits = limitsSettingZoneEnd(zones, 0, 150);
  assert.deepEqual(limitsSettingZoneEnd(zones, 0, zones.limits[1] + 1), null, "a zone needs room");
  await save(webApp, [
    put(day, {
      kind: "zones",
      sport: "cycling",
      metric: "power",
      model: "coggan_6",
      customLimits: limits,
    }),
  ]);
  profile = profileOn(datedChanges((await webApp.settings.history({})).entries), day);
  assert.equal(zonesOf(metricSettings(profile, "power", "cycling")).limits[0], 150);
  assert.equal(
    zonesOf(metricSettings(profile, "power", null)).limits[0],
    139,
    "the default keeps its own",
  );

  await save(webApp, [
    put(day, {
      kind: "zones",
      sport: "cycling",
      metric: "power",
      model: "coggan_6",
      customLimits: null,
    }),
  ]);
  profile = profileOn(datedChanges((await webApp.settings.history({})).entries), day);
  assert.equal(zonesOf(metricSettings(profile, "power", "cycling")).limits[0], 156);
});

test("a run's time in pace zones uses running's threshold pace, per kilometre", async () => {
  const { webApp } = await signInOnTheWeb();
  const runAt = (secondsPerKm) =>
    Array.from({ length: 601 }, (_, second) => ({
      elapsedSeconds: second,
      distanceMetres: (second * 1000) / secondsPerKm,
    }));
  const run = {
    summary: { startTime: new Date(), sport: "running", subSport: undefined, elapsedSeconds: 600 },
    records: runAt(300),
    laps: [],
  };
  assert.equal(
    analysisOf(run, "running", profileOn([], "2026-11-01")).timeInZones.pace,
    undefined,
    "pace zones need running listed with a threshold pace",
  );

  const day = "2026-01-01";
  await save(webApp, [
    put(day, { kind: "sport", sport: "running", listed: true }),
    put(day, {
      kind: "threshold",
      sport: "running",
      threshold: "threshold_pace",
      value: parseValue("pace", "4:30"),
    }),
  ]);
  const profile = profileOn(
    datedChanges((await webApp.settings.history({})).entries),
    "2026-11-01",
  );
  const zones = zonesOf(metricSettings(profile, "pace", "running"));
  assert.equal(zones.descending, true);
  const shares = analysisOf(run, "running", profile).timeInZones.pace;
  const held = shares.filter((share) => share.seconds > 0);
  assert.equal(held.length, 1);
  assert.equal(
    held[0].zone.name,
    "Tempo",
    "5:00 /km is 111% of a 4:30 threshold pace, in Friel's 105-113%",
  );
  assert.ok(held[0].seconds >= 595);
});

test("an indoor ride's file names its sport, and a file without one uses the activity's", () => {
  const records = [0, 1, 2, 3].map((second) => ({ elapsedSeconds: second, power: 180 }));
  const profile = profileOn(
    [
      {
        day: "2026-01-01",
        change: { kind: "threshold", sport: null, threshold: "ftp", value: 200 },
      },
    ],
    "2026-02-01",
  );
  const summary = { startTime: new Date(), elapsedSeconds: 3 };
  const indoor = {
    summary: { ...summary, sport: "cycling", subSport: "virtualActivity" },
    records,
    laps: [],
  };
  assert.equal(analysisOf(indoor, "cycling", profile).sport, "cycling");
  const unnamed = {
    summary: { ...summary, sport: undefined, subSport: undefined },
    records,
    laps: [],
  };
  assert.equal(analysisOf(unnamed, "cycling", profile).sport, "cycling");
  assert.equal(analysisOf(unnamed, null, profile).sport, null);
  assert.deepEqual(
    analysisOf(unnamed, null, profile).timeInZones.power.map((share) => share.seconds),
    [0, 0, 3, 0, 0, 0],
  );
});

test("a smart-recorded ride counts its held seconds, but not the time its timer was stopped", () => {
  const records = [0, 20, 40, 60, 80, 100, 120].map((second) => ({
    elapsedSeconds: second,
    power: 180,
  }));
  const startTime = new Date("2026-10-06T10:00:00Z");
  const at = (second) => new Date(startTime.getTime() + second * 1000);
  const profile = profileOn(
    [
      {
        day: "2026-01-01",
        change: { kind: "threshold", sport: null, threshold: "ftp", value: 200 },
      },
    ],
    "2026-10-06",
  );
  const ride = (events) => ({
    summary: { startTime, sport: "cycling", subSport: undefined, elapsedSeconds: 120 },
    records,
    laps: [],
    events,
  });
  const tempoSeconds = (events) =>
    analysisOf(ride(events), "cycling", profile).timeInZones.power[2].seconds;

  assert.equal(tempoSeconds([]), 120);
  assert.equal(
    tempoSeconds([
      { time: at(40), event: "timer", type: "stopAll" },
      { time: at(100), event: "timer", type: "start" },
    ]),
    60,
  );
});

test("values read and print in the athlete's units", () => {
  assert.equal(parseValue("pace", "4:05"), 245);
  assert.equal(parseValue("pace", "4:65"), null);
  assert.equal(parseValue("power", "250"), 250);
  assert.equal(parseValue("power", "25o"), null);
  assert.equal(formatValue("pace", 125), "2:05");
  assert.equal(parseWeight("72,5"), 72.5);
  assert.equal(parseWeight("250"), null);
  assert.equal(
    changeSummary({ kind: "threshold", sport: "swimming", threshold: "threshold_pace", value: 95 }),
    "Swimming: CSS 1:35 /100 m",
  );
});
