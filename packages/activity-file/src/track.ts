import type { ActivitySummary, FitEvent, FitLap, FitRecord } from "@trainstack/fit";

import type { SportAndSubSport } from "./sports.ts";

export interface TrackPoint {
  time: number | undefined;
  latitude: number | undefined;
  longitude: number | undefined;
  altitudeMetres: number | undefined;
  heartRate: number | undefined;
  cadence: number | undefined;
  power: number | undefined;
  speedMetresPerSecond: number | undefined;
  distanceMetres: number | undefined;
  temperatureCelsius: number | undefined;
}

export interface TimedPoint extends TrackPoint {
  time: number;
}

export type Segment = readonly TimedPoint[];

export function emptyPoint(): TrackPoint {
  return {
    time: undefined,
    latitude: undefined,
    longitude: undefined,
    altitudeMetres: undefined,
    heartRate: undefined,
    cadence: undefined,
    power: undefined,
    speedMetresPerSecond: undefined,
    distanceMetres: undefined,
    temperatureCelsius: undefined,
  };
}

export function isTimed(point: TrackPoint): point is TimedPoint {
  return point.time !== undefined;
}

export const ascentThresholdMetres = 3;
const earthRadiusMetres = 6_371_008.8;

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function metresBetween(
  fromLatitude: number,
  fromLongitude: number,
  toLatitude: number,
  toLongitude: number,
): number {
  const latitudeChange = radians(toLatitude - fromLatitude);
  const longitudeChange = radians(toLongitude - fromLongitude);
  const haversine =
    Math.sin(latitudeChange / 2) ** 2 +
    Math.cos(radians(fromLatitude)) *
      Math.cos(radians(toLatitude)) *
      Math.sin(longitudeChange / 2) ** 2;
  return 2 * earthRadiusMetres * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

function travelledDistances(segments: readonly Segment[]): (number | undefined)[] {
  const distances: (number | undefined)[] = [];
  let total: number | undefined;
  for (const segment of segments) {
    let previous: TimedPoint | undefined;
    for (const point of segment) {
      if (point.latitude !== undefined && point.longitude !== undefined) {
        if (
          previous?.latitude !== undefined &&
          previous.longitude !== undefined &&
          total !== undefined
        ) {
          total += metresBetween(
            previous.latitude,
            previous.longitude,
            point.latitude,
            point.longitude,
          );
        }
        total ??= 0;
        previous = point;
      }
      distances.push(total);
    }
  }
  return distances;
}

function climbs(records: readonly FitRecord[]): {
  ascent: number | undefined;
  descent: number | undefined;
} {
  let reference: number | undefined;
  let ascent = 0;
  let descent = 0;
  for (const { altitudeMetres } of records) {
    if (altitudeMetres === undefined) continue;
    if (reference === undefined) {
      reference = altitudeMetres;
    } else if (altitudeMetres - reference >= ascentThresholdMetres) {
      ascent += altitudeMetres - reference;
      reference = altitudeMetres;
    } else if (reference - altitudeMetres >= ascentThresholdMetres) {
      descent += reference - altitudeMetres;
      reference = altitudeMetres;
    }
  }
  return reference === undefined ? { ascent: undefined, descent: undefined } : { ascent, descent };
}

export interface Pause {
  readonly stoppedAt: number;
  readonly startedAt: number;
}

export function pausesBetween(segments: readonly Segment[]): Pause[] {
  const nonEmpty = segments.filter((segment) => segment.length > 0);
  const pauses: Pause[] = [];
  for (let index = 1; index < nonEmpty.length; index++) {
    pauses.push({
      stoppedAt: nonEmpty[index - 1]!.at(-1)!.time,
      startedAt: nonEmpty[index]![0]!.time,
    });
  }
  return pauses;
}

export function pauseEvents(pauses: readonly Pause[]): FitEvent[] {
  return pauses.flatMap(({ stoppedAt, startedAt }) => [
    {
      time: new Date(stoppedAt),
      event: "timer",
      type: "stopAll",
      data: undefined,
      group: undefined,
    },
    { time: new Date(startedAt), event: "timer", type: "start", data: undefined, group: undefined },
  ]);
}

export function records(segments: readonly Segment[], start: number): FitRecord[] {
  const points = segments.flat();
  const fileDistances = points.some((point) => point.distanceMetres !== undefined);
  const distances = fileDistances
    ? points.map((point) => point.distanceMetres)
    : travelledDistances(segments);
  return points.map((point, index) => ({
    time: new Date(point.time),
    elapsedSeconds: (point.time - start) / 1000,
    power: point.power,
    heartRate: point.heartRate,
    cadence: point.cadence,
    speedMetresPerSecond: point.speedMetresPerSecond,
    distanceMetres: distances[index],
    latitude: point.latitude,
    longitude: point.longitude,
    altitudeMetres: point.altitudeMetres,
    temperatureCelsius: point.temperatureCelsius,
    developerFields: {},
  }));
}

function defined<Value>(values: readonly (Value | undefined)[]): Value[] {
  return values.filter((value): value is Value => value !== undefined);
}

function sum(values: readonly (number | undefined)[]): number | undefined {
  const present = defined(values);
  return present.length === 0 ? undefined : present.reduce((total, value) => total + value, 0);
}

function max(values: readonly (number | undefined)[]): number | undefined {
  const present = defined(values);
  return present.length === 0
    ? undefined
    : present.reduce((largest, value) => (value > largest ? value : largest));
}

function mean(values: readonly (number | undefined)[]): number | undefined {
  const present = defined(values);
  if (present.length === 0) return undefined;
  return present.reduce((total, value) => total + value, 0) / present.length;
}

function rounded(value: number | undefined): number | undefined {
  return value === undefined ? undefined : Math.round(value);
}

function weightedMean(
  laps: readonly FitLap[],
  value: (lap: FitLap) => number | undefined,
): number | undefined {
  let total = 0;
  let weight = 0;
  for (const lap of laps) {
    const lapValue = value(lap);
    const lapWeight = lap.timerSeconds ?? lap.elapsedSeconds ?? 0;
    if (lapValue === undefined || lapWeight <= 0) continue;
    total += lapValue * lapWeight;
    weight += lapWeight;
  }
  return weight > 0 ? total / weight : mean(laps.map(value));
}

export interface SummaryInput {
  readonly start: number;
  readonly end: number;
  readonly sport: SportAndSubSport;
  readonly laps: readonly FitLap[];
  readonly records: readonly FitRecord[];
  readonly pauses: readonly Pause[];
}

export function summarize({
  start,
  end,
  sport,
  laps,
  records,
  pauses,
}: SummaryInput): ActivitySummary {
  const fromLaps = (value: (lap: FitLap) => number | undefined) => laps.map(value);
  const fromRecords = (value: (record: FitRecord) => number | undefined) => records.map(value);
  const elapsedSeconds = Math.max(0, (end - start) / 1000);
  const pausedSeconds = pauses.reduce(
    (total, { stoppedAt, startedAt }) => total + Math.max(0, startedAt - stoppedAt) / 1000,
    0,
  );
  const timerSeconds =
    sum(fromLaps((lap) => lap.timerSeconds)) ?? Math.max(0, elapsedSeconds - pausedSeconds);
  const distanceMetres =
    sum(fromLaps((lap) => lap.distanceMetres)) ??
    max(fromRecords((record) => record.distanceMetres));
  const { ascent, descent } = climbs(records);
  return {
    startTime: new Date(start),
    sport: sport.sport,
    subSport: sport.subSport,
    elapsedSeconds,
    timerSeconds,
    distanceMetres,
    calories: sum(fromLaps((lap) => lap.calories)),
    averageSpeedMetresPerSecond:
      weightedMean(laps, (lap) => lap.averageSpeedMetresPerSecond) ??
      (distanceMetres !== undefined && timerSeconds > 0
        ? distanceMetres / timerSeconds
        : undefined) ??
      mean(fromRecords((record) => record.speedMetresPerSecond)),
    maxSpeedMetresPerSecond:
      max(fromLaps((lap) => lap.maxSpeedMetresPerSecond)) ??
      max(fromRecords((record) => record.speedMetresPerSecond)),
    averageHeartRate: rounded(
      weightedMean(laps, (lap) => lap.averageHeartRate) ??
        mean(fromRecords((record) => record.heartRate)),
    ),
    maxHeartRate:
      max(fromLaps((lap) => lap.maxHeartRate)) ?? max(fromRecords((record) => record.heartRate)),
    averageCadence: rounded(
      weightedMean(laps, (lap) => lap.averageCadence) ??
        mean(fromRecords((record) => record.cadence)),
    ),
    maxCadence:
      max(fromLaps((lap) => lap.maxCadence)) ?? max(fromRecords((record) => record.cadence)),
    averagePower: rounded(
      weightedMean(laps, (lap) => lap.averagePower) ?? mean(fromRecords((record) => record.power)),
    ),
    maxPower: max(fromLaps((lap) => lap.maxPower)) ?? max(fromRecords((record) => record.power)),
    totalAscentMetres: ascent,
    totalDescentMetres: descent,
  };
}
