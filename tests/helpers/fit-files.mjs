import { fitChecksum } from "../../packages/fit/src/checksum.ts";
import { FitWriter, fitTime } from "../../packages/fit/test/fit-writer.ts";

const HEADER_SIZE = 14;
const CHECKSUM_SIZE = 2;
const RECORD_DEFINITION = [
  0x40, 0, 0, 20, 0, 9, 253, 4, 0x86, 7, 2, 0x84, 3, 1, 0x02, 4, 1, 0x02, 6, 2, 0x84, 5, 4, 0x86, 0,
  4, 0x85, 1, 4, 0x85, 2, 2, 0x84,
];
const RECORD_SIZE = 25;

const straightLine = (i) => [566_000_000 + i, 227_000_000 + i];

export function denseRide(
  targetBytes,
  startIso = "2026-08-01T06:00:00Z",
  { position = straightLine } = {},
) {
  const records = Math.floor(
    (targetBytes - HEADER_SIZE - CHECKSUM_SIZE - RECORD_DEFINITION.length) / RECORD_SIZE,
  );
  const dataSize = RECORD_DEFINITION.length + records * RECORD_SIZE;
  const bytes = new Uint8Array(HEADER_SIZE + dataSize + CHECKSUM_SIZE);
  const view = new DataView(bytes.buffer);
  bytes.set([HEADER_SIZE, 0x20], 0);
  view.setUint16(2, 2140, true);
  view.setUint32(4, dataSize, true);
  bytes.set([0x2e, 0x46, 0x49, 0x54], 8);
  view.setUint16(12, fitChecksum(bytes, 0, 12), true);
  bytes.set(RECORD_DEFINITION, HEADER_SIZE);
  const start = fitTime(startIso);
  let offset = HEADER_SIZE + RECORD_DEFINITION.length;
  for (let i = 0; i < records; i++) {
    bytes[offset] = 0;
    view.setUint32(offset + 1, start + i, true);
    view.setUint16(offset + 5, 150 + (i % 100), true);
    bytes[offset + 7] = 140;
    bytes[offset + 8] = 90;
    view.setUint16(offset + 9, 8000, true);
    view.setUint32(offset + 11, i * 800, true);
    const [latitude, longitude] = position(i);
    view.setInt32(offset + 15, latitude, true);
    view.setInt32(offset + 19, longitude, true);
    view.setUint16(offset + 23, 2600, true);
    offset += RECORD_SIZE;
  }
  view.setUint16(offset, fitChecksum(bytes, 0, offset), true);
  return bytes;
}

export function pausedRun() {
  const start = fitTime("2026-09-01T06:00:00Z");
  const event = [
    { number: 253, type: "uint32" },
    { number: 0, type: "enum" },
    { number: 1, type: "enum" },
  ];
  const record = [
    { number: 253, type: "uint32" },
    { number: 3, type: "uint8" },
  ];
  const session = [
    { number: 253, type: "uint32" },
    { number: 2, type: "uint32" },
    { number: 5, type: "enum" },
    { number: 6, type: "enum" },
    { number: 7, type: "uint32" },
    { number: 8, type: "uint32" },
    { number: 9, type: "uint32" },
  ];
  const TIMER = 0;
  const START = 0;
  const STOP_ALL = 4;
  const RUNNING = 1;
  const TREADMILL = 1;
  return new FitWriter()
    .define(0, 21, event)
    .define(1, 20, record)
    .define(2, 18, session)
    .data(0, [start, TIMER, START])
    .data(1, [start, 150])
    .data(1, [start + 600, 160])
    .data(0, [start + 600, TIMER, STOP_ALL])
    .data(0, [start + 660, TIMER, START])
    .data(1, [start + 660, 140])
    .data(1, [start + 1200, 165])
    .data(0, [start + 1200, TIMER, STOP_ALL])
    .data(2, [start + 1200, start, RUNNING, TREADMILL, 1_200_000, 1_140_000, 300_000])
    .file();
}

export function manyLaps(count) {
  const start = fitTime("2026-09-02T06:00:00Z");
  const lap = [
    { number: 253, type: "uint32" },
    { number: 2, type: "uint32" },
    { number: 7, type: "uint32" },
    { number: 8, type: "uint32" },
  ];
  const writer = new FitWriter()
    .define(1, 20, [
      { number: 253, type: "uint32" },
      { number: 7, type: "uint16" },
    ])
    .data(1, [start, 200])
    .define(0, 19, lap);
  for (let i = 0; i < count; i++) writer.data(0, [start + i + 1, start + i, 1000, 1000]);
  return writer.file();
}

const FIT_SPORTS = { running: 1, cycling: 2 };
const FIT_SUB_SPORTS = { indoorCycling: 6, road: 7 };

export function recordedSession({
  start,
  elapsedSeconds,
  timerSeconds = elapsedSeconds,
  sport = "cycling",
  subSport,
  distanceMetres,
  power,
  heartRate,
  cadence,
}) {
  const startTime = fitTime(start);
  const end = startTime + elapsedSeconds;
  const session = [
    { number: 253, type: "uint32" },
    { number: 2, type: "uint32" },
    { number: 5, type: "enum" },
    { number: 6, type: "enum" },
    { number: 7, type: "uint32" },
    { number: 8, type: "uint32" },
    { number: 9, type: "uint32" },
    { number: 16, type: "uint8" },
    { number: 18, type: "uint8" },
    { number: 20, type: "uint16" },
  ];
  const optional = (value, scale = 1) => (value === undefined ? null : Math.round(value * scale));
  return new FitWriter()
    .define(1, 20, [{ number: 253, type: "uint32" }])
    .data(1, [startTime])
    .data(1, [end])
    .define(2, 18, session)
    .data(2, [
      end,
      startTime,
      FIT_SPORTS[sport],
      subSport === undefined ? null : FIT_SUB_SPORTS[subSport],
      elapsedSeconds * 1000,
      timerSeconds * 1000,
      optional(distanceMetres, 100),
      optional(heartRate),
      optional(cadence),
      optional(power),
    ])
    .file();
}

export function recordsAtOneMoment(count, startIso = "2026-09-03T06:00:00Z") {
  const start = fitTime(startIso);
  const writer = new FitWriter().define(0, 20, [
    { number: 253, type: "uint32" },
    { number: 7, type: "uint16" },
  ]);
  for (let i = 0; i < count; i++) writer.data(0, [start, 200]);
  return writer.file();
}
