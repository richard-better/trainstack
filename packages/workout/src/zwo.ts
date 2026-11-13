import { type Converted, IssueLog } from "./issues";
import type {
  Block,
  Cadence,
  Cue,
  Duration,
  Level,
  Repeat,
  Sport,
  Step,
  Target,
  Workout,
} from "./model";
import { formatNumber } from "./numbers";
import { powerLevel } from "./power";
import { CuePlacementError, flatten, repeatsWithin } from "./timeline";
import { checkedInput, validated } from "./validate";
import { parseXml, renderXml, type XmlElement, type XmlNode, XmlSyntaxError } from "./xml";

export type ZwoParseOptions = { name?: string };
export type ZwoWriteOptions = { ftp?: number };

type DurationType = Duration["type"];

const untitled = "Untitled workout";

const metadataElements = new Set([
  "author",
  "name",
  "description",
  "sportType",
  "durationType",
  "tags",
  "workout",
]);

const cadenceAttributes = ["Cadence", "CadenceLow", "CadenceHigh"];

const stepAttributes: Record<string, string[]> = {
  SteadyState: ["Duration", "Power", "PowerLow", "PowerHigh", "pace", ...cadenceAttributes],
  Warmup: ["Duration", "PowerLow", "PowerHigh", "pace", ...cadenceAttributes],
  Cooldown: ["Duration", "PowerLow", "PowerHigh", "pace", ...cadenceAttributes],
  Ramp: ["Duration", "PowerLow", "PowerHigh", "pace", ...cadenceAttributes],
  FreeRide: ["Duration", ...cadenceAttributes],
  MaxEffort: ["Duration", ...cadenceAttributes],
  IntervalsT: [
    "Repeat",
    "OnDuration",
    "OffDuration",
    "OnPower",
    "OffPower",
    "Cadence",
    "CadenceResting",
    "pace",
  ],
};

class ZwoReader {
  constructor(
    private readonly log: IssueLog,
    private readonly sport: Sport,
    private readonly durationType: DurationType,
  ) {}

  private where(element: XmlElement): string {
    return `<${element.name}> on line ${element.line}`;
  }

  private number(element: XmlElement, attribute: string): number | undefined {
    const raw = element.attributes.get(attribute);
    if (raw === undefined) return undefined;
    const value = Number(raw.trim());
    if (raw.trim() === "" || !Number.isFinite(value)) {
      this.log.fail("malformed", `${attribute}="${raw}" is not a number`, this.where(element));
      return undefined;
    }
    return value;
  }

  private required(element: XmlElement, attribute: string): number {
    const value = this.number(element, attribute);
    if (value === undefined && !element.attributes.has(attribute)) {
      this.log.fail("malformed", `${attribute} is missing`, this.where(element));
    }
    return value ?? 0;
  }

  private duration(amount: number): Duration {
    return this.durationType === "time"
      ? { type: "time", seconds: amount }
      : { type: "distance", meters: amount };
  }

  private target(level: Level): Target {
    return this.sport === "running"
      ? { type: "pace", unit: "threshold", level }
      : { type: "power", unit: "ftp", level };
  }

  private constantOrRange(low: number, high: number): Cadence {
    return low === high ? { kind: "constant", value: low } : { kind: "range", low, high };
  }

  private cadence(element: XmlElement, attribute = "Cadence"): Cadence | undefined {
    const constant = this.number(element, attribute);
    if (constant !== undefined) return { kind: "constant", value: constant };
    if (attribute !== "Cadence") return undefined;
    const low = this.number(element, "CadenceLow");
    const high = this.number(element, "CadenceHigh");
    if (low === undefined && high === undefined) return undefined;
    if (low === undefined || high === undefined) {
      this.log.fail("malformed", "CadenceLow and CadenceHigh come together", this.where(element));
      return undefined;
    }
    return this.constantOrRange(Math.min(low, high), Math.max(low, high));
  }

  private checkAttributes(element: XmlElement): void {
    const known = Object.hasOwn(stepAttributes, element.name)
      ? (stepAttributes[element.name] ?? [])
      : [];
    for (const attribute of element.attributes.keys()) {
      if (!known.includes(attribute)) {
        this.log.warn("dropped", `Attribute ${attribute} is not supported`, this.where(element));
      }
    }
    const pace = element.attributes.get("pace");
    if (pace !== undefined && this.sport === "running") {
      this.log.warn(
        "dropped",
        `Zwift reference pace ${pace} is read as a share of threshold pace`,
        this.where(element),
      );
    }
  }

  private cues(element: XmlElement): Cue[] | undefined {
    const cues: Cue[] = [];
    for (const child of element.children) {
      if (child.name.toLowerCase() !== "textevent") {
        this.log.warn("dropped", `<${child.name}> is not supported`, this.where(child));
        continue;
      }
      for (const attribute of child.attributes.keys()) {
        if (!["timeoffset", "message", "duration"].includes(attribute)) {
          this.log.warn("dropped", `Attribute ${attribute} is not supported`, this.where(child));
        }
      }
      const seconds = this.required(child, "timeoffset");
      const text = child.attributes.get("message") ?? "";
      if (text === "") {
        this.log.warn("dropped", "A text event without a message was skipped", this.where(child));
        continue;
      }
      const shownForSeconds = this.number(child, "duration");
      cues.push({
        at: { type: "time", seconds },
        text,
        ...(shownForSeconds === undefined ? {} : { shownForSeconds }),
      });
    }
    return cues.length > 0 ? cues : undefined;
  }

  block(element: XmlElement): Block | undefined {
    if (!Object.hasOwn(stepAttributes, element.name)) {
      this.log.fail(
        "unsupported",
        `<${element.name}> is not a known workout step`,
        this.where(element),
      );
      return undefined;
    }
    this.checkAttributes(element);
    if (element.name === "IntervalsT") return this.intervals(element);
    const duration = this.duration(this.required(element, "Duration"));
    const step: Step = { type: "step", duration };
    const target = this.stepTarget(element);
    if (target) step.target = target;
    if (element.name === "Warmup") step.intensity = "warmUp";
    if (element.name === "Cooldown") step.intensity = "coolDown";
    const cadence = this.cadence(element);
    if (cadence) step.cadence = cadence;
    const cues = this.cues(element);
    if (cues) step.cues = cues;
    return step;
  }

  private stepTarget(element: XmlElement): Target | undefined {
    switch (element.name) {
      case "FreeRide":
        return undefined;
      case "MaxEffort":
        return { type: "maxEffort" };
      case "SteadyState": {
        const power = this.number(element, "Power");
        if (power !== undefined) return this.target({ kind: "constant", value: power });
        const low = this.required(element, "PowerLow");
        const high = this.required(element, "PowerHigh");
        return this.target(this.constantOrRange(Math.min(low, high), Math.max(low, high)));
      }
      default: {
        const from = this.required(element, "PowerLow");
        const to = this.required(element, "PowerHigh");
        return this.target(
          from === to ? { kind: "constant", value: from } : { kind: "ramp", from, to },
        );
      }
    }
  }

  private intervals(element: XmlElement): Repeat {
    const count = this.number(element, "Repeat") ?? 1;
    if (!Number.isInteger(count) || count < 1) {
      this.log.fail(
        "malformed",
        `Repeat="${count}" is not a positive whole number`,
        this.where(element),
      );
    }
    const on: Step = {
      type: "step",
      duration: this.duration(this.required(element, "OnDuration")),
      target: this.target({ kind: "constant", value: this.required(element, "OnPower") }),
    };
    const off: Step = {
      type: "step",
      duration: this.duration(this.required(element, "OffDuration")),
      target: this.target({ kind: "constant", value: this.required(element, "OffPower") }),
    };
    const onCadence = this.cadence(element);
    if (onCadence) on.cadence = onCadence;
    const offCadence = this.cadence(element, "CadenceResting");
    if (offCadence) off.cadence = offCadence;
    const repeat: Repeat = { type: "repeat", count, steps: [on, off] };
    const cues = this.cues(element);
    if (cues) repeat.cues = cues;
    return repeat;
  }
}

function childText(root: XmlElement, name: string): string | undefined {
  const text = root.children.find((child) => child.name === name)?.text.trim();
  return text === "" ? undefined : text;
}

export function parseZwo(text: string, options: ZwoParseOptions = {}): Converted<Workout> {
  const log: IssueLog = new IssueLog("zwo");
  let root: XmlElement;
  try {
    root = parseXml(text);
  } catch (error) {
    if (error instanceof XmlSyntaxError) {
      return log.abort("malformed", `Not valid XML: ${error.message}`);
    }
    throw error;
  }
  if (root.name !== "workout_file") {
    log.abort("malformed", `Expected <workout_file> but found <${root.name}>`);
  }
  for (const child of root.children) {
    if (!metadataElements.has(child.name)) {
      log.warn("dropped", `<${child.name}> is not supported`, `line ${child.line}`);
    }
  }

  const sportType = childText(root, "sportType")?.toLowerCase() ?? "bike";
  const sport: Sport | undefined =
    sportType === "bike" ? "cycling" : sportType === "run" ? "running" : undefined;
  if (!sport) log.abort("unsupported", `Sport type "${sportType}" is not supported`);
  const durationType = childText(root, "durationType")?.toLowerCase() ?? "time";
  if (durationType !== "time" && durationType !== "distance") {
    log.abort("unsupported", `Duration type "${durationType}" is not supported`);
  }

  const name = childText(root, "name") ?? options.name;
  if (!name) log.warn("dropped", `The file has no name, so the workout is called "${untitled}"`);
  const workoutElement = root.children.find((child) => child.name === "workout");
  if (!workoutElement) log.abort("malformed", "The file has no <workout>");

  const reader = new ZwoReader(log, sport, durationType);
  const steps = workoutElement.children.flatMap((element) => reader.block(element) ?? []);
  const workout: Workout = { name: name ?? untitled, sport, steps };
  const description = childText(root, "description");
  if (description) workout.description = description;
  const author = childText(root, "author");
  if (author) workout.author = author;
  const tags = (root.children.find((child) => child.name === "tags")?.children ?? [])
    .map((tag) => tag.attributes.get("name")?.trim() ?? "")
    .filter((tag) => tag !== "");
  if (tags.length > 0) workout.tags = tags;
  return log.result(validated(log, workout));
}

class ZwoWriter {
  constructor(
    private readonly log: IssueLog,
    private readonly sport: Sport,
    private readonly options: ZwoWriteOptions,
  ) {}

  private level(target: Target | undefined, at: string): Level | undefined {
    if (!target || target.type === "maxEffort") return undefined;
    if (this.sport === "running") {
      if (target.type === "pace" && target.unit === "threshold") return target.level;
      this.log.fail(
        "unsupported",
        "Zwift run workouts only hold pace as a share of threshold pace",
        at,
      );
      return undefined;
    }
    if (target.type !== "power") {
      this.log.fail("unsupported", `Zwift bike workouts cannot hold ${target.type} targets`, at);
      return undefined;
    }
    return powerLevel(this.log, target, "ftp", this.options.ftp, at);
  }

  private amount(duration: Duration): number {
    return duration.type === "time" ? duration.seconds : duration.meters;
  }

  private cadenceAttributes(cadence: Cadence | undefined): [string, string | undefined][] {
    if (!cadence) return [];
    if (cadence.kind === "constant") return [["Cadence", formatNumber(cadence.value)]];
    return [
      ["CadenceLow", formatNumber(cadence.low)],
      ["CadenceHigh", formatNumber(cadence.high)],
    ];
  }

  private textEvents(cues: readonly Cue[], at: string, shift = 0): XmlNode[] {
    return cues.flatMap((cue) => {
      if (cue.at.type !== "time") {
        this.log.warn("dropped", `Cue "${cue.text}" is placed by distance`, at);
        return [];
      }
      return [
        {
          name: "textevent",
          attributes: [
            ["timeoffset", formatNumber(cue.at.seconds + shift)],
            ["message", cue.text],
            [
              "duration",
              cue.shownForSeconds === undefined ? undefined : formatNumber(cue.shownForSeconds),
            ],
          ],
        },
      ];
    });
  }

  private dropLabels(
    item: { name?: string | undefined; notes?: string | undefined },
    at: string,
  ): void {
    if (item.name) this.log.warn("dropped", `Name "${item.name}" has no place in a .zwo file`, at);
    if (item.notes) this.log.warn("dropped", "Notes have no place in a .zwo file", at);
  }

  step(step: Step, at: string): XmlNode {
    this.dropLabels(step, at);
    const level = this.level(step.target, at);
    const duration: [string, string] = ["Duration", formatNumber(this.amount(step.duration))];
    const cadence = this.cadenceAttributes(step.cadence);
    const children = this.textEvents(step.cues ?? [], at);
    const isRamp = level?.kind === "ramp";
    const keepsIntensity = isRamp && (step.intensity === "warmUp" || step.intensity === "coolDown");
    if (step.intensity && !keepsIntensity) {
      this.log.warn("dropped", `Intensity "${step.intensity}" has no place in this step`, at);
    }
    if (step.target?.type === "maxEffort") {
      return { name: "MaxEffort", attributes: [duration, ...cadence], children };
    }
    if (!level) return { name: "FreeRide", attributes: [duration, ...cadence], children };
    if (level.kind === "ramp") {
      const name =
        step.intensity === "warmUp"
          ? "Warmup"
          : step.intensity === "coolDown"
            ? "Cooldown"
            : "Ramp";
      return {
        name,
        attributes: [
          duration,
          ["PowerLow", formatNumber(level.from)],
          ["PowerHigh", formatNumber(level.to)],
          ...cadence,
        ],
        children,
      };
    }
    const power: [string, string][] =
      level.kind === "constant"
        ? [["Power", formatNumber(level.value)]]
        : [
            ["PowerLow", formatNumber(level.low)],
            ["PowerHigh", formatNumber(level.high)],
          ];
    return { name: "SteadyState", attributes: [duration, ...power, ...cadence], children };
  }

  private intervalPair(repeat: Repeat): [Step, Step] | undefined {
    const [on, off, ...rest] = repeat.steps;
    if (rest.length > 0 || on?.type !== "step" || off?.type !== "step") return undefined;
    const simple = (step: Step) =>
      step.duration.type === on.duration.type &&
      (step.duration.type === "time" || !step.cues) &&
      !step.intensity &&
      !step.name &&
      !step.notes &&
      step.cadence?.kind !== "range" &&
      step.target?.type === (this.sport === "running" ? "pace" : "power") &&
      step.target.level.kind === "constant";
    return simple(on) && simple(off) ? [on, off] : undefined;
  }

  repeat(repeat: Repeat, at: string): XmlNode[] {
    const pair = this.intervalPair(repeat);
    if (!pair) {
      this.log.warn("expanded", "This repeat is written out step by step", at);
      for (const inner of repeatsWithin([repeat])) {
        if (inner.name)
          this.log.warn("dropped", `Name "${inner.name}" has no place in a .zwo file`, at);
      }
      try {
        return flatten([repeat]).map((step, index) => this.step(step, `${at}.steps[${index}]`));
      } catch (error) {
        if (!(error instanceof CuePlacementError)) throw error;
        this.log.fail("unsupported", error.message, at);
        return [];
      }
    }
    const [on, off] = pair;
    if (repeat.name)
      this.log.warn("dropped", `Name "${repeat.name}" has no place in a .zwo file`, at);
    const onLevel = this.level(on.target, `${at}.steps[0]`);
    const offLevel = this.level(off.target, `${at}.steps[1]`);
    const onSeconds = this.amount(on.duration);
    const period = onSeconds + this.amount(off.duration);
    const children = [
      ...this.textEvents(repeat.cues ?? [], at),
      ...Array.from({ length: repeat.count }, (_, index) => [
        ...this.textEvents(on.cues ?? [], `${at}.steps[0]`, index * period),
        ...this.textEvents(off.cues ?? [], `${at}.steps[1]`, index * period + onSeconds),
      ]).flat(),
    ].sort((a, b) => Number(a.attributes?.[0]?.[1] ?? 0) - Number(b.attributes?.[0]?.[1] ?? 0));
    const value = (level: Level | undefined) =>
      level?.kind === "constant" ? formatNumber(level.value) : undefined;
    const cadence = (step: Step) =>
      step.cadence?.kind === "constant" ? formatNumber(step.cadence.value) : undefined;
    return [
      {
        name: "IntervalsT",
        attributes: [
          ["Repeat", repeat.count],
          ["OnDuration", formatNumber(onSeconds)],
          ["OffDuration", formatNumber(this.amount(off.duration))],
          ["OnPower", value(onLevel)],
          ["OffPower", value(offLevel)],
          ["Cadence", cadence(on)],
          ["CadenceResting", cadence(off)],
        ],
        children,
      },
    ];
  }

  blocks(blocks: readonly Block[], at: string): XmlNode[] {
    return blocks.flatMap((block, index) =>
      block.type === "step"
        ? [this.step(block, `${at}[${index}]`)]
        : this.repeat(block, `${at}[${index}]`),
    );
  }
}

function durationTypes(blocks: readonly Block[]): Set<DurationType> {
  return new Set(
    blocks.flatMap((block) =>
      block.type === "step" ? [block.duration.type] : [...durationTypes(block.steps)],
    ),
  );
}

export function writeZwo(workout: Workout, options: ZwoWriteOptions = {}): Converted<string> {
  const log: IssueLog = new IssueLog("zwo");
  const input = checkedInput(log, workout);
  if (!input) return log.result("");
  if (input.sport === "swimming") log.abort("unsupported", "Zwift workouts cannot hold swims");
  const types = durationTypes(input.steps);
  if (types.size > 1) {
    log.abort("unsupported", "A .zwo file measures every step in time or every step in distance");
  }
  if (input.focus) log.warn("dropped", `Focus "${input.focus}" has no place in a .zwo file`);
  const writer = new ZwoWriter(log, input.sport, options);
  const steps = writer.blocks(input.steps, "steps");
  const text = (name: string, value: string | undefined): XmlNode[] =>
    value === undefined ? [] : [{ name, text: value }];
  const document: XmlNode = {
    name: "workout_file",
    children: [
      ...text("author", input.author),
      ...text("name", input.name),
      ...text("description", input.description),
      ...text("sportType", input.sport === "running" ? "run" : "bike"),
      ...(types.has("distance") ? text("durationType", "distance") : []),
      ...(input.tags
        ? [
            {
              name: "tags",
              children: input.tags.map((tag) => ({ name: "tag", attributes: [["name", tag]] })),
            } satisfies XmlNode,
          ]
        : []),
      { name: "workout", children: steps },
    ],
  };
  return log.result(`<?xml version="1.0" encoding="UTF-8"?>\n${renderXml(document)}`);
}
