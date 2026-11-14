import { type Converted, IssueLog } from "./issues.ts";
import type { Cue, Level, Step, Workout } from "./model.ts";
import { formatNumber, withoutFloatNoise } from "./numbers.ts";
import { withOpenStepsTimed } from "./open.ts";
import { powerLevel } from "./power.ts";
import { CuePlacementError, flatten, repeatsWithin } from "./timeline.ts";
import { checkedInput, validated } from "./validate.ts";

export type CourseFormat = "erg" | "mrc";
export type CourseParseOptions = { name?: string };
export type CourseWriteOptions = { ftp?: number; approximate?: boolean };

type Unit = "WATTS" | "PERCENT";
type Point = { seconds: number; value: number; line: number };

const untitled = "Untitled workout";
const knownHeaderKeys = new Set(["VERSION", "UNITS", "DESCRIPTION", "FILE NAME", "FTP"]);
const unitOf: Record<CourseFormat, Unit> = { erg: "WATTS", mrc: "PERCENT" };

type Section = { name: string; lines: { text: string; line: number }[] };

function sections(log: IssueLog, text: string): Map<string, Section> {
  const found = new Map<string, Section>();
  let open: Section | undefined;
  for (const [index, raw] of text
    .replace(/^﻿/, "")
    .split(/\r\n|\r|\n/)
    .entries()) {
    const line = index + 1;
    const content = raw.trim();
    if (content === "") continue;
    const marker = /^\[\s*(END\s+)?([A-Z ]+?)\s*\]$/i.exec(content);
    if (marker) {
      const name = (marker[2] ?? "").toUpperCase();
      if (marker[1]) {
        if (open?.name !== name)
          log.abort("malformed", `[END ${name}] closes no section`, `line ${line}`);
        open = undefined;
      } else {
        if (open) log.abort("malformed", `[${name}] opens inside [${open.name}]`, `line ${line}`);
        if (found.has(name)) log.abort("malformed", `[${name}] appears twice`, `line ${line}`);
        open = { name, lines: [] };
        found.set(name, open);
      }
      continue;
    }
    if (!open) log.abort("malformed", "Content outside any section", `line ${line}`);
    open.lines.push({ text: content, line });
  }
  if (open) log.abort("malformed", `[${open.name}] is never closed`);
  return found;
}

function parseNumber(log: IssueLog, raw: string, line: number): number {
  const value = Number(raw);
  if (raw === "" || !Number.isFinite(value)) {
    log.abort("malformed", `"${raw}" is not a number`, `line ${line}`);
  }
  return value;
}

function stepsFromPoints(log: IssueLog, points: Point[], unit: Unit): Step[] {
  const first = points[0];
  if (!first) log.abort("malformed", "[COURSE DATA] has no points");
  if (first.seconds !== 0)
    log.abort("malformed", "The first point must be at minute 0", `line ${first.line}`);
  const steps: Step[] = [];
  for (const [index, end] of points.entries()) {
    const start = points[index - 1];
    if (!start) continue;
    if (end.seconds < start.seconds) {
      log.abort("malformed", "Points must not go back in time", `line ${end.line}`);
    }
    if (end.seconds === start.seconds) continue;
    const toShare = (value: number) =>
      unit === "PERCENT" ? withoutFloatNoise(value / 100) : value;
    const level: Level =
      start.value === end.value
        ? { kind: "constant", value: toShare(start.value) }
        : { kind: "ramp", from: toShare(start.value), to: toShare(end.value) };
    steps.push({
      type: "step",
      duration: { type: "time", seconds: withoutFloatNoise(end.seconds - start.seconds) },
      target: { type: "power", unit: unit === "PERCENT" ? "ftp" : "watts", level },
    });
  }
  return steps;
}

function placeCues(log: IssueLog, steps: Step[], section: Section | undefined): void {
  for (const { text, line } of section?.lines ?? []) {
    const columns = text.includes("\t")
      ? text.split("\t").map((column) => column.trim())
      : (/^(\S+)\s+(.*?)(?:\s+(\d+(?:\.\d+)?))?$/.exec(text)?.slice(1) ?? []);
    const [at, message, shown] = columns;
    if (at === undefined || !message) {
      log.fail("malformed", "A course text line needs a time and a message", `line ${line}`);
      continue;
    }
    const seconds = parseNumber(log, at, line);
    let start = 0;
    const index = steps.findIndex((step, position) => {
      const length = step.duration.type === "time" ? step.duration.seconds : 0;
      const contains =
        seconds < start + length || (position === steps.length - 1 && seconds === start + length);
      if (!contains) start += length;
      return contains;
    });
    const step = steps[index];
    if (!step || seconds < 0) {
      log.fail(
        "malformed",
        `Course text at ${seconds} seconds is outside the workout`,
        `line ${line}`,
      );
      continue;
    }
    const cue: Cue = {
      at: { type: "time", seconds: withoutFloatNoise(seconds - start) },
      text: message,
    };
    if (shown) cue.shownForSeconds = parseNumber(log, shown, line);
    step.cues = [...(step.cues ?? []), cue];
  }
}

export function parseCourse(
  format: CourseFormat,
  text: string,
  options: CourseParseOptions = {},
): Converted<Workout> {
  const log: IssueLog = new IssueLog(format);
  const found = sections(log, text);
  const header = found.get("COURSE HEADER");
  const data = found.get("COURSE DATA");
  if (!header) log.abort("malformed", "The file has no [COURSE HEADER]");
  if (!data) log.abort("malformed", "The file has no [COURSE DATA]");
  for (const name of found.keys()) {
    if (!["COURSE HEADER", "COURSE DATA", "COURSE TEXT"].includes(name)) {
      log.warn("dropped", `[${name}] is not supported`);
    }
  }

  const values = new Map<string, string>();
  let unit: Unit | undefined;
  for (const { text: entry, line } of header.lines) {
    const separator = entry.indexOf("=");
    if (separator === -1) {
      const columns = entry.toUpperCase().split(/\s+/);
      if (
        columns[0] !== "MINUTES" ||
        (columns[1] !== "WATTS" && columns[1] !== "PERCENT") ||
        columns.length !== 2
      ) {
        log.abort("unsupported", `Columns "${entry}" are not supported`, `line ${line}`);
      }
      unit = columns[1] === "WATTS" ? "WATTS" : "PERCENT";
      continue;
    }
    const key = entry.slice(0, separator).trim().toUpperCase();
    const value = entry.slice(separator + 1).trim();
    if (!knownHeaderKeys.has(key))
      log.warn("dropped", `Header ${key} is not supported`, `line ${line}`);
    values.set(key, value);
  }
  if (!unit) log.abort("malformed", "The header does not name its columns, such as MINUTES WATTS");
  if (unit !== unitOf[format]) {
    log.warn(
      "malformed",
      `A .${format} file usually holds ${unitOf[format]}, but this one holds ${unit}`,
    );
  }
  if (values.has("FTP")) {
    log.warn("dropped", `Header FTP = ${values.get("FTP")} is not kept; targets stay as written`);
  }

  const points = data.lines.map(({ text: entry, line }) => {
    const columns = entry.split(/\s+/);
    if (columns.length !== 2)
      log.abort("malformed", "A data line needs a time and a value", `line ${line}`);
    const minutes = parseNumber(log, columns[0] ?? "", line);
    const value = parseNumber(log, columns[1] ?? "", line);
    if (value < 0) log.abort("malformed", "Values cannot be negative", `line ${line}`);
    return { seconds: withoutFloatNoise(minutes * 60), value, line };
  });
  const steps = stepsFromPoints(log, points, unit);
  placeCues(log, steps, found.get("COURSE TEXT"));

  const fileName = values.get("FILE NAME") || undefined;
  const description = values.get("DESCRIPTION") || undefined;
  const name = fileName ?? options.name ?? description;
  if (!name) log.warn("dropped", `The file has no name, so the workout is called "${untitled}"`);
  const workout: Workout = { name: name ?? untitled, sport: "cycling", steps };
  if (description && description !== workout.name) workout.description = description;
  return log.result(validated(log, workout));
}

function singleLine(log: IssueLog, text: string, what: string): string {
  if (!/[\t\r\n]/.test(text)) return text;
  log.warn("dropped", `Line breaks and tabs in ${what} became spaces`);
  return text.replace(/\s+/g, " ").trim();
}

export function writeCourse(
  format: CourseFormat,
  workout: Workout,
  options: CourseWriteOptions = {},
): Converted<string> {
  const log: IssueLog = new IssueLog(format);
  const input = checkedInput(log, workout);
  if (!input) return log.result("");
  const unit = unitOf[format];
  if (input.sport !== "cycling")
    log.warn("dropped", `Sport "${input.sport}" has no place in a .${format} file`);
  if (input.focus) log.warn("dropped", `Focus "${input.focus}" has no place in a .${format} file`);
  if (input.author)
    log.warn("dropped", `Author "${input.author}" has no place in a .${format} file`);
  if (input.tags) log.warn("dropped", `Tags have no place in a .${format} file`);
  if (input.steps.some((block) => block.type === "repeat")) {
    log.warn("expanded", `Repeats are written out step by step in a .${format} file`);
  }
  for (const repeat of repeatsWithin(input.steps)) {
    if (repeat.name) log.warn("dropped", `Name "${repeat.name}" has no place in this format`);
  }

  const blocks = withOpenStepsTimed(log, input.steps, options.approximate);
  if (log.errors.length > 0) return log.result("");
  let steps: Step[];
  try {
    steps = flatten(blocks);
  } catch (error) {
    if (!(error instanceof CuePlacementError)) throw error;
    return log.abort("unsupported", error.message);
  }

  const data: string[] = [];
  const text: string[] = [];
  let start = 0;
  const value = (amount: number) => formatNumber(unit === "PERCENT" ? amount * 100 : amount);
  for (const [index, step] of steps.entries()) {
    const at = `step ${index + 1}`;
    if (step.duration.type !== "time") {
      log.fail("unsupported", "Steps measured in distance have no place in this format", at);
      continue;
    }
    const seconds = step.duration.seconds;
    if (step.target?.type !== "power") {
      log.fail(
        "unsupported",
        step.target
          ? `A ${step.target.type} target has no place in this format`
          : "A step without a target has no place in this format",
        at,
      );
    }
    const level = powerLevel(
      log,
      step.target,
      unit === "PERCENT" ? "ftp" : "watts",
      options.ftp,
      at,
    );
    if (level?.kind === "range")
      log.fail("unsupported", "A power range has no place in this format", at);
    if (step.cadence) log.warn("dropped", "Cadence has no place in this format", at);
    if (step.intensity)
      log.warn("dropped", `Intensity "${step.intensity}" has no place in this format`, at);
    if (step.name) log.warn("dropped", `Name "${step.name}" has no place in this format`, at);
    if (step.notes) log.warn("dropped", "Notes have no place in this format", at);
    for (const cue of step.cues ?? []) {
      if (cue.at.type !== "time") {
        log.warn("dropped", `Cue "${cue.text}" is placed by distance`, at);
        continue;
      }
      const columns = [formatNumber(start + cue.at.seconds), singleLine(log, cue.text, "cue text")];
      if (cue.shownForSeconds !== undefined) columns.push(formatNumber(cue.shownForSeconds));
      text.push(columns.join("\t"));
    }
    if (level && level.kind !== "range") {
      const [from, to] =
        level.kind === "constant" ? [level.value, level.value] : [level.from, level.to];
      data.push(`${formatNumber(start / 60)}\t${value(from)}`);
      data.push(`${formatNumber((start + seconds) / 60)}\t${value(to)}`);
    }
    start += seconds;
  }

  const name = singleLine(log, input.name, "the name");
  const description = singleLine(log, input.description ?? input.name, "the description");
  const lines = [
    "[COURSE HEADER]",
    "VERSION = 2",
    "UNITS = ENGLISH",
    `DESCRIPTION = ${description}`,
    `FILE NAME = ${name}`,
    ...(options.ftp !== undefined && unit === "WATTS"
      ? [`FTP = ${formatNumber(options.ftp)}`]
      : []),
    `MINUTES ${unit}`,
    "[END COURSE HEADER]",
    "[COURSE DATA]",
    ...data,
    "[END COURSE DATA]",
    ...(text.length > 0 ? ["[COURSE TEXT]", ...text, "[END COURSE TEXT]"] : []),
  ];
  return log.result(`${lines.join("\n")}\n`);
}
