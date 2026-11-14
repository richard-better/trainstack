import type { ExportedWorkout } from "@trainstack/contract";
import {
  type Converted,
  type Workout,
  type WorkoutFormat,
  WorkoutFormatError,
  formatOfFile,
  parseWorkoutFile,
  writeWorkout,
} from "@trainstack/workout";

import { slugOf } from "./summary";

const contentTypes: Record<WorkoutFormat, string> = {
  zwo: "application/xml",
  erg: "text/plain",
  mrc: "text/plain",
};

export type FormatFailure = { failure: WorkoutFormatError };

function converted<T>(convert: () => Converted<T>): Converted<T> | FormatFailure {
  try {
    return convert();
  } catch (error) {
    if (error instanceof WorkoutFormatError) return { failure: error };
    throw error;
  }
}

export function importedWorkout(fileName: string, bytes: Uint8Array) {
  if (!formatOfFile(fileName)) {
    return {
      failure: new WorkoutFormatError(undefined, [
        { code: "unsupported", message: `"${fileName}" is not a .zwo, .erg or .mrc file` },
      ]),
    };
  }
  const text = new TextDecoder("utf-8").decode(bytes);
  return converted(() => parseWorkoutFile(fileName, text));
}

export function exportedWorkout(
  workout: Workout,
  format: WorkoutFormat,
  ftp: number | undefined,
): ExportedWorkout | FormatFailure {
  const result = converted(() => writeWorkout(format, workout, ftp === undefined ? {} : { ftp }));
  if ("failure" in result) return result;
  return {
    fileName: `${slugOf(workout.name) || "workout"}.${format}`,
    contentType: contentTypes[format],
    text: result.value,
    warnings: result.warnings,
  };
}

export const failureData = ({ failure }: FormatFailure) => ({
  format: failure.format ?? null,
  issues: failure.issues,
});
