import type { ActivityDetail } from "@trainstack/contract";
import {
  type FitActivity,
  type FitDecodeErrorCode,
  FitDecodeError,
  decodeFit,
} from "@trainstack/fit";

export type Reading =
  | { readonly kind: "decoded"; readonly fit: FitActivity }
  | { readonly kind: "unreadable"; readonly code: FitDecodeErrorCode };

export function readFit(bytes: Uint8Array): Reading {
  try {
    return { kind: "decoded", fit: decodeFit(bytes) };
  } catch (error) {
    if (error instanceof FitDecodeError) return { kind: "unreadable", code: error.code };
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
