import {
  decodeFit,
  FitDecodeError,
  streamFit,
  summarizeFit,
  type ActivitySummary,
  type FitEvent,
  type FitLap,
  type FitRecord,
  type RecordColumns,
  type StreamLimits,
} from "@trainstack/fit";

import { ActivityFileError, type ActivityFileFormat } from "./error.ts";
import { readGpx, type TrackActivity } from "./gpx.ts";
import { readTcx } from "./tcx.ts";
import type { TrackKeeps } from "./track.ts";
import { asUtf8, rootElementName } from "./xml.ts";

export type ActivityRecord = FitRecord;
export type ActivityLap = FitLap;
export type ActivityEvent = FitEvent;

export interface DecodedActivity {
  readonly format: ActivityFileFormat;
  readonly name: string | undefined;
  readonly summary: ActivitySummary;
  readonly laps: readonly ActivityLap[];
  readonly records: readonly ActivityRecord[];
  readonly events: readonly ActivityEvent[];
}

export interface ActivityFileSummary {
  readonly format: ActivityFileFormat;
  readonly name: string | undefined;
  readonly summary: ActivitySummary;
  readonly laps: readonly ActivityLap[];
}

export interface ActivityFileColumns extends ActivityFileSummary {
  readonly events: readonly ActivityEvent[];
  readonly records: RecordColumns;
}

export const maxActivityFileBytes = 64 * 1024 * 1024;

const fitSignature = [0x2e, 0x46, 0x49, 0x54];
const fitHeaderSizes = new Set([12, 14]);
const rootElements: Readonly<Record<string, ActivityFileFormat>> = {
  gpx: "gpx",
  TrainingCenterDatabase: "tcx",
};

function bytesOf(data: Uint8Array | ArrayBuffer): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

function isFit(bytes: Uint8Array): boolean {
  return (
    fitHeaderSizes.has(bytes[0] ?? 0) &&
    fitSignature.every((byte, index) => bytes[8 + index] === byte)
  );
}

export function detectActivityFileFormat(
  data: Uint8Array | ArrayBuffer,
): ActivityFileFormat | undefined {
  const bytes = bytesOf(data);
  if (isFit(bytes)) return "fit";
  const root = rootElementName(asUtf8(bytes));
  return root === undefined ? undefined : rootElements[root];
}

function checkedSize(data: Uint8Array | ArrayBuffer, format: ActivityFileFormat | undefined) {
  const bytes = bytesOf(data);
  if (bytes.length > maxActivityFileBytes) throw new ActivityFileError("tooLarge", format);
  return bytes;
}

function xmlBytes(data: Uint8Array | ArrayBuffer, format: "gpx" | "tcx"): Uint8Array {
  const bytes = asUtf8(checkedSize(data, format));
  const root = rootElementName(bytes);
  if (root === undefined || rootElements[root] !== format) {
    throw new ActivityFileError("unrecognizedFormat", undefined);
  }
  return bytes;
}

function decoded({ file, start, track }: TrackActivity): DecodedActivity {
  return { ...file, records: track.records(start), events: track.events };
}

export function decodeGpx(data: Uint8Array | ArrayBuffer): DecodedActivity {
  return decoded(readGpx(xmlBytes(data, "gpx"), "records"));
}

export function decodeTcx(data: Uint8Array | ArrayBuffer): DecodedActivity {
  return decoded(readTcx(xmlBytes(data, "tcx"), "records"));
}

function fitError(error: unknown): unknown {
  if (!(error instanceof FitDecodeError)) return error;
  const code =
    error.code === "notAFitFile" || error.code === "noWorkout" ? "malformed" : error.code;
  return new ActivityFileError(code, "fit", { cause: error });
}

function decodedFit(bytes: Uint8Array): DecodedActivity {
  try {
    const { workoutName, summary, laps, records, events } = decodeFit(bytes);
    return { format: "fit", name: workoutName, summary, laps, records, events };
  } catch (error) {
    throw fitError(error);
  }
}

function summarizedFit(bytes: Uint8Array): ActivityFileSummary {
  try {
    const { workoutName, summary, laps } = summarizeFit(bytes);
    return { format: "fit", name: workoutName, summary, laps };
  } catch (error) {
    throw fitError(error);
  }
}

export function decodeActivityFile(data: Uint8Array | ArrayBuffer): DecodedActivity {
  const bytes = checkedSize(data, undefined);
  const format = detectActivityFileFormat(bytes);
  if (format === "fit") return decodedFit(bytes);
  if (format === "gpx") return decodeGpx(bytes);
  if (format === "tcx") return decodeTcx(bytes);
  throw new ActivityFileError("unrecognizedFormat", undefined);
}

export function summarizeActivityFile(data: Uint8Array | ArrayBuffer): ActivityFileSummary {
  const bytes = checkedSize(data, undefined);
  const format = detectActivityFileFormat(bytes);
  if (format === "fit") return summarizedFit(bytes);
  if (format === "gpx") return readGpx(xmlBytes(bytes, "gpx"), "summary").file;
  if (format === "tcx") return readTcx(xmlBytes(bytes, "tcx"), "summary").file;
  throw new ActivityFileError("unrecognizedFormat", undefined);
}

function streamedFit(bytes: Uint8Array, limits: StreamLimits): ActivityFileColumns {
  try {
    const { workoutName, summary, laps, events, records } = streamFit(bytes, limits);
    return { format: "fit", name: workoutName, summary, laps, events, records };
  } catch (error) {
    throw fitError(error);
  }
}

function streamedTrack(
  read: (keeps: TrackKeeps) => TrackActivity,
  limits: StreamLimits,
): ActivityFileColumns {
  const { file, start, track: summarized } = read("summary");
  const { track } = read({ start, points: summarized.points, limits });
  return { ...file, events: track.events, records: track.columns! };
}

export function streamActivityFile(
  data: Uint8Array | ArrayBuffer,
  limits: StreamLimits,
): ActivityFileColumns {
  const bytes = checkedSize(data, undefined);
  const format = detectActivityFileFormat(bytes);
  if (format === "fit") return streamedFit(bytes, limits);
  if (format === "gpx") {
    const xml = xmlBytes(bytes, "gpx");
    return streamedTrack((keeps) => readGpx(xml, keeps), limits);
  }
  if (format === "tcx") {
    const xml = xmlBytes(bytes, "tcx");
    return streamedTrack((keeps) => readTcx(xml, keeps), limits);
  }
  throw new ActivityFileError("unrecognizedFormat", undefined);
}
