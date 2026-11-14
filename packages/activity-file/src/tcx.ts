import type { FitLap, LapTrigger } from "@trainstack/fit";

import { ActivityFileError } from "./error.ts";
import type { TrackActivity } from "./gpx.ts";
import { sportFromName, type SportAndSubSport } from "./sports.ts";
import {
  emptyPoint,
  isTimed,
  summarize,
  Track,
  type TrackKeeps,
  type TimedPoint,
  type TrackPoint,
} from "./track.ts";
import { parseLatitude, parseLongitude, parseMeasure, parseNumber, parseTime } from "./values.ts";
import { scanXml, type XmlAttributes, type XmlHandler } from "./xml.ts";

const lapFieldNames = [
  "TotalTimeSeconds",
  "DistanceMeters",
  "MaximumSpeed",
  "Calories",
  "Cadence",
  "AvgSpeed",
  "MaxBikeCadence",
  "AvgRunCadence",
  "MaxRunCadence",
  "AvgWatts",
  "MaxWatts",
  "AverageHeartRateBpm",
  "MaximumHeartRateBpm",
] as const;

type LapFieldName = (typeof lapFieldNames)[number];

const lapFields: ReadonlySet<string> = new Set(lapFieldNames);

interface LapDraft {
  readonly startTime: number | undefined;
  readonly values: Partial<Record<LapFieldName, number>>;
  trigger: string | undefined;
  trackCount: number;
  firstTime: number | undefined;
  lastTime: number | undefined;
  firstPosition: TimedPoint | undefined;
}

interface ActivityDraft {
  readonly sport: SportAndSubSport;
  id: number | undefined;
}

export const maxLaps = 10_000;

const lapTriggers: Readonly<Record<string, LapTrigger>> = {
  Manual: "manual",
  Distance: "distance",
  Location: "positionLap",
  Time: "time",
};

const trackpointFields: Readonly<
  Record<string, Exclude<keyof TrackPoint, "time" | "latitude" | "longitude">>
> = {
  AltitudeMeters: "altitudeMetres",
  DistanceMeters: "distanceMetres",
  Cadence: "cadence",
};

const extensionFields: Readonly<Record<string, keyof TrackPoint>> = {
  Speed: "speedMetresPerSecond",
  Watts: "power",
  RunCadence: "cadence",
};

class TcxReader implements XmlHandler {
  readonly laps: FitLap[] = [];
  readonly sports = new Set<SportAndSubSport["sport"]>();
  firstSport: SportAndSubSport | undefined;
  earliest: number | undefined;
  latest: number | undefined;
  private activity: ActivityDraft | undefined;
  private lap: LapDraft | undefined;
  private inTrack = false;
  private point: TrackPoint | undefined;
  readonly track: Track;

  constructor(track: Track) {
    this.track = track;
  }

  open(name: string, attributes: XmlAttributes, ancestors: readonly string[]): void {
    const parent = ancestors.at(-1);
    if (ancestors.length === 0 && name !== "TrainingCenterDatabase") {
      throw new ActivityFileError("malformed", "tcx");
    }
    if (name === "Activity" && ancestors.includes("Activities")) {
      const sport = sportFromName(attributes.get("Sport"));
      this.activity = { sport, id: undefined };
      this.firstSport ??= sport;
      this.sports.add(sport.sport);
    } else if (name === "Lap" && parent === "Activity" && this.activity) {
      this.lap = {
        startTime: parseTime(attributes.get("StartTime")),
        values: {},
        trigger: undefined,
        trackCount: 0,
        firstTime: undefined,
        lastTime: undefined,
        firstPosition: undefined,
      };
    } else if (name === "Track" && parent === "Lap" && this.lap) {
      if (this.lap.trackCount > 0) this.track.segment();
      this.lap.trackCount += 1;
      this.inTrack = true;
    } else if (name === "Trackpoint" && parent === "Track" && this.inTrack) {
      this.point = emptyPoint();
    }
  }

  close(name: string, text: string, ancestors: readonly string[]): void {
    const parent = ancestors.at(-1);
    if (this.point) {
      this.closeInTrackpoint(this.point, name, text, ancestors);
    } else if (name === "Activity") {
      if (this.activity?.id !== undefined) this.include(this.activity.id);
      this.activity = undefined;
      this.lap = undefined;
    } else if (name === "Lap") {
      if (this.lap && this.activity) this.finishLap(lap(this.lap, this.activity.sport));
      this.lap = undefined;
      this.inTrack = false;
    } else if (name === "Track") {
      this.inTrack = false;
    } else if (this.lap) {
      this.closeInLap(this.lap, name, text, ancestors);
    } else if (name === "Id" && parent === "Activity" && this.activity) {
      this.activity.id = parseTime(text);
    }
  }

  private closeInTrackpoint(
    point: TrackPoint,
    name: string,
    text: string,
    ancestors: readonly string[],
  ): void {
    const parent = ancestors.at(-1);
    if (name === "Trackpoint") {
      if (isTimed(point) && this.lap) this.addPoint(this.lap, point);
      this.point = undefined;
    } else if (parent === "Trackpoint" && name === "Time") {
      point.time = parseTime(text);
    } else if (parent === "Trackpoint" && trackpointFields[name] !== undefined) {
      const field = trackpointFields[name];
      point[field] = field === "altitudeMetres" ? parseNumber(text) : parseMeasure(text);
    } else if (parent === "Position" && name === "LatitudeDegrees") {
      point.latitude = parseLatitude(text);
    } else if (parent === "Position" && name === "LongitudeDegrees") {
      point.longitude = parseLongitude(text);
    } else if (parent === "HeartRateBpm" && name === "Value") {
      point.heartRate = parseMeasure(text);
    } else if (parent === "TPX" && extensionFields[name] !== undefined) {
      const field = extensionFields[name];
      if (point[field] === undefined) point[field] = parseMeasure(text);
    }
  }

  private include(time: number): void {
    if (this.earliest === undefined || time < this.earliest) this.earliest = time;
    if (this.latest === undefined || time > this.latest) this.latest = time;
  }

  private finishLap(decoded: FitLap | undefined): void {
    if (!decoded) return;
    if (this.laps.length >= maxLaps) throw new ActivityFileError("tooLarge", "tcx");
    this.laps.push(decoded);
    this.include(decoded.startTime!.getTime());
    this.include(decoded.endTime!.getTime());
  }

  private addPoint(lap: LapDraft, point: TimedPoint): void {
    lap.firstTime ??= point.time;
    lap.lastTime = point.time;
    if (point.latitude !== undefined && point.longitude !== undefined) lap.firstPosition ??= point;
    this.track.add(point);
  }

  private closeInLap(
    lap: LapDraft,
    name: string,
    text: string,
    ancestors: readonly string[],
  ): void {
    const parent = ancestors.at(-1);
    if (parent === "Lap" && name === "TriggerMethod") {
      lap.trigger = text.trim();
    } else if ((parent === "Lap" || parent === "LX") && lapFields.has(name)) {
      lap.values[name as LapFieldName] ??= parseMeasure(text);
    } else if (
      name === "Value" &&
      ancestors.at(-2) === "Lap" &&
      (parent === "AverageHeartRateBpm" || parent === "MaximumHeartRateBpm")
    ) {
      lap.values[parent] ??= parseMeasure(text);
    }
  }
}

const latestDate = 8.64e15;

function lap(draft: LapDraft, sport: SportAndSubSport): FitLap | undefined {
  const timerSeconds = draft.values.TotalTimeSeconds;
  const startTime = draft.startTime ?? draft.firstTime;
  if (startTime === undefined) return undefined;
  const endTime = Math.max(draft.lastTime ?? startTime, startTime + (timerSeconds ?? 0) * 1000);
  if (!(endTime <= latestDate)) throw new ActivityFileError("malformed", "tcx");
  const { firstPosition, values } = draft;
  return {
    startTime: new Date(startTime),
    endTime: new Date(endTime),
    sport: sport.sport,
    subSport: sport.subSport,
    startLatitude: firstPosition?.latitude,
    startLongitude: firstPosition?.longitude,
    trigger: draft.trigger === undefined ? undefined : lapTriggers[draft.trigger],
    elapsedSeconds: (endTime - startTime) / 1000,
    timerSeconds,
    distanceMetres: values.DistanceMeters,
    calories: values.Calories,
    averageSpeedMetresPerSecond: values.AvgSpeed,
    maxSpeedMetresPerSecond: values.MaximumSpeed,
    averageHeartRate: values.AverageHeartRateBpm,
    maxHeartRate: values.MaximumHeartRateBpm,
    averageCadence: values.Cadence ?? values.AvgRunCadence,
    maxCadence: values.MaxBikeCadence ?? values.MaxRunCadence,
    averagePower: values.AvgWatts,
    maxPower: values.MaxWatts,
    normalizedPower: undefined,
    totalWorkJoules: undefined,
    totalAscentMetres: undefined,
    totalDescentMetres: undefined,
  };
}

export function readTcx(bytes: Uint8Array, keeps: TrackKeeps): TrackActivity {
  const track = new Track(keeps, "tcx");
  const reader = new TcxReader(track);
  scanXml(bytes, reader, "tcx");
  const { laps } = reader;
  if (track.start === undefined && laps.length === 0) {
    throw new ActivityFileError("noActivity", "tcx");
  }
  const times = [reader.earliest, reader.latest, track.start, track.end].filter(
    (time) => time !== undefined,
  );
  const start = Math.min(...times);
  const end = Math.max(...times);
  const sport =
    reader.sports.size > 1
      ? { sport: "multisport" as const, subSport: undefined }
      : (reader.firstSport ?? { sport: undefined, subSport: undefined });
  return {
    file: {
      format: "tcx",
      name: undefined,
      summary: summarize({ start, end, sport, laps, track }),
      laps,
    },
    start,
    track,
  };
}
