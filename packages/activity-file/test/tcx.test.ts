import assert from "node:assert/strict";
import { test } from "node:test";

import { ActivityFileError, decodeTcx } from "../src/index.ts";
import { file, plain, text } from "./files.ts";

test("decodes a Garmin Connect ride with laps, lap extensions and a pause", () => {
  const ride = decodeTcx(file("garmin-connect-ride.tcx"));
  assert.equal(ride.format, "tcx");
  assert.deepEqual(plain(ride.summary), {
    startTime: "2026-09-20T07:00:00.000Z",
    sport: "cycling",
    elapsedSeconds: 181,
    timerSeconds: 90,
    distanceMetres: 800,
    calories: 25,
    averageSpeedMetresPerSecond: 8.889,
    maxSpeedMetresPerSecond: 10.5,
    averageHeartRate: 135,
    maxHeartRate: 150,
    averageCadence: 89,
    maxCadence: 97,
    averagePower: 225,
    maxPower: 270,
    totalAscentMetres: 6,
    totalDescentMetres: 8,
  });
  assert.deepEqual(plain(ride.laps[0]), {
    startTime: "2026-09-20T07:00:00.000Z",
    endTime: "2026-09-20T07:02:30.000Z",
    sport: "cycling",
    startLatitude: 47.5,
    startLongitude: 19,
    trigger: "manual",
    elapsedSeconds: 150,
    timerSeconds: 60,
    distanceMetres: 500,
    calories: 15,
    averageSpeedMetresPerSecond: 8.333,
    maxSpeedMetresPerSecond: 9.5,
    averageHeartRate: 130,
    maxHeartRate: 141,
    averageCadence: 88,
    maxCadence: 95,
    averagePower: 210,
    maxPower: 240,
  });
  assert.equal(ride.laps[1]!.trigger, "distance");
  assert.deepEqual(plain(ride.records[1]), {
    time: "2026-09-20T07:00:30.000Z",
    elapsedSeconds: 30,
    power: 230,
    heartRate: 135,
    cadence: 90,
    speedMetresPerSecond: 9.5,
    distanceMetres: 250,
    latitude: 47.502,
    longitude: 19,
    altitudeMetres: 126,
    developerFields: {},
  });
  assert.deepEqual(plain(ride.events), [
    { time: "2026-09-20T07:00:30.000Z", event: "timer", type: "stopAll" },
    { time: "2026-09-20T07:02:30.000Z", event: "timer", type: "start" },
  ]);
});

test("decodes a Strava run, whose TCX starts with spaces before the XML declaration", () => {
  const run = decodeTcx(file("strava-run.tcx"));
  assert.deepEqual(plain(run.summary), {
    startTime: "2026-10-10T05:45:00.000Z",
    sport: "running",
    elapsedSeconds: 20,
    timerSeconds: 20,
    distanceMetres: 60,
    calories: 4,
    averageSpeedMetresPerSecond: 3,
    averageHeartRate: 146,
    maxHeartRate: 152,
    averageCadence: 86,
    maxCadence: 88,
    totalAscentMetres: 0,
    totalDescentMetres: 0,
  });
  assert.deepEqual(
    run.records.map((record) => record.cadence),
    [84, 86, 88],
  );
});

test("decodes a Wahoo indoor ride with no position, altitude or distance", () => {
  const ride = decodeTcx(file("wahoo-indoor-ride.tcx"));
  assert.equal(ride.summary.averagePower, 165);
  assert.equal(ride.summary.maxPower, 181);
  assert.equal(ride.summary.distanceMetres, 0);
  assert.equal(ride.summary.totalAscentMetres, undefined);
  assert.ok(ride.records.every((record) => record.latitude === undefined));
  assert.ok(ride.records.every((record) => record.distanceMetres === undefined));
});

test("sums a multisport file's activities and calls its sport multisport", () => {
  const activity = decodeTcx(
    text(`<TrainingCenterDatabase><Activities><MultiSportSession>
      <FirstSport><Activity Sport="Running"><Id>2026-06-01T08:00:00Z</Id>
        <Lap StartTime="2026-06-01T08:00:00Z"><TotalTimeSeconds>600</TotalTimeSeconds><DistanceMeters>2000</DistanceMeters></Lap>
      </Activity></FirstSport>
      <NextSport><Activity Sport="Biking"><Id>2026-06-01T08:12:00Z</Id>
        <Lap StartTime="2026-06-01T08:12:00Z"><TotalTimeSeconds>1200</TotalTimeSeconds><DistanceMeters>10000</DistanceMeters></Lap>
      </Activity></NextSport>
    </MultiSportSession></Activities></TrainingCenterDatabase>`),
  );
  assert.equal(activity.summary.sport, "multisport");
  assert.equal(activity.summary.timerSeconds, 1800);
  assert.equal(activity.summary.elapsedSeconds, 1920);
  assert.equal(activity.summary.distanceMetres, 12000);
  assert.deepEqual(
    activity.laps.map((lap) => lap.sport),
    ["running", "cycling"],
  );
  assert.deepEqual(activity.records, []);
});

test("rejects a course, which has no activity", () => {
  assert.throws(
    () => decodeTcx(file("course.tcx")),
    (error) =>
      error instanceof ActivityFileError && error.code === "noActivity" && error.format === "tcx",
  );
});
