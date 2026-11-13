import type { ActivityDetail } from "@trainstack/contract";
import {
  type ActivityFileErrorCode,
  type ActivityFileFormat,
  type DecodedActivity,
  ActivityFileError,
  decodeActivityFile,
} from "@trainstack/activity-file";

export type Reading =
  | { readonly kind: "decoded"; readonly activity: DecodedActivity }
  | {
      readonly kind: "unreadable";
      readonly code: ActivityFileErrorCode;
      readonly format: ActivityFileFormat | undefined;
    };

export function readActivityFile(bytes: Uint8Array): Reading {
  try {
    return { kind: "decoded", activity: decodeActivityFile(bytes) };
  } catch (error) {
    if (error instanceof ActivityFileError) {
      return { kind: "unreadable", code: error.code, format: error.format };
    }
    throw error;
  }
}

export function downloadName(
  activity: Pick<ActivityDetail, "id" | "file">,
  title: string,
  startedAt: Date | null,
) {
  const words = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  const day = startedAt?.toISOString().slice(0, 10);
  const stem = [words, day].filter(Boolean).join("-") || activity.id;
  return `${stem}.${activity.file?.format ?? "bin"}`;
}

export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
