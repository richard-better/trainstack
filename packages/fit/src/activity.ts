import { FitDecodeError } from "./error.ts";
import { eventTypes, events, fileTypes, lapTriggers, sports, subSports } from "./names.ts";
import {
  CommonField,
  EventField,
  FileIdField,
  LapField,
  MessageNumber,
  RecordField,
  Scale,
  SessionField,
  WorkoutField,
  altitudeOffsetMetres,
  degreesPerSemicircle,
  fitEpochInUnixSeconds,
} from "./profile.ts";
import { forEachFitMessage, type FitMessage, type FitValue } from "./reader.ts";

export type FitEnum<Names extends Record<number, string>> = Names[keyof Names] | number;

export type Sport = FitEnum<typeof sports>;
export type SubSport = FitEnum<typeof subSports>;
export type EventName = FitEnum<typeof events>;
export type EventType = FitEnum<typeof eventTypes>;
export type LapTrigger = FitEnum<typeof lapTriggers>;
export type FileType = FitEnum<typeof fileTypes>;

export interface FitFileId {
  readonly type: FileType | undefined;
  readonly manufacturer: number | undefined;
  readonly product: number | undefined;
  readonly serialNumber: number | undefined;
  readonly timeCreated: Date | undefined;
}

export interface FitTotals {
  readonly elapsedSeconds: number | undefined;
  readonly timerSeconds: number | undefined;
  readonly distanceMetres: number | undefined;
  readonly calories: number | undefined;
  readonly averageSpeedMetresPerSecond: number | undefined;
  readonly maxSpeedMetresPerSecond: number | undefined;
  readonly averageHeartRate: number | undefined;
  readonly maxHeartRate: number | undefined;
  readonly averageCadence: number | undefined;
  readonly maxCadence: number | undefined;
  readonly averagePower: number | undefined;
  readonly maxPower: number | undefined;
  readonly normalizedPower: number | undefined;
  readonly totalWorkJoules: number | undefined;
  readonly totalAscentMetres: number | undefined;
  readonly totalDescentMetres: number | undefined;
}

export interface FitSession extends FitTotals {
  readonly startTime: Date | undefined;
  readonly endTime: Date | undefined;
  readonly sport: Sport | undefined;
  readonly subSport: SubSport | undefined;
  readonly startLatitude: number | undefined;
  readonly startLongitude: number | undefined;
  readonly trainingStressScore: number | undefined;
  readonly intensityFactor: number | undefined;
  readonly firstLapIndex: number | undefined;
  readonly lapCount: number | undefined;
}

export interface FitLap extends FitTotals {
  readonly startTime: Date | undefined;
  readonly endTime: Date | undefined;
  readonly sport: Sport | undefined;
  readonly subSport: SubSport | undefined;
  readonly startLatitude: number | undefined;
  readonly startLongitude: number | undefined;
  readonly trigger: LapTrigger | undefined;
}

export interface FitRecord {
  readonly time: Date;
  readonly elapsedSeconds: number;
  readonly power: number | undefined;
  readonly heartRate: number | undefined;
  readonly cadence: number | undefined;
  readonly speedMetresPerSecond: number | undefined;
  readonly distanceMetres: number | undefined;
  readonly latitude: number | undefined;
  readonly longitude: number | undefined;
  readonly altitudeMetres: number | undefined;
  readonly temperatureCelsius: number | undefined;
  readonly developerFields: Readonly<Record<string, FitValue>>;
}

export interface FitEvent {
  readonly time: Date | undefined;
  readonly event: EventName | undefined;
  readonly type: EventType | undefined;
  readonly data: number | undefined;
  readonly group: number | undefined;
}

export interface ActivitySummary {
  readonly startTime: Date;
  readonly sport: Sport | undefined;
  readonly subSport: SubSport | undefined;
  readonly elapsedSeconds: number;
  readonly timerSeconds: number;
  readonly distanceMetres: number | undefined;
  readonly calories: number | undefined;
  readonly averageSpeedMetresPerSecond: number | undefined;
  readonly maxSpeedMetresPerSecond: number | undefined;
  readonly averageHeartRate: number | undefined;
  readonly maxHeartRate: number | undefined;
  readonly averageCadence: number | undefined;
  readonly maxCadence: number | undefined;
  readonly averagePower: number | undefined;
  readonly maxPower: number | undefined;
  readonly totalAscentMetres: number | undefined;
  readonly totalDescentMetres: number | undefined;
}

export interface FitActivitySummary {
  readonly fileId: FitFileId | undefined;
  readonly workoutName: string | undefined;
  readonly summary: ActivitySummary;
  readonly sessions: readonly FitSession[];
  readonly laps: readonly FitLap[];
}

export interface FitActivity extends FitActivitySummary {
  readonly records: readonly FitRecord[];
  readonly events: readonly FitEvent[];
}

function integer(message: FitMessage, field: number): number | undefined {
  const value = message.fields.get(field);
  return typeof value === "number" ? value : undefined;
}

function text(message: FitMessage, field: number): string | undefined {
  const value = message.fields.get(field);
  return typeof value === "string" ? value : undefined;
}

function divided(message: FitMessage, field: number, scale: number): number | undefined {
  const value = integer(message, field);
  return value === undefined ? undefined : value / scale;
}

function degrees(message: FitMessage, field: number): number | undefined {
  const value = integer(message, field);
  return value === undefined ? undefined : value * degreesPerSemicircle;
}

function named<Names extends Record<number, string>>(
  names: Names,
  value: number | undefined,
): FitEnum<Names> | undefined {
  if (value === undefined) return undefined;
  return (names as Record<number, Names[keyof Names]>)[value] ?? value;
}

function dateFromFit(seconds: number): Date {
  return new Date((seconds + fitEpochInUnixSeconds) * 1000);
}

function date(message: FitMessage, field: number): Date | undefined {
  const value = integer(message, field);
  return value === undefined ? undefined : dateFromFit(value);
}

function fileId(message: FitMessage): FitFileId {
  return {
    type: named(fileTypes, integer(message, FileIdField.type)),
    manufacturer: integer(message, FileIdField.manufacturer),
    product: integer(message, FileIdField.product),
    serialNumber: integer(message, FileIdField.serialNumber),
    timeCreated: date(message, FileIdField.timeCreated),
  };
}

type TotalsFields = {
  readonly [
    Key in Exclude<keyof typeof LapField & keyof typeof SessionField, "sport" | "subSport">
  ]: number;
};

function totals(message: FitMessage, field: TotalsFields): FitTotals {
  return {
    elapsedSeconds: divided(message, field.totalElapsedTime, Scale.time),
    timerSeconds: divided(message, field.totalTimerTime, Scale.time),
    distanceMetres: divided(message, field.totalDistance, Scale.distance),
    calories: integer(message, field.totalCalories),
    averageSpeedMetresPerSecond:
      divided(message, field.enhancedAvgSpeed, Scale.speed) ??
      divided(message, field.avgSpeed, Scale.speed),
    maxSpeedMetresPerSecond:
      divided(message, field.enhancedMaxSpeed, Scale.speed) ??
      divided(message, field.maxSpeed, Scale.speed),
    averageHeartRate: integer(message, field.avgHeartRate),
    maxHeartRate: integer(message, field.maxHeartRate),
    averageCadence: integer(message, field.avgCadence),
    maxCadence: integer(message, field.maxCadence),
    averagePower: integer(message, field.avgPower),
    maxPower: integer(message, field.maxPower),
    normalizedPower: integer(message, field.normalizedPower),
    totalWorkJoules: integer(message, field.totalWork),
    totalAscentMetres: integer(message, field.totalAscent),
    totalDescentMetres: integer(message, field.totalDescent),
  };
}

function session(message: FitMessage): FitSession {
  return {
    ...totals(message, SessionField),
    startTime: date(message, SessionField.startTime),
    endTime: date(message, CommonField.timestamp),
    sport: named(sports, integer(message, SessionField.sport)),
    subSport: named(subSports, integer(message, SessionField.subSport)),
    startLatitude: degrees(message, SessionField.startPositionLat),
    startLongitude: degrees(message, SessionField.startPositionLong),
    trainingStressScore: divided(
      message,
      SessionField.trainingStressScore,
      Scale.trainingStressScore,
    ),
    intensityFactor: divided(message, SessionField.intensityFactor, Scale.intensityFactor),
    firstLapIndex: integer(message, SessionField.firstLapIndex),
    lapCount: integer(message, SessionField.numLaps),
  };
}

function lap(message: FitMessage): FitLap {
  return {
    ...totals(message, LapField),
    startTime: date(message, LapField.startTime),
    endTime: date(message, CommonField.timestamp),
    sport: named(sports, integer(message, LapField.sport)),
    subSport: named(subSports, integer(message, LapField.subSport)),
    startLatitude: degrees(message, LapField.startPositionLat),
    startLongitude: degrees(message, LapField.startPositionLong),
    trigger: named(lapTriggers, integer(message, LapField.lapTrigger)),
  };
}

function event(message: FitMessage): FitEvent {
  return {
    time: date(message, CommonField.timestamp),
    event: named(events, integer(message, EventField.event)),
    type: named(eventTypes, integer(message, EventField.eventType)),
    data: integer(message, EventField.data),
    group: integer(message, EventField.eventGroup),
  };
}

function altitude(message: FitMessage): number | undefined {
  const raw =
    integer(message, RecordField.enhancedAltitude) ?? integer(message, RecordField.altitude);
  return raw === undefined
    ? undefined
    : (raw - altitudeOffsetMetres * Scale.altitude) / Scale.altitude;
}

function record(message: FitMessage, timestamp: number, start: number): FitRecord {
  return {
    time: dateFromFit(timestamp),
    elapsedSeconds: timestamp - start,
    power: integer(message, RecordField.power),
    heartRate: integer(message, RecordField.heartRate),
    cadence: integer(message, RecordField.cadence),
    speedMetresPerSecond:
      divided(message, RecordField.enhancedSpeed, Scale.speed) ??
      divided(message, RecordField.speed, Scale.speed),
    distanceMetres: divided(message, RecordField.distance, Scale.distance),
    latitude: degrees(message, RecordField.positionLat),
    longitude: degrees(message, RecordField.positionLong),
    altitudeMetres: altitude(message),
    temperatureCelsius: integer(message, RecordField.temperature),
    developerFields: Object.fromEntries(message.developerFields),
  };
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
  sessions: readonly FitSession[],
  value: (session: FitSession) => number | undefined,
): number | undefined {
  const present = defined(sessions.map(value));
  if (present.length <= 1) return present[0];
  let total = 0;
  let weight = 0;
  for (const session of sessions) {
    const sessionValue = value(session);
    const sessionWeight = session.timerSeconds ?? session.elapsedSeconds ?? 0;
    if (sessionValue === undefined) continue;
    total += sessionValue * sessionWeight;
    weight += sessionWeight;
  }
  if (weight > 0) return total / weight;
  return mean(sessions.map(value));
}

function onlyValue<Value>(values: readonly (Value | undefined)[]): Value | undefined {
  const present = new Set(defined(values));
  return present.size === 1 ? [...present][0] : undefined;
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

  get mean(): number | undefined {
    return this.count === 0 ? undefined : this.total / this.count;
  }

  get max(): number | undefined {
    return this.largest;
  }
}

class RecordStats {
  firstTimestamp: number | undefined;
  lastTimestamp: number | undefined;
  readonly distance = new Series();
  readonly speed = new Series();
  readonly heartRate = new Series();
  readonly cadence = new Series();
  readonly power = new Series();

  add(record: FitRecord, timestamp: number): void {
    this.firstTimestamp ??= timestamp;
    this.lastTimestamp = timestamp;
    this.distance.add(record.distanceMetres);
    this.speed.add(record.speedMetresPerSecond);
    this.heartRate.add(record.heartRate);
    this.cadence.add(record.cadence);
    this.power.add(record.power);
  }
}

function summarize(
  start: number,
  sessions: readonly FitSession[],
  records: RecordStats,
): ActivitySummary {
  const fromSessions = (value: (session: FitSession) => number | undefined) => sessions.map(value);
  const recordedSeconds = records.lastTimestamp === undefined ? 0 : records.lastTimestamp - start;
  const elapsedSeconds = sum(fromSessions((session) => session.elapsedSeconds)) ?? recordedSeconds;
  const sport =
    sessions.length > 1 && !onlyValue(sessions.map((session) => session.sport))
      ? sports[18]
      : sessions[0]?.sport;
  return {
    startTime: dateFromFit(start),
    sport,
    subSport: onlyValue(sessions.map((session) => session.subSport)),
    elapsedSeconds,
    timerSeconds: sum(fromSessions((session) => session.timerSeconds)) ?? elapsedSeconds,
    distanceMetres: sum(fromSessions((session) => session.distanceMetres)) ?? records.distance.max,
    calories: sum(fromSessions((session) => session.calories)),
    averageSpeedMetresPerSecond:
      weightedMean(sessions, (session) => session.averageSpeedMetresPerSecond) ??
      records.speed.mean,
    maxSpeedMetresPerSecond:
      max(fromSessions((session) => session.maxSpeedMetresPerSecond)) ?? records.speed.max,
    averageHeartRate: rounded(
      weightedMean(sessions, (session) => session.averageHeartRate) ?? records.heartRate.mean,
    ),
    maxHeartRate: max(fromSessions((session) => session.maxHeartRate)) ?? records.heartRate.max,
    averageCadence: rounded(
      weightedMean(sessions, (session) => session.averageCadence) ?? records.cadence.mean,
    ),
    maxCadence: max(fromSessions((session) => session.maxCadence)) ?? records.cadence.max,
    averagePower: rounded(
      weightedMean(sessions, (session) => session.averagePower) ?? records.power.mean,
    ),
    maxPower: max(fromSessions((session) => session.maxPower)) ?? records.power.max,
    totalAscentMetres: sum(fromSessions((session) => session.totalAscentMetres)),
    totalDescentMetres: sum(fromSessions((session) => session.totalDescentMetres)),
  };
}

export const maxLapsAndSessions = 10_000;

interface RecordMessage {
  readonly message: FitMessage;
  readonly timestamp: number;
}

function readActivity(
  data: Uint8Array | ArrayBuffer,
  keepRecords: boolean,
): FitActivitySummary & {
  readonly start: number;
  readonly recordMessages: readonly RecordMessage[];
  readonly events: readonly FitEvent[];
} {
  let fileIdMessage: FitMessage | undefined;
  let workoutName: string | undefined;
  let firstSessionStart: number | undefined;
  let firstSessionEnd: number | undefined;
  const sessions: FitSession[] = [];
  const laps: FitLap[] = [];
  const events: FitEvent[] = [];
  const recordMessages: RecordMessage[] = [];
  const stats = new RecordStats();
  forEachFitMessage(data, (message) => {
    switch (message.globalNumber) {
      case MessageNumber.record: {
        const timestamp = integer(message, CommonField.timestamp);
        if (timestamp === undefined) break;
        stats.add(record(message, timestamp, timestamp), timestamp);
        if (keepRecords) recordMessages.push({ message, timestamp });
        break;
      }
      case MessageNumber.session:
        if (sessions.length >= maxLapsAndSessions) throw new FitDecodeError("tooLarge");
        sessions.push(session(message));
        firstSessionStart ??= integer(message, SessionField.startTime);
        firstSessionEnd ??= integer(message, CommonField.timestamp);
        break;
      case MessageNumber.lap:
        if (laps.length >= maxLapsAndSessions) throw new FitDecodeError("tooLarge");
        laps.push(lap(message));
        break;
      case MessageNumber.event:
        if (keepRecords) events.push(event(message));
        break;
      case MessageNumber.fileId:
        fileIdMessage ??= message;
        break;
      case MessageNumber.workout:
        workoutName ??= text(message, WorkoutField.name);
        break;
    }
  });
  if (sessions.length === 0 && stats.firstTimestamp === undefined) {
    throw new FitDecodeError("noActivity");
  }
  const start = firstSessionStart ?? stats.firstTimestamp ?? firstSessionEnd ?? 0;
  return {
    fileId: fileIdMessage && fileId(fileIdMessage),
    workoutName,
    summary: summarize(start, sessions, stats),
    sessions,
    laps,
    start,
    recordMessages,
    events,
  };
}

export function summarizeFit(data: Uint8Array | ArrayBuffer): FitActivitySummary {
  const { fileId, workoutName, summary, sessions, laps } = readActivity(data, false);
  return { fileId, workoutName, summary, sessions, laps };
}

export function decodeFit(data: Uint8Array | ArrayBuffer): FitActivity {
  const { start, recordMessages, ...activity } = readActivity(data, true);
  return {
    ...activity,
    records: recordMessages.map(({ message, timestamp }) => record(message, timestamp, start)),
  };
}
