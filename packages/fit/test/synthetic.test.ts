import assert from "node:assert/strict";
import { test } from "node:test";

import { decodeFit } from "../src/index.ts";
import { FitWriter, fitTime, semicircles, type FieldSpec } from "./fit-writer.ts";

const start = fitTime("2026-05-01T07:00:00Z");

const fileIdFields: FieldSpec[] = [
  { number: 0, type: "enum" },
  { number: 1, type: "uint16" },
  { number: 2, type: "uint16" },
  { number: 3, type: "uint32z" },
  { number: 4, type: "uint32" },
];

const recordFields: FieldSpec[] = [
  { number: 253, type: "uint32" },
  { number: 0, type: "sint32" },
  { number: 1, type: "sint32" },
  { number: 78, type: "uint32" },
  { number: 73, type: "uint32" },
  { number: 3, type: "uint8" },
  { number: 4, type: "uint8" },
  { number: 5, type: "uint32" },
  { number: 7, type: "uint16" },
  { number: 13, type: "sint8" },
];

const sessionFields: FieldSpec[] = [
  { number: 253, type: "uint32" },
  { number: 2, type: "uint32" },
  { number: 5, type: "enum" },
  { number: 6, type: "enum" },
  { number: 7, type: "uint32" },
  { number: 8, type: "uint32" },
  { number: 9, type: "uint32" },
  { number: 11, type: "uint16" },
  { number: 16, type: "uint8" },
  { number: 17, type: "uint8" },
  { number: 22, type: "uint16" },
  { number: 23, type: "uint16" },
  { number: 124, type: "uint32" },
  { number: 3, type: "sint32" },
  { number: 4, type: "sint32" },
];

const lapFields: FieldSpec[] = [
  { number: 253, type: "uint32" },
  { number: 2, type: "uint32" },
  { number: 7, type: "uint32" },
  { number: 9, type: "uint32" },
  { number: 24, type: "enum" },
  { number: 25, type: "enum" },
];

const eventFields: FieldSpec[] = [
  { number: 253, type: "uint32" },
  { number: 0, type: "enum" },
  { number: 1, type: "enum" },
  { number: 3, type: "uint32" },
];

function trailRun(options: { bigEndian?: boolean } = {}) {
  const writer = new FitWriter()
    .define(0, 0, fileIdFields, options)
    .data(0, [4, 1, 4315, 3_400_000_001, start])
    .define(1, 21, eventFields, options)
    .data(1, [start, 0, 0, 0])
    .define(2, 20, recordFields, options);
  const points = [
    [47.4979, 19.0402, 120.4, 2.81, 141, 82, 0, 210, -3],
    [47.49795, 19.04027, 121.2, 2.95, 143, 84, 290, null, -3],
    [47.498, 19.04035, 122.0, 3.02, 146, 85, 590, 230, -2],
  ] as const;
  points.forEach(([lat, long, altitude, speed, heartRate, cadence, distance, power, temp], i) => {
    writer.data(2, [
      start + i * 2,
      semicircles(lat),
      semicircles(long),
      Math.round((altitude + 500) * 5),
      Math.round(speed * 1000),
      heartRate,
      cadence,
      distance,
      power,
      temp,
    ]);
  });
  return writer
    .data(1, [start + 4, 0, 4, 0])
    .define(3, 19, lapFields, options)
    .data(3, [start + 4, start, 4000, 590, 7, 1])
    .define(4, 18, sessionFields, options)
    .data(4, [
      start + 4,
      start,
      1,
      3,
      4000,
      3500,
      590,
      45,
      143,
      146,
      2,
      null,
      2930,
      semicircles(47.4979),
      semicircles(19.0402),
    ])
    .file();
}

test("decodes a trail run with its route, altitude and temperature", () => {
  const run = decodeFit(trailRun());
  assert.equal(run.summary.sport, "running");
  assert.equal(run.summary.subSport, "trail");
  assert.equal(run.summary.startTime.toISOString(), "2026-05-01T07:00:00.000Z");
  assert.equal(run.summary.elapsedSeconds, 4);
  assert.equal(run.summary.timerSeconds, 3.5);
  assert.equal(run.summary.distanceMetres, 5.9);
  assert.equal(run.summary.calories, 45);
  assert.equal(run.summary.averageHeartRate, 143);
  assert.equal(run.summary.totalAscentMetres, 2);
  assert.equal(run.summary.totalDescentMetres, undefined);
  assert.equal(run.summary.averageSpeedMetresPerSecond, 2.93);
  assert.equal(run.summary.averagePower, 220);
  assert.equal(run.sessions[0]!.startLatitude!.toFixed(5), "47.49790");

  assert.deepEqual(
    run.records.map((record) => [
      record.elapsedSeconds,
      record.latitude!.toFixed(5),
      record.longitude!.toFixed(5),
      record.altitudeMetres,
      record.speedMetresPerSecond,
      record.heartRate,
      record.cadence,
      record.distanceMetres,
      record.power,
      record.temperatureCelsius,
    ]),
    [
      [0, "47.49790", "19.04020", 120.4, 2.81, 141, 82, 0, 210, -3],
      [2, "47.49795", "19.04027", 121.2, 2.95, 143, 84, 2.9, undefined, -3],
      [4, "47.49800", "19.04035", 122, 3.02, 146, 85, 5.9, 230, -2],
    ],
  );
  assert.deepEqual(
    run.events.map((event) => [event.event, event.type, event.data]),
    [
      ["timer", "start", 0],
      ["timer", "stopAll", 0],
    ],
  );
  assert.equal(run.laps[0]!.trigger, "sessionEnd");
  assert.equal(run.laps[0]!.sport, "running");
  assert.equal(run.fileId!.serialNumber, 3_400_000_001);
});

test("decodes a file written big-endian the same as one written little-endian", () => {
  assert.deepEqual(decodeFit(trailRun({ bigEndian: true })), decodeFit(trailRun()));
});

test("decodes a file whose header has no checksum", () => {
  const data = new FitWriter()
    .define(0, 20, [
      { number: 253, type: "uint32" },
      { number: 7, type: "uint16" },
    ])
    .data(0, [start, 180])
    .file({ headerSize: 12 });
  assert.equal(decodeFit(data).records[0]!.power, 180);
});

test("counts FIT timestamps from the last day of 1989", () => {
  const data = new FitWriter()
    .define(0, 20, [{ number: 253, type: "uint32" }])
    .data(0, [0])
    .file();
  assert.equal(decodeFit(data).records[0]!.time.toISOString(), "1989-12-31T00:00:00.000Z");
});

test("works out compressed timestamps from the last full one, across a rollover", () => {
  const first = start - (start % 32) + 30;
  const data = new FitWriter()
    .define(0, 20, [
      { number: 253, type: "uint32" },
      { number: 7, type: "uint16" },
    ])
    .define(1, 20, [{ number: 7, type: "uint16" }])
    .data(0, [first, 100])
    .compressed(1, 31, [101])
    .compressed(1, 2, [102])
    .compressed(1, 3, [103])
    .file();
  const ride = decodeFit(data);
  assert.deepEqual(
    ride.records.map((record) => [record.elapsedSeconds, record.power]),
    [
      [0, 100],
      [1, 101],
      [4, 102],
      [5, 103],
    ],
  );
});

test("summarizes from the records when the file has no session", () => {
  const data = new FitWriter()
    .define(0, 20, [
      { number: 253, type: "uint32" },
      { number: 3, type: "uint8" },
      { number: 4, type: "uint8" },
      { number: 5, type: "uint32" },
      { number: 7, type: "uint16" },
    ])
    .data(0, [start, 120, 80, 0, 200])
    .data(0, [start + 1, 121, null, 500, 201])
    .data(0, [start + 2, 124, 90, 1000, null])
    .file();
  const summary = decodeFit(data).summary;
  assert.equal(summary.startTime.toISOString(), "2026-05-01T07:00:00.000Z");
  assert.equal(summary.sport, undefined);
  assert.equal(summary.elapsedSeconds, 2);
  assert.equal(summary.timerSeconds, 2);
  assert.equal(summary.distanceMetres, 10);
  assert.equal(summary.averageHeartRate, 122);
  assert.equal(summary.maxHeartRate, 124);
  assert.equal(summary.averageCadence, 85);
  assert.equal(summary.averagePower, 201);
  assert.equal(summary.maxPower, 201);
});

test("summarizes a multisport activity across its sessions, weighting averages by time", () => {
  const fields: FieldSpec[] = [
    { number: 253, type: "uint32" },
    { number: 2, type: "uint32" },
    { number: 5, type: "enum" },
    { number: 7, type: "uint32" },
    { number: 8, type: "uint32" },
    { number: 9, type: "uint32" },
    { number: 16, type: "uint8" },
    { number: 17, type: "uint8" },
  ];
  const data = new FitWriter()
    .define(0, 18, fields)
    .data(0, [start + 600, start, 1, 600_000, 600_000, 200_000, 150, 170])
    .data(0, [start + 1800, start + 600, 2, 1_200_000, 1_200_000, 1_000_000, 135, 160])
    .file();
  const activity = decodeFit(data);
  assert.equal(activity.records.length, 0);
  assert.deepEqual(
    activity.sessions.map((session) => session.sport),
    ["running", "cycling"],
  );
  assert.equal(activity.summary.sport, "multisport");
  assert.equal(activity.summary.elapsedSeconds, 1800);
  assert.equal(activity.summary.distanceMetres, 12_000);
  assert.equal(activity.summary.averageHeartRate, 140);
  assert.equal(activity.summary.maxHeartRate, 170);
});

test("keeps a sport the profile does not name as its number", () => {
  const data = new FitWriter()
    .define(0, 18, [
      { number: 2, type: "uint32" },
      { number: 5, type: "enum" },
      { number: 6, type: "enum" },
    ])
    .data(0, [start, 200, 69])
    .file();
  const summary = decodeFit(data).summary;
  assert.equal(summary.sport, 200);
  assert.equal(summary.subSport, "bouldering");
});

test("reads developer fields by name, applying their scale and offset", () => {
  const data = new FitWriter()
    .define(0, 206, [
      { number: 0, type: "uint8" },
      { number: 1, type: "uint8" },
      { number: 2, type: "uint8" },
      { number: 3, type: "string", size: 16 },
      { number: 6, type: "uint8" },
      { number: 7, type: "sint8" },
    ])
    .data(0, [0, 0, 0x84, "core_temperature", 100, 0])
    .data(0, [0, 1, 0x02, "rpe", null, null])
    .define(
      1,
      20,
      [
        { number: 253, type: "uint32" },
        { number: 3, type: "uint8" },
      ],
      {
        developerFields: [
          { number: 0, size: 2, index: 0 },
          { number: 1, size: 1, index: 0 },
          { number: 9, size: 1, index: 0 },
        ],
      },
    )
    .data(1, [start, 140], [3721, 7, 1])
    .file();
  assert.deepEqual(decodeFit(data).records[0]!.developerFields, {
    core_temperature: 37.21,
    rpe: 7,
  });
});

test("scales every element of a developer field array", () => {
  const data = new FitWriter()
    .define(0, 206, [
      { number: 0, type: "uint8" },
      { number: 1, type: "uint8" },
      { number: 2, type: "uint8" },
      { number: 3, type: "string", size: 8 },
      { number: 6, type: "uint8" },
      { number: 7, type: "sint8" },
    ])
    .data(0, [0, 0, 0x84, "forces", 100, 1])
    .define(1, 20, [{ number: 253, type: "uint32" }], {
      developerFields: [{ number: 0, size: 6, index: 0 }],
    })
    .raw(0x01, ...[start & 0xff, (start >> 8) & 0xff, (start >> 16) & 0xff, start >>> 24])
    .raw(100, 0, 0xff, 0xff, 200, 0)
    .file();
  assert.deepEqual(decodeFit(data).records[0]!.developerFields, { forces: [0, null, 1] });
});

test("skips messages it does not model and records without a time", () => {
  const data = new FitWriter()
    .define(0, 23, [{ number: 2, type: "uint16" }])
    .data(0, [3121])
    .define(1, 20, [
      { number: 253, type: "uint32" },
      { number: 7, type: "uint16" },
    ])
    .data(1, [null, 999])
    .data(1, [start, 150])
    .file();
  assert.deepEqual(
    decodeFit(data).records.map((record) => record.power),
    [150],
  );
});

test("decodes FIT files chained one after another", () => {
  const part = (time: number, power: number) =>
    new FitWriter()
      .define(0, 20, [
        { number: 253, type: "uint32" },
        { number: 7, type: "uint16" },
      ])
      .data(0, [time, power])
      .file();
  const first = part(start, 100);
  const second = part(start + 1, 110);
  const chained = new Uint8Array(first.length + second.length);
  chained.set(first);
  chained.set(second, first.length);
  assert.deepEqual(
    decodeFit(chained).records.map((record) => [record.elapsedSeconds, record.power]),
    [
      [0, 100],
      [1, 110],
    ],
  );
});

test("accepts an ArrayBuffer and a view into a larger buffer", () => {
  const data = trailRun();
  const padded = new Uint8Array(data.length + 8);
  padded.set(data, 4);
  const expected = decodeFit(data);
  assert.deepEqual(decodeFit(padded.subarray(4, 4 + data.length)), expected);
  assert.deepEqual(decodeFit(data.slice().buffer), expected);
});
