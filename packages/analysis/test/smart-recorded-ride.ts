import { type FieldSpec, FitWriter, fitTime } from "../../fit/test/fit-writer.ts";

const start = new Date("2026-05-01T07:00:00Z");

const fileIdFields: FieldSpec[] = [
  { number: 0, type: "enum" },
  { number: 4, type: "uint32" },
];
const eventFields: FieldSpec[] = [
  { number: 253, type: "uint32" },
  { number: 0, type: "enum" },
  { number: 1, type: "enum" },
];
const recordFields: FieldSpec[] = [
  { number: 253, type: "uint32" },
  { number: 7, type: "uint16" },
  { number: 3, type: "uint8" },
];
const sessionFields: FieldSpec[] = [
  { number: 253, type: "uint32" },
  { number: 2, type: "uint32" },
  { number: 5, type: "enum" },
  { number: 7, type: "uint32" },
  { number: 8, type: "uint32" },
];

export function smartRecordedRide(): Uint8Array {
  const zero = fitTime(start.toISOString());
  const writer = new FitWriter()
    .define(0, 0, fileIdFields)
    .data(0, [4, zero])
    .define(1, 21, eventFields)
    .define(2, 20, recordFields);
  const event = (seconds: number, type: number) => writer.data(1, [zero + seconds, 0, type]);
  const records = (from: number, to: number, every: number, power: number, heartRate: number) => {
    for (let seconds = from; seconds <= to; seconds += every) {
      writer.data(2, [zero + seconds, power, heartRate]);
    }
  };
  event(0, 0);
  records(0, 300, 6, 200, 140);
  records(345, 545, 8, 300, 160);
  event(545, 4);
  event(605, 0);
  records(605, 665, 5, 250, 150);
  event(665, 4);
  return writer
    .define(3, 18, sessionFields)
    .data(3, [zero + 665, zero, 2, 665_000, 545_000])
    .file();
}
