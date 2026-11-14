import type { ExportedWorkout } from "@trainstack/contract";
import {
  type Converted,
  type Workout,
  type WorkoutFileFormat,
  WorkoutFormatError,
  athleteThresholds,
  fitAthlete,
  parseWorkoutFile,
  writeFit,
  writeWorkout,
} from "@trainstack/workout";
import { type Profile, profileOn } from "@trainstack/zones";

import { DEFAULT_TIME_ZONE, dayIn } from "../activities/local-day";
import type { Database } from "../db";
import { settingsHistoryOf, timeZoneOf } from "../settings/router";
import { slugOf } from "./summary";

const contentTypes: Record<WorkoutFileFormat, string> = {
  zwo: "application/xml",
  erg: "text/plain",
  mrc: "text/plain",
  fit: "application/vnd.ant.fit",
};

export type FormatFailure = { failure: WorkoutFormatError };

export type AthleteToday = { profile: Profile; day: string };

export async function athleteToday(db: Database, userId: string): Promise<AthleteToday> {
  const [history, zone] = await Promise.all([
    settingsHistoryOf(db, userId),
    timeZoneOf(db, userId),
  ]);
  const day = dayIn(zone ?? DEFAULT_TIME_ZONE, new Date());
  return { profile: profileOn(history, day), day };
}

function converted<T>(convert: () => Converted<T>): Converted<T> | FormatFailure {
  try {
    return convert();
  } catch (error) {
    if (error instanceof WorkoutFormatError) return { failure: error };
    throw error;
  }
}

export function importedWorkout(
  fileName: string,
  bytes: Uint8Array,
  athlete: AthleteToday | undefined,
) {
  return converted(() =>
    parseWorkoutFile(fileName, bytes, {
      athlete:
        athlete &&
        ((sport) => fitAthlete(athlete.profile, sport, `your settings on ${athlete.day}`)),
    }),
  );
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

export type ExportOptions = {
  ftp?: number | undefined;
  approximate?: boolean | undefined;
};

export function exportedWorkout(
  workout: Workout,
  format: WorkoutFileFormat,
  options: ExportOptions,
  athlete: AthleteToday | undefined,
): ExportedWorkout | FormatFailure {
  const fileName = `${slugOf(workout.name) || "workout"}.${format}`;
  if (format === "fit") {
    const thresholds = athlete ? athleteThresholds(athlete.profile, workout.sport) : {};
    const result = converted(() =>
      writeFit(workout, {
        approximate: options.approximate,
        thresholdHeartRate: thresholds.thresholdHeartRate,
        thresholdPace: thresholds.thresholdPace,
        timeCreated: new Date(),
      }),
    );
    if ("failure" in result) return result;
    return {
      fileName,
      contentType: contentTypes.fit,
      base64: base64(result.value),
      warnings: result.warnings,
    };
  }
  const { ftp, approximate } = options;
  const result = converted(() =>
    writeWorkout(format, workout, {
      ...(ftp === undefined ? {} : { ftp }),
      ...(approximate === undefined ? {} : { approximate }),
    }),
  );
  if ("failure" in result) return result;
  return {
    fileName,
    contentType: contentTypes[format],
    text: result.value,
    warnings: result.warnings,
  };
}

export const failureData = ({ failure }: FormatFailure) => ({
  format: failure.format ?? null,
  issues: failure.issues,
});
