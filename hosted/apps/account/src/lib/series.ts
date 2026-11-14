import type { ActivityLap, ActivityRecord, DecodedActivity } from "@trainstack/activity-file";

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
  readonly channels: readonly Channel[];
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
  return { seconds, duration: seconds.at(-1) ?? 0, channels };
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
  readonly second: number;
  readonly value: number | null;
}

export function bucketed(
  seconds: readonly number[],
  values: readonly (number | null)[],
  count: number,
): Bucket[] {
  if (values.length <= count) {
    return values.map((value, index) => ({ second: seconds[index]!, value }));
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
      second: (seconds[start]! + seconds[end - 1]!) / 2,
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
