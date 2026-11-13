import assert from "node:assert/strict";
import { test } from "node:test";

import { ActivityFileError, decodeGpx } from "../src/index.ts";
import { file, plain, text } from "./files.ts";

test("decodes a Strava ride with power, heart rate, cadence and temperature", () => {
  const ride = decodeGpx(file("strava-ride.gpx"));
  assert.equal(ride.format, "gpx");
  assert.equal(ride.name, "Morning Ride & Coffee");
  assert.deepEqual(plain(ride.summary), {
    startTime: "2026-09-12T06:58:31.000Z",
    sport: "cycling",
    elapsedSeconds: 3,
    timerSeconds: 3,
    distanceMetres: 53.079,
    averageSpeedMetresPerSecond: 17.693,
    averageHeartRate: 126,
    maxHeartRate: 131,
    averageCadence: 64,
    maxCadence: 88,
    averagePower: 160,
    maxPower: 250,
    totalAscentMetres: 5.2,
    totalDescentMetres: 0,
  });
  assert.deepEqual(plain(ride.records[1]), {
    time: "2026-09-12T06:58:32.000Z",
    elapsedSeconds: 1,
    power: 210,
    heartRate: 124,
    cadence: 85,
    distanceMetres: 15.831,
    latitude: 47.498,
    longitude: 19.04,
    altitudeMetres: 104.8,
    temperatureCelsius: 17,
    developerFields: {},
  });
  assert.deepEqual(ride.laps, []);
  assert.deepEqual(ride.events, []);
});

test("treats each track segment after the first as a pause, as Garmin Connect writes them", () => {
  const run = decodeGpx(file("garmin-connect-run.gpx"));
  assert.equal(run.name, "Budapest Running");
  assert.equal(run.summary.sport, "running");
  assert.equal(run.summary.elapsedSeconds, 68);
  assert.equal(run.summary.timerSeconds, 8);
  assert.deepEqual(
    run.records.map((record) => Math.round(record.distanceMetres!)),
    [0, 11, 11, 22],
  );
  assert.deepEqual(plain(run.events), [
    { time: "2026-10-03T16:30:04.000Z", event: "timer", type: "stopAll" },
    { time: "2026-10-03T16:31:04.000Z", event: "timer", type: "start" },
  ]);
  assert.deepEqual(
    run.records.map((record) => [record.heartRate, record.cadence]),
    [
      [132, 84],
      [138, 86],
      [120, 85],
      [142, 87],
    ],
  );
});

test("reads speed from an Apple Health route and ignores its accuracy fields", () => {
  const walk = decodeGpx(file("apple-health-walk.gpx"));
  assert.equal(walk.name, "Route 2026-08-01 9:12am");
  assert.equal(walk.summary.sport, undefined);
  assert.equal(walk.summary.maxSpeedMetresPerSecond, 1.501902);
  assert.deepEqual(
    walk.records.map((record) => record.speedMetresPerSecond),
    [1.412305, 1.468041, 1.501902],
  );
  assert.equal(walk.records[0]!.heartRate, undefined);
  assert.equal(walk.records[0]!.altitudeMetres, 118.452148);
});

test("reads Garmin's PowerExtension and TrackPointExtension v2 speed", () => {
  const ride = decodeGpx(file("wahoo-ride-power.gpx"));
  assert.equal(ride.summary.sport, "cycling");
  assert.equal(ride.summary.subSport, "road");
  assert.deepEqual(
    ride.records.map((record) => [record.power, record.speedMetresPerSecond]),
    [
      [200, 9.5],
      [220, 10.5],
    ],
  );
  assert.equal(ride.summary.averagePower, 210);
});

test("decodes GPX 1.0 with its speed element, waypoints and two tracks", () => {
  const activity = decodeGpx(file("gpx-1.0-two-tracks.gpx"));
  assert.equal(activity.name, "Part 1");
  assert.equal(activity.records.length, 4);
  assert.deepEqual(
    activity.records.map((record) => record.speedMetresPerSecond),
    [5, 5, 5, 5],
  );
  assert.equal(activity.summary.elapsedSeconds, 620);
  assert.equal(activity.summary.timerSeconds, 40);
  assert.equal(activity.summary.totalAscentMetres, 10);
  assert.equal(activity.summary.totalDescentMetres, 8);
  assert.equal(activity.events.length, 2);
});

test("skips points with a missing or unreadable time", () => {
  const activity = decodeGpx(file("missing-times.gpx"));
  assert.deepEqual(
    activity.records.map((record) => [record.time.toISOString(), record.longitude]),
    [
      ["2026-04-04T10:00:00.000Z", 17.001],
      ["2026-04-04T10:00:30.000Z", 17.003],
    ],
  );
  assert.equal(activity.summary.elapsedSeconds, 30);
});

test("rejects a route with no times as having no activity", () => {
  assert.throws(
    () => decodeGpx(file("route-without-times.gpx")),
    (error) =>
      error instanceof ActivityFileError && error.code === "noActivity" && error.format === "gpx",
  );
});

test("keeps a timed point without a position, and drops a position out of range", () => {
  const activity = decodeGpx(
    text(`<gpx version="1.1"><trk><trkseg>
      <trkpt lat="91" lon="19"><time>2026-01-01T00:00:00Z</time></trkpt>
      <trkpt><time>2026-01-01T00:00:01+01:00</time><extensions><hr>-5</hr><cad>NaN</cad></extensions></trkpt>
    </trkseg></trk></gpx>`),
  );
  assert.deepEqual(plain(activity.records), [
    { time: "2026-01-01T00:00:00.000Z", elapsedSeconds: 3599, developerFields: {} },
    { time: "2025-12-31T23:00:01.000Z", elapsedSeconds: 0, developerFields: {} },
  ]);
  assert.equal(activity.summary.startTime.toISOString(), "2025-12-31T23:00:01.000Z");
});

test("reads text in CDATA sections and with character references", () => {
  const activity = decodeGpx(
    text(`<?xml version="1.0"?>
      <!DOCTYPE gpx>
      <gpx version="1.1"><trk><name><![CDATA[Ride <with> marks]]> &#x1F6B4;&#233;</name><trkseg>
      <trkpt lat='47.5' lon='19'><time>2026-01-01T00:00:00.250Z</time></trkpt>
      </trkseg></trk></gpx>`),
  );
  assert.equal(activity.name, "Ride <with> marks 🚴é");
  assert.equal(activity.records[0]!.time.toISOString(), "2026-01-01T00:00:00.250Z");
});

test("decodes UTF-16 files with a byte order mark", () => {
  const source = `<gpx version="1.1"><trk><name>Été</name><trkseg><trkpt lat="1" lon="2"><time>2026-01-01T00:00:00Z</time></trkpt></trkseg></trk></gpx>`;
  const littleEndian = new Uint8Array(2 + source.length * 2);
  littleEndian.set([0xff, 0xfe]);
  for (let index = 0; index < source.length; index++) {
    littleEndian[2 + index * 2] = source.charCodeAt(index);
  }
  assert.equal(decodeGpx(littleEndian).name, "Été");
});
