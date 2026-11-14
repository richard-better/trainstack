import type { ActivityFileSummary } from "./activity.ts";
import { ActivityFileError } from "./error.ts";
import { sportFromName } from "./sports.ts";
import {
  emptyPoint,
  isTimed,
  summarize,
  Track,
  type TrackKeeps,
  type TrackPoint,
} from "./track.ts";
import { parseLatitude, parseLongitude, parseMeasure, parseNumber, parseTime } from "./values.ts";
import { scanXml, type XmlAttributes, type XmlHandler } from "./xml.ts";

type PointField = Exclude<keyof TrackPoint, "time" | "latitude" | "longitude" | "altitudeMetres">;

const extensionFields: Readonly<Record<string, PointField>> = {
  hr: "heartRate",
  heartrate: "heartRate",
  cad: "cadence",
  cadence: "cadence",
  power: "power",
  powerinwatts: "power",
  watts: "power",
  speed: "speedMetresPerSecond",
  distance: "distanceMetres",
  atemp: "temperatureCelsius",
  temp: "temperatureCelsius",
  temperature: "temperatureCelsius",
};

class GpxReader implements XmlHandler {
  readonly track: Track;
  trackName: string | undefined;
  metadataName: string | undefined;
  trackType: string | undefined;
  private point: TrackPoint | undefined;

  constructor(track: Track) {
    this.track = track;
  }

  open(name: string, attributes: XmlAttributes, ancestors: readonly string[]): void {
    if (ancestors.length === 0 && name !== "gpx") throw new ActivityFileError("malformed", "gpx");
    if (name === "trkseg" && ancestors.at(-1) === "trk") {
      this.track.segment();
    } else if (name === "trkpt" && (ancestors.at(-1) === "trkseg" || ancestors.at(-1) === "trk")) {
      this.point = {
        ...emptyPoint(),
        latitude: parseLatitude(attributes.get("lat")),
        longitude: parseLongitude(attributes.get("lon")),
      };
      if (this.point.latitude === undefined || this.point.longitude === undefined) {
        this.point.latitude = undefined;
        this.point.longitude = undefined;
      }
    }
  }

  close(name: string, text: string, ancestors: readonly string[]): void {
    const parent = ancestors.at(-1);
    if (this.point) {
      if (name === "trkpt") {
        if (isTimed(this.point)) this.track.add(this.point);
        this.point = undefined;
      } else if (parent === "trkpt" && name === "time") {
        this.point.time = parseTime(text);
      } else if (parent === "trkpt" && name === "ele") {
        this.point.altitudeMetres = parseNumber(text);
      } else {
        const field = extensionFields[name.toLowerCase()];
        if (field !== undefined && this.point[field] === undefined) {
          this.point[field] =
            field === "temperatureCelsius" ? parseNumber(text) : parseMeasure(text);
        }
      }
    } else if (name === "name" && parent === "trk") {
      this.trackName ??= text.trim() || undefined;
    } else if (name === "name" && parent === "metadata") {
      this.metadataName ??= text.trim() || undefined;
    } else if (name === "type" && parent === "trk") {
      this.trackType ??= text.trim() || undefined;
    }
  }
}

export interface TrackActivity {
  readonly file: ActivityFileSummary;
  readonly start: number;
  readonly track: Track;
}

export function readGpx(bytes: Uint8Array, keeps: TrackKeeps): TrackActivity {
  const track = new Track(keeps, "gpx");
  const reader = new GpxReader(track);
  scanXml(bytes, reader, "gpx");
  const { start, end } = track;
  if (start === undefined || end === undefined) throw new ActivityFileError("noActivity", "gpx");
  return {
    file: {
      format: "gpx",
      name: reader.trackName ?? reader.metadataName,
      summary: summarize({ start, end, sport: sportFromName(reader.trackType), laps: [], track }),
      laps: [],
    },
    start,
    track,
  };
}
