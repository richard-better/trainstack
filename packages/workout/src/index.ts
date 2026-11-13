import {
  type CourseParseOptions,
  type CourseWriteOptions,
  parseCourse,
  writeCourse,
} from "./course.ts";
import {
  type Converted,
  type WorkoutFormat,
  WorkoutFormatError,
  workoutFormats,
} from "./issues.ts";
import type { Workout } from "./model.ts";
import { parseZwo, writeZwo } from "./zwo.ts";

export * from "./model.ts";
export {
  CuePlacementError,
  expandedLength,
  flatten,
  maxExpandedSteps,
  totals,
  type Totals,
} from "./timeline.ts";
export {
  type Converted,
  type FormatIssue,
  type IssueCode,
  type WorkoutFormat,
  WorkoutFormatError,
  workoutFormats,
} from "./issues.ts";
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

export function formatOfFile(fileName: string): WorkoutFormat | undefined {
  const extension = fileName.split(".").pop()?.toLowerCase();
  return workoutFormats.find((format) => format === extension);
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

export function parseWorkoutFile(fileName: string, text: string): Converted<Workout> {
  const format = formatOfFile(fileName);
  if (!format) {
    throw new WorkoutFormatError(undefined, [
      { code: "unsupported", message: `"${fileName}" is not a .zwo, .erg or .mrc file` },
    ]);
  }
  const name = fileName.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
  return parseWorkout(format, text, name ? { name } : {});
}
