import type { ActivityLap, ActivityRecord, DecodedActivity } from "@trainstack/activity-file";

import { type Elevation, distancesOf, elevationOf } from "./terrain.ts";

type Decoded = Pick<DecodedActivity, "summary" | "laps" | "records">;

export type ChannelKey = "power" | "heartRate" | "cadence" | "speed";

export interface Channel {
  readonly key: ChannelKey;
  readonly label: string;
  readonly unit: string;
  readonly digits: number;
  readonly values: readonly (number | null)[];
  readonly target: readonly (number | null)[] | null;
  readonly average: number;
  readonly max: number;
}

export interface Trace {
  readonly seconds: readonly number[];
  readonly duration: number;
  readonly distances: readonly number[] | null;
  readonly channels: readonly Channel[];
  readonly elevation: Elevation | null;
}

const channelSpecs: readonly {
  key: ChannelKey;
  label: string;
  unit: string;
  digits: number;
  read: (record: ActivityRecord) => number | undefined;
}[] = [
  { key: "power", label: "Power", unit: "W", digits: 0, read: (record) => record.power },
  {
    key: "heartRate",
    label: "Heart rate",
    unit: "bpm",
    digits: 0,
    read: (record) => record.heartRate,
  },
  { key: "cadence", label: "Cadence", unit: "rpm", digits: 0, read: (record) => record.cadence },
  {
    key: "speed",
    label: "Speed",
    unit: "km/h",
    digits: 1,
    read: (record) =>
      record.speedMetresPerSecond === undefined ? undefined : record.speedMetresPerSecond * 3.6,
  },
];

const SPEED_WINDOW_SECONDS = 5;

function speedFromDistance(records: readonly ActivityRecord[]) {
  let back = 0;
  let ahead = 0;
  return records.map((record) => {
    while (records[back]!.elapsedSeconds < record.elapsedSeconds - SPEED_WINDOW_SECONDS) back++;
    while (
      ahead + 1 < records.length &&
      records[ahead + 1]!.elapsedSeconds <= record.elapsedSeconds + SPEED_WINDOW_SECONDS
    ) {
      ahead++;
    }
    const from = records[back]!;
    const to = records[ahead]!;
    const seconds = to.elapsedSeconds - from.elapsedSeconds;
    if (seconds <= 0 || from.distanceMetres === undefined || to.distanceMetres === undefined) {
      return null;
    }
    return ((to.distanceMetres - from.distanceMetres) / seconds) * 3.6;
  });
}

function valuesOf(
  key: ChannelKey,
  read: (record: ActivityRecord) => number | undefined,
  records: readonly ActivityRecord[],
) {
  const values = records.map((record) => read(record) ?? null);
  if (key !== "speed" || values.some((value) => value !== null)) return values;
  return speedFromDistance(records);
}

function targetPower(records: readonly ActivityRecord[]) {
  const values = records.map((record) => {
    const value = record.developerFields.target_power;
    return typeof value === "number" ? value : null;
  });
  return values.some((value) => value !== null) ? values : null;
}

export function traceOf(activity: Decoded): Trace {
  const records = activity.records;
  const seconds = records.map((record) => record.elapsedSeconds);
  const channels = channelSpecs.flatMap(({ read, ...spec }): Channel[] => {
    const values = valuesOf(spec.key, read, records);
    const present = values.filter((value): value is number => value !== null);
    if (present.length === 0) return [];
    return [
      {
        ...spec,
        values,
        target: spec.key === "power" ? targetPower(records) : null,
        average: present.reduce((sum, value) => sum + value, 0) / present.length,
        max: Math.max(...present),
      },
    ];
  });
  return {
    seconds,
    duration: seconds.at(-1) ?? 0,
    distances: distancesOf(records),
    channels,
    elevation: elevationOf(records),
  };
}

export function indexAt(seconds: readonly number[], at: number) {
  let low = 0;
  let high = seconds.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (seconds[middle]! < at) low = middle + 1;
    else high = middle;
  }
  if (low > 0 && Math.abs(seconds[low - 1]! - at) <= Math.abs(seconds[low]! - at)) return low - 1;
  return low;
}

export interface Bucket {
  readonly at: number;
  readonly value: number | null;
}

export function bucketed(
  positions: readonly number[],
  values: readonly (number | null)[],
  count: number,
): Bucket[] {
  if (values.length <= count) {
    return values.map((value, index) => ({ at: positions[index]!, value }));
  }
  const buckets: Bucket[] = [];
  for (let bucket = 0; bucket < count; bucket++) {
    const start = Math.floor((bucket * values.length) / count);
    const end = Math.floor(((bucket + 1) * values.length) / count);
    let sum = 0;
    let present = 0;
    for (let index = start; index < end; index++) {
      const value = values[index];
      if (value === null || value === undefined) continue;
      sum += value;
      present += 1;
    }
    buckets.push({
      at: (positions[start]! + positions[end - 1]!) / 2,
      value: present === 0 ? null : sum / present,
    });
  }
  return buckets;
}

export function niceCeiling(value: number) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(
    (candidate) => candidate * magnitude >= value,
  )!;
  return step * magnitude;
}

export interface LapRow {
  readonly number: number;
  readonly startSecond: number;
  readonly seconds: number | undefined;
  readonly distanceMetres: number | undefined;
  readonly averagePower: number | undefined;
  readonly maxPower: number | undefined;
  readonly averageHeartRate: number | undefined;
  readonly averageCadence: number | undefined;
  readonly averageSpeed: number | undefined;
  readonly normalizedPower?: number | undefined;
  readonly workKilojoules?: number | undefined;
  readonly gradeAdjustedSpeed?: number | undefined;
}

export function lapsOf(activity: Decoded): LapRow[] {
  const start = activity.summary.startTime.getTime();
  const rows = activity.laps.map((lap: ActivityLap, index): LapRow => ({
    number: index + 1,
    startSecond: lap.startTime ? (lap.startTime.getTime() - start) / 1000 : 0,
    seconds: lap.timerSeconds ?? lap.elapsedSeconds,
    distanceMetres: lap.distanceMetres,
    averagePower: lap.averagePower,
    maxPower: lap.maxPower,
    averageHeartRate: lap.averageHeartRate,
    averageCadence: lap.averageCadence,
    averageSpeed: lap.averageSpeedMetresPerSecond,
  }));
  return rows.length > 1 ? rows : [];
}

export type Axis = "time" | "distance";

export function axisPositions(trace: Pick<Trace, "seconds" | "distances">, axis: Axis) {
  return axis === "distance" && trace.distances ? trace.distances : trace.seconds;
}

export function secondAt(
  trace: Pick<Trace, "seconds" | "distances">,
  axis: Axis,
  position: number,
) {
  return trace.seconds[indexAt(axisPositions(trace, axis), position)] ?? 0;
}

export function positionAt(
  trace: Pick<Trace, "seconds" | "distances">,
  axis: Axis,
  second: number,
) {
  return axisPositions(trace, axis)[indexAt(trace.seconds, second)] ?? 0;
}

export const PAUSE_SECONDS = 60;

export function bucketedAcrossPauses(
  seconds: readonly number[],
  positions: readonly number[],
  values: readonly (number | null)[],
  count: number,
): Bucket[] {
  const starts = [0];
  for (let index = 1; index < seconds.length; index++) {
    if (seconds[index]! - seconds[index - 1]! > PAUSE_SECONDS) starts.push(index);
  }
  if (starts.length === 1) return bucketed(positions, values, count);
  return starts.flatMap((start, part) => {
    const end = starts[part + 1] ?? seconds.length;
    const share = Math.max(2, Math.round((count * (end - start)) / seconds.length));
    const buckets = bucketed(positions.slice(start, end), values.slice(start, end), share);
    return part === starts.length - 1
      ? buckets
      : [...buckets, { at: positions[end - 1]!, value: null }];
  });
}
