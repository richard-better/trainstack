import type { ActivityFileFormat } from "../db/schema";

const FIT_SIGNATURE = ".FIT";
const FIT_HEADER_SIZES = new Set([12, 14]);
const XML_ROOT_SEARCH_BYTES = 4096;

export const contentTypes: Record<ActivityFileFormat, string> = {
  fit: "application/vnd.ant.fit",
  gpx: "application/gpx+xml",
  tcx: "application/vnd.garmin.tcx+xml",
};

export function formatOf(bytes: Uint8Array): ActivityFileFormat | undefined {
  if (isFit(bytes)) return "fit";
  const start = new TextDecoder()
    .decode(bytes.subarray(0, XML_ROOT_SEARCH_BYTES))
    .replace(/^﻿/, "")
    .trimStart();
  if (!start.startsWith("<")) return undefined;
  const root = /<(?![?!])(?:[\w.-]+:)?([\w.-]+)[\s>/]/.exec(start)?.[1];
  if (root === "gpx") return "gpx";
  if (root === "TrainingCenterDatabase") return "tcx";
  return undefined;
}

function isFit(bytes: Uint8Array) {
  const headerSize = bytes[0] ?? 0;
  return (
    FIT_HEADER_SIZES.has(headerSize) &&
    bytes.length > headerSize &&
    new TextDecoder().decode(bytes.subarray(8, 12)) === FIT_SIGNATURE
  );
}

export async function sha256Hex(bytes: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const fileKey = (userId: string, activityId: string) => `activities/${userId}/${activityId}`;
