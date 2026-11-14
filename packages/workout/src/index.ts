import {
  type CourseParseOptions,
  type CourseWriteOptions,
  parseCourse,
  writeCourse,
} from "./course.ts";
import { type FitParseOptions, parseFit } from "./fit-read.ts";
import {
  type Converted,
  type WorkoutFileFormat,
  type WorkoutFormat,
  WorkoutFormatError,
  workoutFileFormats,
  workoutFormats,
} from "./issues.ts";
import type { Workout } from "./model.ts";
import { parseZwo, writeZwo } from "./zwo.ts";

export * from "./model.ts";
export {
  CuePlacementError,
  cueCount,
  expandedLength,
  flatten,
  maxCues,
  maxExpandedSteps,
  totals,
  type Totals,
} from "./timeline.ts";
export {
  type Converted,
  type FormatIssue,
  type IssueCode,
  type WorkoutFileFormat,
  type WorkoutFormat,
  WorkoutFormatError,
  workoutFileFormats,
  workoutFormats,
} from "./issues.ts";
export {
  maxRepeatDepth,
  parseFit,
  type FitAthlete,
  type FitParseOptions,
  type FitZone,
  type FitZones,
} from "./fit-read.ts";
export {
  staircaseMetersPerStep,
  staircaseSecondsPerStep,
  writeFit,
  type FitWriteOptions,
} from "./fit-write.ts";
export { parseZwo, writeZwo, type ZwoParseOptions, type ZwoWriteOptions } from "./zwo.ts";
export type { CourseParseOptions as ErgParseOptions, CourseWriteOptions as ErgWriteOptions };
export type { CourseParseOptions as MrcParseOptions, CourseWriteOptions as MrcWriteOptions };

export type ParseOptions = { name?: string };
export type WriteOptions = { ftp?: number };

export function parseErg(text: string, options?: CourseParseOptions): Converted<Workout> {
  return parseCourse("erg", text, options);
}

export function writeErg(workout: Workout, options?: CourseWriteOptions): Converted<string> {
  return writeCourse("erg", workout, options);
}

export function parseMrc(text: string, options?: CourseParseOptions): Converted<Workout> {
  return parseCourse("mrc", text, options);
}

export function writeMrc(workout: Workout, options?: CourseWriteOptions): Converted<string> {
  return writeCourse("mrc", workout, options);
}

function extensionOf(fileName: string): string | undefined {
  return fileName.split(".").pop()?.toLowerCase();
}

export function formatOfFile(fileName: string): WorkoutFormat | undefined {
  const extension = extensionOf(fileName);
  return workoutFormats.find((format) => format === extension);
}

export function fileFormatOfFile(fileName: string): WorkoutFileFormat | undefined {
  const extension = extensionOf(fileName);
  return workoutFileFormats.find((format) => format === extension);
}

export function parseWorkout(
  format: WorkoutFormat,
  text: string,
  options: ParseOptions = {},
): Converted<Workout> {
  switch (format) {
    case "zwo":
      return parseZwo(text, options);
    case "erg":
      return parseErg(text, options);
    case "mrc":
      return parseMrc(text, options);
  }
}

export function writeWorkout(
  format: WorkoutFormat,
  workout: Workout,
  options: WriteOptions = {},
): Converted<string> {
  switch (format) {
    case "zwo":
      return writeZwo(workout, options);
    case "erg":
      return writeErg(workout, options);
    case "mrc":
      return writeMrc(workout, options);
  }
}

export type WorkoutFileOptions = Omit<FitParseOptions, "name">;

const utf8 = new TextDecoder("utf-8");

export function parseWorkoutFile(
  fileName: string,
  content: string | Uint8Array | ArrayBuffer,
  options: WorkoutFileOptions = {},
): Converted<Workout> {
  const format = fileFormatOfFile(fileName);
  if (!format) {
    throw new WorkoutFormatError(undefined, [
      { code: "unsupported", message: `"${fileName}" is not a .zwo, .erg, .mrc or .fit file` },
    ]);
  }
  const name = fileName.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
  const named = name ? { name } : {};
  if (format === "fit") {
    if (typeof content === "string") {
      throw new WorkoutFormatError("fit", [
        { code: "malformed", message: "A .fit file is binary; read it as bytes, not text" },
      ]);
    }
    return parseFit(content, { ...options, ...named });
  }
  return parseWorkout(format, typeof content === "string" ? content : utf8.decode(content), named);
}
