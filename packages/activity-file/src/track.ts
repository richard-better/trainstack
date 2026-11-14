import {
  maxTimerEvents,
  type ActivitySummary,
  type FitEvent,
  type FitLap,
  type FitRecord,
  type RecordColumns,
  type StreamLimits,
} from "@trainstack/fit";

import { ActivityFileError, type ActivityFileFormat } from "./error.ts";
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

export interface Pause {
  readonly stoppedAt: number;
  readonly startedAt: number;
}

class Series {
  private total = 0;
  private count = 0;
  private largest: number | undefined;

  add(value: number | undefined): void {
    if (value === undefined) return;
    this.total += value;
    this.count += 1;
    if (this.largest === undefined || value > this.largest) this.largest = value;
  }

  get isEmpty(): boolean {
    return this.count === 0;
  }

  get mean(): number | undefined {
    return this.count === 0 ? undefined : this.total / this.count;
  }

  get max(): number | undefined {
    return this.largest;
  }
}

class Climbs {
  private reference: number | undefined;
  private climbed = 0;
  private descended = 0;

  add(altitude: number | undefined): void {
    if (altitude === undefined) return;
    if (this.reference === undefined) {
      this.reference = altitude;
    } else if (altitude - this.reference >= ascentThresholdMetres) {
      this.climbed += altitude - this.reference;
      this.reference = altitude;
    } else if (this.reference - altitude >= ascentThresholdMetres) {
      this.descended += this.reference - altitude;
      this.reference = altitude;
    }
  }

  get ascent(): number | undefined {
    return this.reference === undefined ? undefined : this.climbed;
  }

  get descent(): number | undefined {
    return this.reference === undefined ? undefined : this.descended;
  }
}

export interface ColumnsFrom {
  readonly start: number;
  readonly points: number;
  readonly limits: StreamLimits;
}

const columnNames = [
  "elapsed",
  "power",
  "heartRate",
  "speed",
  "fileDistance",
  "travelled",
  "altitude",
] as const;

type ColumnName = (typeof columnNames)[number];

class PointColumns {
  private count = 0;
  private readonly values: Record<ColumnName, Float64Array>;
  private readonly from: ColumnsFrom;
  private readonly format: ActivityFileFormat;

  constructor(from: ColumnsFrom, format: ActivityFileFormat) {
    this.from = from;
    this.format = format;
    const capacity = Math.min(from.points, from.limits.maxRecords);
    this.values = Object.fromEntries(
      columnNames.map((name) => [name, new Float64Array(capacity)]),
    ) as Record<ColumnName, Float64Array>;
  }

  add(point: TimedPoint, travelled: number | undefined): void {
    const elapsed = (point.time - this.from.start) / 1000;
    if (!(elapsed <= this.from.limits.untilSeconds)) return;
    if (this.count >= this.values.elapsed.length) {
      throw new ActivityFileError("tooLarge", this.format);
    }
    const at = this.count++;
    const { values } = this;
    values.elapsed[at] = elapsed;
    values.power[at] = point.power ?? NaN;
    values.heartRate[at] = point.heartRate ?? NaN;
    values.speed[at] = point.speedMetresPerSecond ?? NaN;
    values.fileDistance[at] = point.distanceMetres ?? NaN;
    values.travelled[at] = travelled ?? NaN;
    values.altitude[at] = point.altitudeMetres ?? NaN;
  }

  columns(distanceFromFile: boolean): RecordColumns {
    const used = (values: Float64Array) => values.subarray(0, this.count);
    const { values } = this;
    return {
      count: this.count,
      elapsedSeconds: used(values.elapsed),
      power: used(values.power),
      heartRate: used(values.heartRate),
      speedMetresPerSecond: used(values.speed),
      distanceMetres: used(distanceFromFile ? values.fileDistance : values.travelled),
      altitudeMetres: used(values.altitude),
    };
  }
}

export type TrackKeeps = "summary" | "records" | ColumnsFrom;

export class Track {
  start: number | undefined;
  end: number | undefined;
  pausedSeconds = 0;
  readonly speed = new Series();
  readonly heartRate = new Series();
  readonly cadence = new Series();
  readonly power = new Series();
  readonly climbs = new Climbs();
  private readonly keptPoints: TimedPoint[] | undefined;
  private readonly keptColumns: PointColumns | undefined;
  private readonly keepsPauses: boolean;
  private readonly format: ActivityFileFormat;
  private readonly pauses: Pause[] = [];
  private readonly travelledAtPoints: (number | undefined)[] = [];
  private readonly fileDistance = new Series();
  private travelled: number | undefined;
  private previousPosition: TimedPoint | undefined;
  private lastTime: number | undefined;
  private segmentStarting = false;
  points = 0;

  constructor(keeps: TrackKeeps, format: ActivityFileFormat) {
    this.keptPoints = keeps === "records" ? [] : undefined;
    this.keptColumns = typeof keeps === "object" ? new PointColumns(keeps, format) : undefined;
    this.keepsPauses = keeps !== "summary";
    this.format = format;
  }

  segment(): void {
    this.segmentStarting = true;
    this.previousPosition = undefined;
  }

  add(point: TimedPoint): void {
    if (this.segmentStarting && this.lastTime !== undefined) {
      this.pausedSeconds += Math.max(0, point.time - this.lastTime) / 1000;
      if (this.keepsPauses) this.pause({ stoppedAt: this.lastTime, startedAt: point.time });
    }
    this.segmentStarting = false;
    this.points++;
    this.lastTime = point.time;
    if (this.start === undefined || point.time < this.start) this.start = point.time;
    if (this.end === undefined || point.time > this.end) this.end = point.time;
    if (point.latitude !== undefined && point.longitude !== undefined) {
      const previous = this.previousPosition;
      if (previous && this.travelled !== undefined) {
        this.travelled += metresBetween(
          previous.latitude!,
          previous.longitude!,
          point.latitude,
          point.longitude,
        );
      }
      this.travelled ??= 0;
      this.previousPosition = point;
    }
    this.fileDistance.add(point.distanceMetres);
    this.speed.add(point.speedMetresPerSecond);
    this.heartRate.add(point.heartRate);
    this.cadence.add(point.cadence);
    this.power.add(point.power);
    this.climbs.add(point.altitudeMetres);
    if (this.keptPoints) {
      this.keptPoints.push(point);
      this.travelledAtPoints.push(this.travelled);
    }
    this.keptColumns?.add(point, this.travelled);
  }

  private pause(pause: Pause): void {
    if (this.keptColumns && 2 * (this.pauses.length + 1) > maxTimerEvents) {
      throw new ActivityFileError("tooLarge", this.format);
    }
    this.pauses.push(pause);
  }

  get distanceMetres(): number | undefined {
    return this.fileDistance.isEmpty ? this.travelled : this.fileDistance.max;
  }

  records(start: number): FitRecord[] {
    const fileDistances = !this.fileDistance.isEmpty;
    return (this.keptPoints ?? []).map((point, index) => ({
      time: new Date(point.time),
      elapsedSeconds: (point.time - start) / 1000,
      power: point.power,
      heartRate: point.heartRate,
      cadence: point.cadence,
      speedMetresPerSecond: point.speedMetresPerSecond,
      distanceMetres: fileDistances ? point.distanceMetres : this.travelledAtPoints[index],
      latitude: point.latitude,
      longitude: point.longitude,
      altitudeMetres: point.altitudeMetres,
      temperatureCelsius: point.temperatureCelsius,
      developerFields: {},
    }));
  }

  get columns(): RecordColumns | undefined {
    return this.keptColumns?.columns(!this.fileDistance.isEmpty);
  }

  get events(): FitEvent[] {
    return this.pauses.flatMap(({ stoppedAt, startedAt }) => [
      {
        time: new Date(stoppedAt),
        event: "timer",
        type: "stopAll",
        data: undefined,
        group: undefined,
      },
      {
        time: new Date(startedAt),
        event: "timer",
        type: "start",
        data: undefined,
        group: undefined,
      },
    ]);
  }
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
  readonly track: Track;
}

export function summarize({ start, end, sport, laps, track }: SummaryInput): ActivitySummary {
  const fromLaps = (value: (lap: FitLap) => number | undefined) => laps.map(value);
  const elapsedSeconds = Math.max(0, (end - start) / 1000);
  const timerSeconds =
    sum(fromLaps((lap) => lap.timerSeconds)) ?? Math.max(0, elapsedSeconds - track.pausedSeconds);
  const distanceMetres = sum(fromLaps((lap) => lap.distanceMetres)) ?? track.distanceMetres;
  return {
    startTime: new Date(start),
    utcOffsetSeconds: undefined,
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
      track.speed.mean,
    maxSpeedMetresPerSecond: max(fromLaps((lap) => lap.maxSpeedMetresPerSecond)) ?? track.speed.max,
    averageHeartRate: rounded(
      weightedMean(laps, (lap) => lap.averageHeartRate) ?? track.heartRate.mean,
    ),
    maxHeartRate: max(fromLaps((lap) => lap.maxHeartRate)) ?? track.heartRate.max,
    averageCadence: rounded(weightedMean(laps, (lap) => lap.averageCadence) ?? track.cadence.mean),
    maxCadence: max(fromLaps((lap) => lap.maxCadence)) ?? track.cadence.max,
    averagePower: rounded(weightedMean(laps, (lap) => lap.averagePower) ?? track.power.mean),
    maxPower: max(fromLaps((lap) => lap.maxPower)) ?? track.power.max,
    totalAscentMetres: track.climbs.ascent,
    totalDescentMetres: track.climbs.descent,
  };
}
