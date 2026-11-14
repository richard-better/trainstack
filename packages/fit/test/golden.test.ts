import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { decodeFit } from "../src/index.ts";
import { sampleRide, trace } from "./goldens.ts";

describe("SampleRide.fit, as FITDecoderTests asserts", () => {
  const ride = decodeFit(sampleRide());

  test("decodes the summary", () => {
    assert.equal(ride.summary.elapsedSeconds, 1800);
    assert.equal(ride.summary.averagePower, 137);
    assert.equal(ride.summary.maxPower, 177);
    assert.equal(ride.summary.averageHeartRate, 146);
    assert.equal(ride.summary.maxHeartRate, 167);
    assert.ok(Math.abs(ride.summary.distanceMetres! - 14389) < 1);
  });

  test("takes the offset from UTC from the activity's local timestamp", () => {
    assert.equal(ride.summary.utcOffsetSeconds, 2 * 60 * 60);
  });

  test("decodes the sport", () => {
    assert.equal(ride.summary.sport, "cycling");
    assert.equal(ride.summary.subSport, "generic");
  });

  test("decodes one sample per second", () => {
    assert.equal(ride.records.length, 1801);
    assert.deepEqual(
      ride.records.map((record) => record.elapsedSeconds),
      Array.from({ length: 1801 }, (_, second) => second),
    );
    assert.ok(ride.records.some((record) => record.power !== undefined));
    assert.ok(ride.records.some((record) => record.heartRate !== undefined));
  });

  test("starts at the session start time", () => {
    assert.equal(ride.summary.startTime.getTime(), 1_791_296_475_000);
    assert.equal(ride.records[0]!.time.getTime(), 1_791_296_475_000);
  });

  test("decodes the first records in full", () => {
    assert.deepEqual(
      ride.records.slice(0, 3).map((record) => {
        const { time, developerFields, ...values } = record;
        assert.deepEqual(developerFields, {});
        assert.equal(time.getTime(), 1_791_296_475_000 + values.elapsedSeconds * 1000);
        return values;
      }),
      [
        {
          elapsedSeconds: 0,
          power: 43,
          heartRate: 99,
          cadence: 0,
          speedMetresPerSecond: 4.714,
          distanceMetres: 0,
          latitude: undefined,
          longitude: undefined,
          altitudeMetres: undefined,
          temperatureCelsius: undefined,
        },
        {
          elapsedSeconds: 1,
          power: 43,
          heartRate: 99,
          cadence: 0,
          speedMetresPerSecond: 4.714,
          distanceMetres: 4.71,
          latitude: undefined,
          longitude: undefined,
          altitudeMetres: undefined,
          temperatureCelsius: undefined,
        },
        {
          elapsedSeconds: 2,
          power: 50,
          heartRate: 97,
          cadence: 0,
          speedMetresPerSecond: 5.093,
          distanceMetres: 9.8,
          latitude: undefined,
          longitude: undefined,
          altitudeMetres: undefined,
          temperatureCelsius: undefined,
        },
      ],
    );
  });

  test("decodes the session's other totals", () => {
    const [session] = ride.sessions;
    assert.equal(ride.sessions.length, 1);
    assert.equal(session!.calories, 247);
    assert.equal(session!.averageSpeedMetresPerSecond, 7.993);
    assert.equal(session!.maxSpeedMetresPerSecond, 8.576);
    assert.equal(session!.averageCadence, 70);
    assert.equal(session!.maxCadence, 91);
    assert.equal(session!.timerSeconds, 1800);
    assert.equal(session!.firstLapIndex, 0);
    assert.equal(session!.lapCount, 10);
    assert.equal(session!.endTime!.toISOString(), "2026-10-06T14:51:15.000Z");
  });

  test("decodes the ten laps", () => {
    assert.equal(ride.laps.length, 10);
    const [first] = ride.laps;
    assert.equal(first!.startTime!.toISOString(), "2026-10-06T14:21:15.000Z");
    assert.equal(first!.elapsedSeconds, 180);
    assert.equal(first!.distanceMetres, 1336.85);
    assert.equal(first!.averagePower, 114);
    assert.equal(first!.maxHeartRate, 134);
    assert.equal(first!.trigger, "manual");
    assert.equal(first!.sport, "cycling");
    assert.equal(ride.laps.at(-1)!.trigger, "sessionEnd");
    const lapSeconds = ride.laps.reduce((total, lap) => total + lap.elapsedSeconds!, 0);
    assert.equal(lapSeconds, 1791);
  });

  test("decodes the timer events", () => {
    assert.deepEqual(
      ride.events.map((event) => [event.time!.toISOString(), event.event, event.type]),
      [
        ["2026-10-06T14:21:15.000Z", "timer", "start"],
        ["2026-10-06T14:51:15.000Z", "timer", "stopAll"],
      ],
    );
  });

  test("decodes the file id", () => {
    assert.deepEqual(ride.fileId, {
      type: "activity",
      manufacturer: 1,
      product: 3121,
      serialNumber: 3987112345,
      timeCreated: new Date("2026-10-06T14:21:15.000Z"),
    });
  });
});

describe("Ride's own recordings in the trace goldens", () => {
  const cases = [
    {
      name: "quick-test-trainer-drop",
      start: 1_800_000_000,
      workoutName: "Quick test 45s",
      elapsedSeconds: 45,
      distanceMetres: 305.2,
      averagePower: 204,
      maxPower: 305,
      averageHeartRate: 108,
      maxHeartRate: 144,
      records: 45,
      first: { power: 129, targetPower: 125, heartRate: 77, cadence: 87, speed: 1.704 },
    },
    {
      name: "recovery-every-control",
      start: 1_800_000_000,
      workoutName: "Recovery 10",
      elapsedSeconds: 550,
      distanceMetres: 3596.22,
      averagePower: 141,
      maxPower: 179,
      averageHeartRate: 138,
      maxHeartRate: 158,
      records: 550,
      first: { power: 109, targetPower: 105, heartRate: 77, cadence: 87, speed: 1.565 },
    },
    {
      name: "trainer-and-strap",
      start: 1_793_307_200,
      workoutName: "Quick test 45s",
      elapsedSeconds: 50,
      distanceMetres: 331.11,
      averagePower: 148,
      maxPower: 222,
      averageHeartRate: undefined,
      maxHeartRate: undefined,
      records: 50,
      first: { power: 204, targetPower: 125, heartRate: undefined, cadence: 89, speed: 2.187 },
    },
  ] as const;

  for (const expected of cases) {
    test(`decodes ${expected.name}.fit`, () => {
      const ride = decodeFit(trace(expected.name));
      assert.equal(ride.summary.startTime.getTime(), expected.start * 1000);
      assert.equal(ride.workoutName, expected.workoutName);
      assert.equal(ride.summary.sport, "cycling");
      assert.equal(ride.summary.subSport, "virtualActivity");
      assert.equal(ride.summary.elapsedSeconds, expected.elapsedSeconds);
      assert.equal(ride.summary.distanceMetres, expected.distanceMetres);
      assert.equal(ride.summary.averagePower, expected.averagePower);
      assert.equal(ride.summary.maxPower, expected.maxPower);
      assert.equal(ride.summary.averageHeartRate, expected.averageHeartRate);
      assert.equal(ride.summary.maxHeartRate, expected.maxHeartRate);
      assert.equal(ride.records.length, expected.records);
      assert.deepEqual(
        ride.records.map((record) => record.elapsedSeconds),
        Array.from({ length: expected.records }, (_, index) => index + 1),
      );
      const [first] = ride.records;
      assert.equal(first!.power, expected.first.power);
      assert.equal(first!.developerFields.target_power, expected.first.targetPower);
      assert.equal(first!.heartRate, expected.first.heartRate);
      assert.equal(first!.cadence, expected.first.cadence);
      assert.equal(first!.speedMetresPerSecond, expected.first.speed);
      assert.equal(ride.laps.length, 1);
      assert.deepEqual(
        ride.events.map((event) => [event.event, event.type]),
        [
          ["timer", "start"],
          ["timer", "stopAll"],
        ],
      );
      assert.equal(ride.fileId!.manufacturer, 255);
    });
  }
});
