import type { FitLap, LapTrigger } from "@trainstack/fit";

import type { DecodedActivity } from "./activity.ts";
import { ActivityFileError } from "./error.ts";
import { sportFromName, type SportAndSubSport } from "./sports.ts";
import {
  emptyPoint,
  isTimed,
  pauseEvents,
  pausesBetween,
  records,
  summarize,
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
  readonly tracks: TimedPoint[][];
}

interface ActivityDraft {
  readonly sport: string | undefined;
  id: number | undefined;
  readonly laps: LapDraft[];
}

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
  readonly activities: ActivityDraft[] = [];
  private activity: ActivityDraft | undefined;
  private lap: LapDraft | undefined;
  private track: TimedPoint[] | undefined;
  private point: TrackPoint | undefined;

  open(name: string, attributes: XmlAttributes, ancestors: readonly string[]): void {
    const parent = ancestors.at(-1);
    if (ancestors.length === 0 && name !== "TrainingCenterDatabase") {
      throw new ActivityFileError("malformed", "tcx");
    }
    if (name === "Activity" && ancestors.includes("Activities")) {
      this.activity = { sport: attributes.get("Sport"), id: undefined, laps: [] };
      this.activities.push(this.activity);
    } else if (name === "Lap" && parent === "Activity" && this.activity) {
      this.lap = {
        startTime: parseTime(attributes.get("StartTime")),
        values: {},
        trigger: undefined,
        tracks: [],
      };
      this.activity.laps.push(this.lap);
    } else if (name === "Track" && parent === "Lap" && this.lap) {
      this.track = [];
      this.lap.tracks.push(this.track);
    } else if (name === "Trackpoint" && parent === "Track" && this.track) {
      this.point = emptyPoint();
    }
  }

  close(name: string, text: string, ancestors: readonly string[]): void {
    const parent = ancestors.at(-1);
    if (this.point) {
      this.closeInTrackpoint(this.point, name, text, ancestors);
    } else if (name === "Activity") {
      this.activity = undefined;
      this.lap = undefined;
    } else if (name === "Lap") {
      this.lap = undefined;
    } else if (name === "Track") {
      this.track = undefined;
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
      if (isTimed(point)) this.track?.push(point);
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

function positioned(points: readonly TimedPoint[]): TimedPoint | undefined {
  return points.find((point) => point.latitude !== undefined && point.longitude !== undefined);
}

function lap(draft: LapDraft, sport: SportAndSubSport): FitLap | undefined {
  const points = draft.tracks.flat();
  const timerSeconds = draft.values.TotalTimeSeconds;
  const startTime = draft.startTime ?? points[0]?.time;
  if (startTime === undefined) return undefined;
  const lastPoint = points.at(-1)?.time;
  const endTime = Math.max(lastPoint ?? startTime, startTime + (timerSeconds ?? 0) * 1000);
  if (!(endTime <= latestDate)) throw new ActivityFileError("malformed", "tcx");
  const firstPosition = positioned(points);
  const { values } = draft;
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

function activitySport(activities: readonly ActivityDraft[]): SportAndSubSport {
  const sports = activities.map((activity) => sportFromName(activity.sport));
  const distinct = new Set(sports.map(({ sport }) => sport));
  if (distinct.size > 1) return { sport: "multisport", subSport: undefined };
  return sports[0] ?? { sport: undefined, subSport: undefined };
}

export function readTcx(bytes: Uint8Array): DecodedActivity {
  const reader = new TcxReader();
  scanXml(bytes, reader, "tcx");
  const segments: TimedPoint[][] = [];
  const laps: FitLap[] = [];
  const times: number[] = [];
  for (const activity of reader.activities) {
    const sport = sportFromName(activity.sport);
    if (activity.id !== undefined) times.push(activity.id);
    for (const draft of activity.laps) {
      const decoded = lap(draft, sport);
      if (decoded) {
        laps.push(decoded);
        times.push(decoded.startTime!.getTime(), decoded.endTime!.getTime());
      }
      draft.tracks.forEach((track, index) => {
        if (index > 0 || segments.length === 0) segments.push([]);
        const segment = segments.at(-1)!;
        for (const point of track) segment.push(point);
      });
    }
  }
  const points = segments.flat();
  if (points.length === 0 && laps.length === 0) throw new ActivityFileError("noActivity", "tcx");
  for (const { time } of points) times.push(time);
  const start = times.reduce((earliest, time) => Math.min(earliest, time));
  const end = times.reduce((latest, time) => Math.max(latest, time));
  const pauses = pausesBetween(segments);
  const decodedRecords = records(segments, start);
  return {
    format: "tcx",
    name: undefined,
    summary: summarize({
      start,
      end,
      sport: activitySport(reader.activities),
      laps,
      records: decodedRecords,
      pauses,
    }),
    laps,
    records: decodedRecords,
    events: pauseEvents(pauses),
  };
}
