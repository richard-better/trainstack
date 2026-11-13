import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { ORPCError } from "@orpc/client";
import { readActivityFile } from "../hosted/apps/account/src/lib/activity-file.ts";
import { ACTIVITIES_PER_PAGE, createApiClient } from "../hosted/apps/account/src/lib/client.ts";
import { lapsOf, traceOf } from "../hosted/apps/account/src/lib/series.ts";
import { activityTitle } from "../hosted/apps/account/src/lib/sports.ts";
import {
  figureOf,
  headlineFigures,
  statisticsFromFit,
  summaryFigures,
} from "../hosted/apps/account/src/lib/statistics.ts";
import { mockApple } from "./helpers/apple.mjs";
import { browserThatDoesNotFollowRedirects } from "./helpers/browser.mjs";
import { api, migrate, origin, rpcClient, startWorker } from "./helpers/worker.mjs";

const SAMPLE_RIDE = "apps/ride/RideKit/Sources/RideData/Resources/SampleRide.fit";
const WORKOUT_RIDE = "apps/ride/RideKit/Tests/RideCoreTests/Traces/quick-test-trainer-drop.fit";

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

let lastAddress = 0;

function fromItsOwnAddress() {
  lastAddress += 1;
  const address = `198.51.100.${lastAddress}`;
  return {
    dispatchFetch(url, init = {}) {
      const headers = new Headers(init.headers);
      headers.set("cf-connecting-ip", address);
      return runtime.dispatchFetch(url, { ...init, headers });
    },
  };
}

async function signInOnTheWeb(callbackURL = `${origin}/`) {
  const subject = `001234.${randomUUID()}`;
  const email = `${randomUUID()}@example.com`;
  const browser = browserThatDoesNotFollowRedirects(fromItsOwnAddress());
  const started = await browser.visit(`${api}/api/auth/sign-in/social`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "apple", callbackURL, errorCallbackURL: callbackURL }),
  });
  assert.equal(started.status, 200, await started.clone().text());
  const { form } = apple.authorize((await started.json()).url, { email, subject });
  const posted = await browser.visit(`${api}/api/auth/callback/apple`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: "https://appleid.apple.com",
    },
    body: form.toString(),
  });
  const back = await browser.visit(posted.headers.get("location"));
  const webApp = createApiClient(api, async (request) => {
    const headers = new Headers(request.headers);
    headers.set("Origin", origin);
    const response = await browser.visit(request.url, {
      method: request.method,
      headers,
      body: request.body ? await request.arrayBuffer() : undefined,
    });
    return new Response(await response.arrayBuffer(), {
      status: response.status,
      headers: Object.fromEntries(response.headers),
    });
  });
  const ride = rpcClient(runtime, {
    token: (await apple.signIn(fromItsOwnAddress(), { email, subject })).token,
  });
  return { back, webApp, ride };
}

const gpx = (index) =>
  new File(
    [
      `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="test"><trk><trkseg><trkpt lat="47.5" lon="19.04"><time>2026-01-01T00:00:${String(index).padStart(2, "0")}Z</time></trkpt></trkseg></trk></gpx>`,
    ],
    `run-${index}.gpx`,
  );

test("the web app pages through the athlete's activities, newest first", async () => {
  const { webApp, ride } = await signInOnTheWeb();
  assert.deepEqual(await webApp.activities.list({ limit: ACTIVITIES_PER_PAGE }), {
    activities: [],
    nextCursor: null,
  });

  const count = ACTIVITIES_PER_PAGE + 3;
  for (let index = 0; index < count; index++) {
    await ride.activities.upload({
      file: gpx(index),
      source: "upload",
      sport: "running",
      startedAt: new Date(Date.UTC(2026, 0, 1 + index)),
    });
  }

  const first = await webApp.activities.list({ limit: ACTIVITIES_PER_PAGE });
  assert.equal(first.activities.length, ACTIVITIES_PER_PAGE);
  assert.ok(first.nextCursor);
  const second = await webApp.activities.list({
    limit: ACTIVITIES_PER_PAGE,
    cursor: first.nextCursor,
  });
  assert.equal(second.nextCursor, null);
  const times = [...first.activities, ...second.activities].map((a) => a.startedAt.getTime());
  assert.equal(new Set(times).size, count);
  assert.deepEqual(
    times,
    [...times].sort((a, b) => b - a),
  );
  assert.deepEqual(
    first.activities.map((activity) => headlineFigures(activity.statistics)),
    first.activities.map(() => []),
    "no headline numbers before the server summarizes",
  );
});

test("the detail page charts the activity's own FIT file when the server has no summary", async () => {
  const { webApp, ride } = await signInOnTheWeb();
  const bytes = await readFile(SAMPLE_RIDE);
  const { id, statistics: serverStatistics } = await ride.activities.upload({
    file: new File([bytes], "ride.fit"),
    source: "trainstack",
    sport: "indoor_cycling",
  });
  const db = await runtime.getD1Database("DB");
  await db.batch([
    db.prepare("UPDATE activity SET summarized_at = NULL WHERE id = ?").bind(id),
    db.prepare("DELETE FROM activity_statistic WHERE activity_id = ?").bind(id),
  ]);

  const detail = await webApp.activities.get({ id });
  assert.equal(detail.summarizedAt, null);
  assert.deepEqual(detail.statistics, {});
  const file = await webApp.activities.file({ id });
  const reading = readActivityFile(new Uint8Array(await file.arrayBuffer()));
  assert.equal(reading.kind, "decoded");

  assert.deepEqual(statisticsFromFit(reading.activity.summary), serverStatistics);
  const figures = Object.fromEntries(
    summaryFigures(statisticsFromFit(reading.activity.summary)).map((f) => [
      f.label,
      `${f.value} ${f.unit}`.trim(),
    ]),
  );
  assert.deepEqual(
    { ...figures },
    {
      Time: "30:00",
      Distance: "14.39 km",
      "Avg power": "137 W",
      "Max power": "177 W",
      "Avg heart rate": "146 bpm",
      "Max heart rate": "167 bpm",
      "Avg cadence": "70 rpm",
      "Max cadence": "91 rpm",
      "Avg speed": "28.8 km/h",
      "Max speed": "30.9 km/h",
      Energy: "247 kcal",
    },
  );

  const trace = traceOf(reading.activity);
  assert.deepEqual(
    trace.channels.map((channel) => channel.key),
    ["power", "heartRate", "cadence", "speed"],
  );
  assert.equal(trace.seconds.length, 1801);
  assert.equal(trace.duration, 1800);
  assert.equal(trace.channels[0].target, null, "a free ride has no target power");
  const laps = lapsOf(reading.activity);
  assert.equal(laps.length, 10);
  assert.equal(laps[0].startSecond, 0);
  assert.equal(Math.round(laps.at(-1).startSecond + laps.at(-1).seconds), 1800);
});

test("a workout ride charts its target power and needs no laps table for its one lap", async () => {
  const reading = readActivityFile(new Uint8Array(await readFile(WORKOUT_RIDE)));
  assert.equal(reading.kind, "decoded");
  const power = traceOf(reading.activity).channels.find((channel) => channel.key === "power");
  assert.ok(power.target.some((value) => value > 0));
  assert.deepEqual(lapsOf(reading.activity), []);
});

test("a GPX run gets charts too, with its speed worked out from its distances", async () => {
  const { webApp, ride } = await signInOnTheWeb();
  const bytes = await readFile("packages/activity-file/test/files/garmin-connect-run.gpx");
  const { id } = await ride.activities.upload({
    file: new File([bytes], "run.gpx"),
    source: "upload",
  });

  const file = await webApp.activities.file({ id });
  const reading = readActivityFile(new Uint8Array(await file.arrayBuffer()));
  assert.equal(reading.kind, "decoded");
  assert.equal(reading.activity.format, "gpx");
  const trace = traceOf(reading.activity);
  assert.deepEqual(
    trace.channels.map((channel) => channel.key),
    ["heartRate", "cadence", "speed"],
  );
  const speed = trace.channels.find((channel) => channel.key === "speed");
  assert.ok(
    speed.values.every((value) => value > 5 && value < 20),
    `${speed.values}`,
  );
});

test("a damaged activity file reads as unreadable instead of breaking the page", async () => {
  const bytes = new Uint8Array(await readFile(SAMPLE_RIDE));
  assert.deepEqual(readActivityFile(bytes.subarray(0, 4000)), {
    kind: "unreadable",
    code: "truncated",
    format: "fit",
  });
  assert.equal(readActivityFile(new TextEncoder().encode("<gpx/>")).kind, "unreadable");
});

test("the athlete deletes an activity on the web, and it is gone from the list and detail", async () => {
  const { webApp, ride } = await signInOnTheWeb();
  const kept = await ride.activities.upload({ file: gpx(1), source: "upload" });
  const removed = await ride.activities.upload({ file: gpx(2), source: "upload" });

  await webApp.activities.delete({ id: removed.id });

  const { activities } = await webApp.activities.list({ limit: ACTIVITIES_PER_PAGE });
  assert.deepEqual(
    activities.map((activity) => activity.id),
    [kept.id],
  );
  await assert.rejects(
    webApp.activities.get({ id: removed.id }),
    (error) => error instanceof ORPCError && error.code === "NOT_FOUND",
  );
});

test("signing in from a link to an activity lands back on that activity", async () => {
  const link = `${origin}/activities/${"a".repeat(64)}`;
  const { back } = await signInOnTheWeb(link);
  assert.equal(back.status, 302);
  assert.equal(back.headers.get("location"), link);
});

test("headline numbers come from the server's statistics, preferring timer time", () => {
  const shown = (statistics) =>
    headlineFigures(statistics).map((f) => `${f.label} ${f.value} ${f.unit}`.trim());
  assert.deepEqual(
    shown({
      elapsed_s: 3725,
      timer_s: 3600,
      distance_m: 32_450,
      average_power_w: 201.4,
      average_heart_rate_bpm: 151.6,
      max_power_w: 640,
    }),
    ["Time 1:00:00", "Distance 32.45 km", "Avg power 201 W", "Avg heart rate 152 bpm"],
  );
  assert.deepEqual(shown({ elapsed_s: 754, distance_m: 820 }), ["Elapsed 12:34", "Distance 820 m"]);
  assert.deepEqual(shown({}), []);
});

test("a statistic the web app does not know yet is still shown, named from its key", () => {
  assert.deepEqual(figureOf("normalized_power_w", 151.2), {
    name: "normalized_power_w",
    label: "Normalized power",
    value: "151",
    unit: "W",
  });
  assert.deepEqual(figureOf("average_stroke_rate_spm", 28.25), {
    name: "average_stroke_rate_spm",
    label: "Avg stroke rate spm",
    value: "28.25",
    unit: "",
  });
  assert.deepEqual(
    summaryFigures({ timer_s: 60, elapsed_s: 60.4, training_load: 42 }).map((f) => f.label),
    ["Time", "Training load"],
    "elapsed time is left out when it matches the timer",
  );
});

test("an unnamed activity is called by its sport and time of day", () => {
  const morning = new Date(2026, 10, 13, 7, 30);
  assert.equal(
    activityTitle({ name: "Sweet spot", sport: "cycling", startedAt: morning }),
    "Sweet spot",
  );
  assert.equal(
    activityTitle({ name: null, sport: "indoor_cycling", startedAt: morning }),
    "Morning indoor ride",
  );
  assert.equal(
    activityTitle({ name: null, sport: "kayaking", startedAt: null }),
    "Untitled kayaking",
  );
  assert.equal(activityTitle({ name: null, sport: null, startedAt: morning }), "Morning activity");
});
