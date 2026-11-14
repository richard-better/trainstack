import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isDefinedError, safe } from "@orpc/client";
import ICAL from "ical.js";
import { mockApple } from "./helpers/apple.mjs";
import { denseRide } from "./helpers/fit-files.mjs";
import { api, migrate, origin, rpcClient, startWorker } from "./helpers/worker.mjs";

const ZONE = "Europe/Budapest";
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

const today = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE }).format(new Date());
const shifted = (days) =>
  new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

let clock = Date.UTC(2026, 10, 13, 9, 0);
const now = () => new Date((clock += 1000));

async function athlete() {
  const signedIn = await apple.signIn(runtime, { email: `${randomUUID()}@example.com` });
  const client = rpcClient(runtime, { token: signedIn.token });
  await client.settings.setTimeZone({ timeZone: ZONE });
  await client.settings.write({
    writes: [
      {
        day: "2026-01-01",
        change: { kind: "threshold", sport: null, threshold: "ftp", value: 250 },
        updatedAt: now(),
      },
    ],
  });
  return { ...signedIn, client };
}

const ftp = (level) => ({ type: "power", unit: "ftp", level });
const minutes = (count) => ({ type: "time", seconds: count * 60 });

const overUnders = {
  name: "Over-unders 3x3",
  sport: "cycling",
  steps: [
    {
      type: "step",
      intensity: "warmUp",
      duration: minutes(20),
      target: ftp({ kind: "range", low: 0.5, high: 0.65 }),
    },
    {
      type: "repeat",
      count: 3,
      steps: [
        { type: "step", duration: minutes(4), target: ftp({ kind: "constant", value: 0.95 }) },
        { type: "step", duration: minutes(4), target: ftp({ kind: "constant", value: 1.05 }) },
        {
          type: "step",
          intensity: "recovery",
          duration: minutes(4),
          target: ftp({ kind: "constant", value: 0.55 }),
        },
      ],
    },
    { type: "step", intensity: "coolDown", duration: minutes(19) },
  ],
};

const easyRun = {
  name: "Easy run",
  sport: "running",
  steps: [{ type: "step", duration: minutes(40) }],
};

const NOTES = "Keep it smooth, seated; no sprints.\nFuel: 60 g/h \\ water. Szép napot! 🚴‍♀️";

const asWorkout = (workout, notes = null) => ({ kind: "workout", workout, source: null, notes });

async function plan(client, day, content, position = 1) {
  return client.plannedWorkouts.put({
    id: randomUUID(),
    day,
    position,
    content,
    updatedAt: now(),
  });
}

async function runCron() {
  const { outcome } = await (await runtime.getWorker()).scheduled({ cron: "* * * * *" });
  assert.equal(outcome, "ok");
}

const RIDE_START = `${shifted(-1)}T06:00:00Z`;
const RIDE_SECONDS = 75 * 60;

async function seeded() {
  const signedIn = await athlete();
  const { client } = signedIn;
  const tomorrow = await plan(client, shifted(1), asWorkout(overUnders, NOTES));
  const rest = await plan(client, shifted(2), { kind: "rest", notes: null });
  const note = await plan(client, shifted(3), { kind: "note", title: "Race week", notes: null });
  const skipped = await plan(client, shifted(-1), asWorkout(easyRun), 2);
  await client.plannedWorkouts.skip({
    id: skipped.id,
    skipped: { reason: "Sore knee" },
    updatedAt: now(),
  });
  const missed = await plan(client, shifted(-2), asWorkout(easyRun));
  const done = await plan(client, shifted(-1), asWorkout(overUnders));
  const ride = await client.activities.upload({
    file: new File([denseRide(RIDE_SECONDS * 25 + 200, RIDE_START)], "ride.fit"),
    source: "upload",
    sport: "cycling",
  });
  for (let run = 0; run < 3; run++) await runCron();
  const feed = await client.calendarFeed.newAddress({});
  return { ...signedIn, tomorrow, rest, note, skipped, missed, done, ride, feed };
}

const fetchFeed = (path, init = {}) => runtime.dispatchFetch(`${api}${path}`, init);

async function feedOf(path) {
  const response = await fetchFeed(path);
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.text();
  const parsed = new ICAL.Component(ICAL.parse(body));
  const events = new Map(
    parsed.getAllSubcomponents("vevent").map((component) => {
      const event = new ICAL.Event(component);
      return [event.uid, { event, component }];
    }),
  );
  return { response, body, parsed, events };
}

const plannedUid = (id) => `planned-${id}@trainstackhq.com`;
const activityUid = (id) => `activity-${id}@trainstackhq.com`;

let athleteWithTraining;
const seededOnce = async () => (athleteWithTraining ??= await seeded());

test("a calendar app reads the athlete's planned training from the feed's address, with no session", async () => {
  const { feed, tomorrow, rest, note, skipped, missed, done } = await seededOnce();
  assert.equal(feed.withActivities, false);
  assert.match(feed.path, /^\/feeds\/calendar\/[A-Za-z0-9_-]{65}\.ics$/);

  const { response, parsed, events } = await feedOf(feed.path);
  assert.equal(response.headers.get("content-type"), "text/calendar; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "private, no-cache");
  assert.equal(parsed.getFirstPropertyValue("version"), "2.0");
  assert.equal(parsed.getFirstPropertyValue("x-wr-calname"), "Trainstack");
  assert.equal(parsed.getFirstPropertyValue("x-wr-timezone"), ZONE);
  assert.equal(parsed.getFirstPropertyValue("refresh-interval").toString(), "PT1H");

  const ride = events.get(plannedUid(tomorrow.id));
  assert.ok(ride, "tomorrow's ride is in the feed");
  assert.ok(ride.event.startDate.isDate, "a planned workout is an all-day event");
  assert.equal(ride.event.startDate.toString(), shifted(1));
  assert.equal(ride.event.endDate.toString(), shifted(2));
  assert.equal(
    ride.event.summary,
    `Ride: Over-unders 3x3, 1 h 15, load ${Math.round(tomorrow.planned.load)}`,
  );
  assert.equal(
    ride.event.description,
    [
      `1 h 15 · load ${Math.round(tomorrow.planned.load)}`,
      [
        "Warm-up: 20 min at 50-65% FTP",
        "3 times",
        "  4 min at 95% FTP",
        "  4 min at 105% FTP",
        "  Recovery: 4 min at 55% FTP",
        "Cool-down: 19 min",
      ].join("\n"),
      `Notes: ${NOTES}`,
      `${origin}/calendar/planned/${tomorrow.id}`,
    ].join("\n\n"),
  );
  assert.equal(
    ride.component.getFirstPropertyValue("url"),
    `${origin}/calendar/planned/${tomorrow.id}`,
  );
  assert.equal(ride.component.getFirstPropertyValue("transp"), "TRANSPARENT");
  assert.equal(
    ride.component.getFirstPropertyValue("dtstamp").toJSDate().getTime(),
    Math.floor(tomorrow.updatedAt.getTime() / 1000) * 1000,
  );

  assert.equal(events.get(plannedUid(rest.id)).event.summary, "Rest day");
  assert.equal(events.get(plannedUid(note.id)).event.summary, "Race week");
  assert.equal(
    events.get(plannedUid(skipped.id)).event.summary,
    "Skipped · Run: Easy run, 40 min, load 28",
  );
  assert.equal(
    events.get(plannedUid(missed.id)).event.summary,
    "Missed · Run: Easy run, 40 min, load 28",
  );
  assert.match(events.get(plannedUid(done.id)).event.summary, /^✓ Ride: Over-unders 3x3, 1 h 15/);
  assert.ok(
    [...events.keys()].every((uid) => uid.startsWith("planned-")),
    "planned only: no activities",
  );
});

test("the feed shows completed activities at their real time when the athlete chooses it, and never where they went", async () => {
  const { client, ride, skipped } = await seededOnce();
  const feed = await client.calendarFeed.setActivities({ withActivities: true });
  assert.equal(feed.withActivities, true);
  const { body, events } = await feedOf(feed.path);
  const done = events.get(activityUid(ride.id));
  assert.ok(done, "the ride is in the feed");
  assert.equal(done.event.startDate.toJSDate().toISOString(), new Date(RIDE_START).toISOString());
  assert.equal(done.event.startDate.zone.tzid, "UTC");
  const seconds = (done.event.endDate.toJSDate() - done.event.startDate.toJSDate()) / 1000;
  assert.ok(Math.abs(seconds - RIDE_SECONDS) <= 10, `lasts as long as the ride, not ${seconds} s`);
  assert.match(done.event.summary, /^Ride, [\d.]+ km/);
  assert.equal(done.component.getFirstPropertyValue("url"), `${origin}/activities/${ride.id}`);
  assert.equal(done.component.getFirstPropertyValue("transp"), "OPAQUE");

  for (const leak of ["LOCATION", "GEO", "56.6", "22.7", "bpm", "Sore knee", "heart"]) {
    assert.ok(!body.includes(leak), `the feed holds no ${leak}`);
  }
  assert.ok(events.get(plannedUid(skipped.id)));
  await client.calendarFeed.setActivities({ withActivities: false });
});

test("the feed is valid iCalendar: CRLF lines of at most 75 octets, folded inside characters' bounds, with text escaped", async () => {
  const {
    tomorrow,
    feed: { path },
  } = await seededOnce();
  const { body, events } = await feedOf(path);
  assert.ok(body.endsWith("\r\n"));
  const lines = body.slice(0, -2).split("\r\n");
  assert.ok(!lines.some((line) => line.includes("\n") || line.includes("\r")), "only CRLF breaks");
  for (const line of lines) {
    assert.ok(Buffer.byteLength(line) <= 75, `${line} is longer than 75 octets`);
    assert.ok(!line.includes("�"));
  }
  assert.ok(
    lines.some((line) => line.startsWith(" ")),
    "the long description is folded",
  );
  const unfolded = body.replace(/\r\n /g, "");
  assert.ok(
    unfolded.includes("Keep it smooth\\, seated\\; no sprints.\\nFuel: 60 g/h \\\\ water."),
  );
  assert.ok(events.get(plannedUid(tomorrow.id)).event.description.includes(NOTES));
  assert.equal(lines[0], "BEGIN:VCALENDAR");
  assert.equal(lines.at(-1), "END:VCALENDAR");
  for (const { component } of events.values()) {
    assert.ok(component.getFirstPropertyValue("dtstamp"), "every event has a DTSTAMP");
  }
});

test("an unchanged feed answers a polling client with 304, and a change gives it a new ETag", async () => {
  const {
    client,
    rest,
    feed: { path },
  } = await seededOnce();
  const first = await fetchFeed(path);
  const entityTag = first.headers.get("etag");
  const body = await first.text();
  assert.match(entityTag, /^"[A-Za-z0-9_-]{43}"$/);
  const again = await fetchFeed(path);
  assert.equal(again.headers.get("etag"), entityTag);
  assert.equal(await again.text(), body, "the same training gives the same bytes");

  const unchanged = await fetchFeed(path, { headers: { "If-None-Match": entityTag } });
  assert.equal(unchanged.status, 304);
  assert.equal(await unchanged.text(), "");
  assert.equal(unchanged.headers.get("etag"), entityTag);
  const listed = await fetchFeed(path, { headers: { "If-None-Match": `"other", W/${entityTag}` } });
  assert.equal(listed.status, 304);

  const head = await fetchFeed(path, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("etag"), entityTag);

  await client.plannedWorkouts.put({
    id: rest.id,
    day: rest.day,
    position: rest.position,
    content: { kind: "rest", notes: "Travel day" },
    updatedAt: now(),
  });
  const changed = await fetchFeed(path, { headers: { "If-None-Match": entityTag } });
  assert.equal(changed.status, 200);
  assert.notEqual(changed.headers.get("etag"), entityTag);
});

test("a moved or edited workout updates under the same UID, and a deleted one leaves the feed", async () => {
  const { client } = await athlete();
  const { path } = await client.calendarFeed.newAddress({});
  const planned = await plan(client, shifted(1), asWorkout(easyRun));
  const before = (await feedOf(path)).events.get(plannedUid(planned.id));
  assert.equal(before.event.startDate.toString(), shifted(1));
  const stampBefore = before.component.getFirstPropertyValue("last-modified").toJSDate();

  const moved = await client.plannedWorkouts.move({
    id: planned.id,
    day: shifted(4),
    position: 1,
    updatedAt: now(),
  });
  const afterMove = (await feedOf(path)).events;
  assert.equal(afterMove.size, 1);
  const movedEvent = afterMove.get(plannedUid(planned.id));
  assert.equal(movedEvent.event.startDate.toString(), shifted(4));
  assert.ok(movedEvent.component.getFirstPropertyValue("last-modified").toJSDate() > stampBefore);

  await client.plannedWorkouts.put({
    id: planned.id,
    day: moved.day,
    position: moved.position,
    content: asWorkout({ ...easyRun, name: "Recovery run" }),
    updatedAt: now(),
  });
  const edited = (await feedOf(path)).events.get(plannedUid(planned.id));
  assert.equal(edited.event.summary, "Run: Recovery run, 40 min, load 28");

  await client.plannedWorkouts.delete({ id: planned.id });
  assert.equal((await feedOf(path)).events.size, 0);
});

async function refusal(path, init) {
  const response = await fetchFeed(path, init);
  return {
    status: response.status,
    body: await response.text(),
    type: response.headers.get("content-type"),
    cache: response.headers.get("cache-control"),
  };
}

test("a new address works at once and the old one stops, as does a feed turned off", async () => {
  const { client } = await athlete();
  const first = await client.calendarFeed.newAddress({ withActivities: true });
  assert.equal((await fetchFeed(first.path)).status, 200);
  const second = await client.calendarFeed.newAddress({});
  assert.notEqual(second.path, first.path);
  assert.equal(second.withActivities, true, "a new address keeps the choice");
  assert.equal((await refusal(first.path)).status, 404);
  assert.equal((await fetchFeed(second.path)).status, 200);
  assert.deepEqual((await client.calendarFeed.get({})).feed, second);

  await client.calendarFeed.turnOff({});
  assert.equal((await refusal(second.path)).status, 404);
  assert.deepEqual(await client.calendarFeed.get({}), { feed: null });
  const [error] = await safe(client.calendarFeed.setActivities({ withActivities: true }));
  assert.ok(isDefinedError(error));
  assert.equal(error.code, "NOT_FOUND");
});

test("a wrong address says nothing about whether an account or a feed exists", async () => {
  const { client } = await athlete();
  const live = await client.calendarFeed.newAddress({});
  const token = live.path.slice("/feeds/calendar/".length, -".ics".length);
  const flipped = `${token.slice(0, -1)}${token.at(-1) === "A" ? "B" : "A"}`;
  const otherFeedsSignature = `${"A".repeat(22)}${token.slice(22)}`;
  const replaced = (await client.calendarFeed.newAddress({})).path;
  const off = await athlete();
  const turnedOff = (await off.client.calendarFeed.newAddress({})).path;
  await off.client.calendarFeed.turnOff({});

  const answers = await Promise.all(
    [
      `/feeds/calendar/${flipped}.ics`,
      `/feeds/calendar/${otherFeedsSignature}.ics`,
      `/feeds/calendar/${"x".repeat(65)}.ics`,
      `/feeds/calendar/${token}`,
      "/feeds/calendar/nothing.ics",
      `/feeds/calendar/${token}/${token}.ics`,
      live.path,
      turnedOff,
    ].map((path) => refusal(path)),
  );
  for (const answer of answers) {
    assert.deepEqual(answer, {
      status: 404,
      body: "Not found\n",
      type: "text/plain; charset=utf-8",
      cache: "no-store",
    });
  }
  assert.equal((await fetchFeed(replaced)).status, 200);
});

test("only a signed-in athlete manages a feed, and only their own", async () => {
  const anonymous = rpcClient(runtime);
  const [error] = await safe(anonymous.calendarFeed.newAddress({}));
  assert.ok(isDefinedError(error));
  assert.equal(error.code, "UNAUTHORIZED");

  const one = await athlete();
  const other = await athlete();
  await plan(one.client, shifted(1), asWorkout(overUnders));
  const oneFeed = await one.client.calendarFeed.newAddress({});
  const otherFeed = await other.client.calendarFeed.newAddress({});
  assert.notEqual(oneFeed.path, otherFeed.path);
  assert.equal((await feedOf(otherFeed.path)).events.size, 0);
  assert.equal((await feedOf(oneFeed.path)).events.size, 1);
});

test("the feed's secret never reaches the logs, whether its address works or not", async () => {
  const { client } = await athlete();
  const written = [];
  const write = process.stdout.write;
  const writeError = process.stderr.write;
  process.stdout.write = (chunk, ...rest) => (
    written.push(String(chunk)),
    write.call(process.stdout, chunk, ...rest)
  );
  process.stderr.write = (chunk, ...rest) => (
    written.push(String(chunk)),
    writeError.call(process.stderr, chunk, ...rest)
  );
  let paths;
  try {
    const old = await client.calendarFeed.newAddress({});
    const current = await client.calendarFeed.newAddress({ withActivities: true });
    paths = [old.path, current.path];
    for (const path of paths) await fetchFeed(path);
    await fetchFeed(`${current.path.slice(0, -6)}x.ics`);
    await client.calendarFeed.get({});
    await new Promise((resolve) => setTimeout(resolve, 200));
  } finally {
    process.stdout.write = write;
    process.stderr.write = writeError;
  }
  const logs = written.join("");
  assert.match(logs, /calendarFeed\/newAddress/, "the logs are captured");
  for (const path of paths) {
    const token = path.slice("/feeds/calendar/".length, -".ics".length);
    assert.ok(!logs.includes(token.slice(0, 22)), "no feed id in the logs");
    assert.ok(!logs.includes(token.slice(22)), "no signature in the logs");
  }
  assert.ok(!logs.includes("/feeds/calendar/"), "feed requests are not logged by address");
});

test("the settings page offers the address to each calendar app in the form it subscribes with", async () => {
  const { feedUrl, googleCalendarUrl, outlookUrl, subscribeUrl } =
    await import("../hosted/apps/account/src/lib/calendar-feed.ts");
  const url = feedUrl("https://api.trainstackhq.com/", "/feeds/calendar/abc.ics");
  assert.equal(url, "https://api.trainstackhq.com/feeds/calendar/abc.ics");
  assert.equal(subscribeUrl(url), "webcal://api.trainstackhq.com/feeds/calendar/abc.ics");
  assert.equal(
    new URL(googleCalendarUrl(url)).searchParams.get("cid"),
    "webcal://api.trainstackhq.com/feeds/calendar/abc.ics",
  );
  assert.equal(new URL(outlookUrl(url)).searchParams.get("url"), url);
});
