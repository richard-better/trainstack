import {
  decodeFit,
  FitDecodeError,
  type ActivitySummary,
  type FitActivity,
  type FitEvent,
  type FitLap,
  type FitRecord,
} from "@trainstack/fit";

import { ActivityFileError, type ActivityFileFormat } from "./error.ts";
import { readGpx } from "./gpx.ts";
import { readTcx } from "./tcx.ts";
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

export function decodeGpx(data: Uint8Array | ArrayBuffer): DecodedActivity {
  return readGpx(xmlBytes(data, "gpx"));
}

export function decodeTcx(data: Uint8Array | ArrayBuffer): DecodedActivity {
  return readTcx(xmlBytes(data, "tcx"));
}

function fromFit(activity: FitActivity): DecodedActivity {
  return {
    format: "fit",
    name: activity.workoutName,
    summary: activity.summary,
    laps: activity.laps,
    records: activity.records,
    events: activity.events,
  };
}

function decodedFit(bytes: Uint8Array): DecodedActivity {
  try {
    return fromFit(decodeFit(bytes));
  } catch (error) {
    if (!(error instanceof FitDecodeError)) throw error;
    const code = error.code === "notAFitFile" ? "malformed" : error.code;
    throw new ActivityFileError(code, "fit", { cause: error });
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
