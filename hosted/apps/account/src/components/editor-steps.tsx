import type {
  Block,
  Cue,
  Intensity,
  Level,
  Repeat,
  Sport,
  Step,
  Target,
} from "@trainstack/workout";
import { type KeyboardEvent, useEffect, useRef } from "react";

import {
  type Path,
  type Problem,
  pathKey,
  withCadence,
  withDurationType,
  withLevelKind,
  withTargetType,
  withUnit,
} from "../lib/workout-editor";
import {
  durationText,
  intensityNames,
  type Overview,
  type Reference,
  stepTitle,
  targetText,
} from "../lib/workout-profile";
import {
  formatClock,
  formatNumber,
  parseClock,
  parseNumber,
  Segmented,
  Select,
  TextField,
} from "./editor-fields";
import { zoneClass } from "./workout-chart";

type LevelTarget = Exclude<Target, { type: "maxEffort" }>;

export type StepActions = {
  readonly change: (path: Path, block: Block, key: string) => void;
  readonly select: (path: Path | null) => void;
  readonly revealed: string | null;
  readonly toggleChecked: (path: Path) => void;
  readonly move: (path: Path, offset: -1 | 1) => void;
  readonly duplicate: (path: Path) => void;
  readonly remove: (path: Path) => void;
  readonly ungroup: (path: Path) => void;
  readonly addStep: (parent: Path) => void;
};

export type TreeContext = {
  readonly sport: Sport;
  readonly reference: Reference;
  readonly overview: Overview;
  readonly selected: string | null;
  readonly checked: ReadonlySet<string>;
  readonly problems: ReadonlyMap<string, readonly Problem[]>;
  readonly actions: StepActions;
};

export function StepTree({
  blocks,
  prefix,
  context,
}: {
  blocks: readonly Block[];
  prefix: Path;
  context: TreeContext;
}) {
  return (
    <ol className="editor-steps">
      {blocks.map((block, index) => {
        const path = [...prefix, index];
        return (
          <li key={pathKey(path)}>
            {block.type === "repeat" ? (
              <RepeatEditor
                repeat={block}
                path={path}
                last={index === blocks.length - 1}
                context={context}
              />
            ) : (
              <StepEditor
                step={block}
                path={path}
                last={index === blocks.length - 1}
                context={context}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function BlockButtons({
  path,
  last,
  name,
  context,
}: {
  path: Path;
  last: boolean;
  name: string;
  context: TreeContext;
}) {
  const { actions } = context;
  const first = path.at(-1) === 0;
  return (
    <span className="block-buttons">
      <button
        type="button"
        className="quiet icon-button"
        disabled={first}
        aria-label={`Move ${name} up`}
        title="Move up (Alt+↑)"
        onClick={() => actions.move(path, -1)}
      >
        <Arrow up />
      </button>
      <button
        type="button"
        className="quiet icon-button"
        disabled={last}
        aria-label={`Move ${name} down`}
        title="Move down (Alt+↓)"
        onClick={() => actions.move(path, 1)}
      >
        <Arrow />
      </button>
      <button
        type="button"
        className="quiet icon-button"
        aria-label={`Duplicate ${name}`}
        title="Duplicate"
        onClick={() => actions.duplicate(path)}
      >
        <CopyIcon />
      </button>
      <button
        type="button"
        className="quiet icon-button"
        aria-label={`Delete ${name}`}
        title="Delete"
        onClick={() => actions.remove(path)}
      >
        <TrashIcon />
      </button>
    </span>
  );
}

function onRowKeys(event: KeyboardEvent, path: Path, context: TreeContext) {
  if (!event.altKey) return;
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    event.stopPropagation();
    context.actions.move(path, event.key === "ArrowUp" ? -1 : 1);
  }
}

function Problems({ problems }: { problems: readonly Problem[] | undefined }) {
  if (!problems || problems.length === 0) return null;
  return (
    <ul className="block-problems" role="alert">
      {problems.map((problem, index) => (
        <li key={index}>{problem.message}</li>
      ))}
    </ul>
  );
}

function StepEditor({
  step,
  path,
  last,
  context,
}: {
  step: Step;
  path: Path;
  last: boolean;
  context: TreeContext;
}) {
  const key = pathKey(path);
  const open = context.selected === key;
  const problems = context.problems.get(key);
  const segment = context.overview.segments.find((candidate) => pathKey(candidate.path) === key);
  const title = stepTitle(step, context.reference);
  const target = targetText(step.target, context.reference);
  const row = useRef<HTMLDivElement>(null);

  const reveal = context.actions.revealed === key;
  useEffect(() => {
    if (reveal) row.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [reveal]);

  return (
    <div
      ref={row}
      data-path={key}
      className="editor-block editor-step"
      data-open={open || undefined}
      data-invalid={problems ? true : undefined}
      data-checked={context.checked.has(key) || undefined}
      onKeyDown={(event) => onRowKeys(event, path, context)}
    >
      <div className="block-row">
        <input
          type="checkbox"
          className="block-check"
          aria-label={`Select ${title}`}
          checked={context.checked.has(key)}
          onChange={() => context.actions.toggleChecked(path)}
        />
        <button
          type="button"
          className="block-summary"
          aria-expanded={open}
          onClick={() => context.actions.select(open ? null : path)}
        >
          <span
            className={`step-capsule ${segment ? zoneClass(segment) : "zone-none"}`}
            aria-hidden="true"
          />
          <span className="step-main">
            <span className="step-title">{title}</span>
            <span className="step-target">
              {title !== target.main && target.main}
              {target.detail && <span className="muted"> {target.detail}</span>}
            </span>
          </span>
          <span className="step-duration">{durationText(step)}</span>
        </button>
        <BlockButtons path={path} last={last} name={title} context={context} />
      </div>
      {!open && <Problems problems={problems} />}
      {open && <StepForm step={step} path={path} context={context} problems={problems ?? []} />}
    </div>
  );
}

const problemAt = (problems: readonly Problem[], prefix: string) =>
  problems.find((problem) => problem.field === prefix || problem.field.startsWith(`${prefix}.`))
    ?.message;

function StepForm({
  step,
  path,
  context,
  problems,
}: {
  step: Step;
  path: Path;
  context: TreeContext;
  problems: readonly Problem[];
}) {
  const { reference, sport } = context;
  const key = pathKey(path);
  const set = (next: Step, field: string) => context.actions.change(path, next, `${key}:${field}`);
  const speed =
    sport === "cycling"
      ? 8.3
      : (reference.thresholdSpeed ?? (sport === "running" ? 3.3 : 1.1)) * 0.85;
  const secondsPerMeter = 1 / speed;
  const targetType = step.target?.type ?? "free";
  return (
    <div className="step-form">
      <div className="form-row">
        <Segmented
          label="Lasts"
          value={step.duration.type}
          options={[
            ["time", "Time"],
            ["distance", "Distance"],
          ]}
          onChange={(type) => set(withDurationType(step, type, secondsPerMeter), "duration-type")}
        />
        {step.duration.type === "time" ? (
          <TextField
            label="Time"
            value={step.duration.seconds}
            format={formatClock}
            parse={(text) => {
              const seconds = parseClock(text);
              return seconds !== null && seconds > 0 && seconds <= 24 * 3600 ? seconds : null;
            }}
            hint="Minutes and seconds, like 5:00"
            inputMode="numeric"
            width={96}
            problem={problemAt(problems, "duration")}
            onCommit={(seconds) =>
              set({ ...step, duration: { type: "time", seconds } }, "duration")
            }
          />
        ) : (
          <TextField
            label="Distance"
            value={step.duration.meters}
            format={formatNumber(0)}
            parse={parseNumber(1, 1_000_000)}
            hint="Metres, at least 1"
            unit="m"
            inputMode="numeric"
            width={96}
            problem={problemAt(problems, "duration")}
            onCommit={(meters) =>
              set({ ...step, duration: { type: "distance", meters } }, "duration")
            }
          />
        )}
      </div>

      <div className="form-row">
        <Select
          label="Target"
          value={targetType}
          options={[
            ["power", "Power"],
            ["pace", "Pace"],
            ["heartRate", "Heart rate"],
            ["maxEffort", "All out"],
            ["free", sport === "cycling" ? "Free ride" : "Free"],
          ]}
          onChange={(type) =>
            set({ ...step, target: withTargetType(step.target, type) }, "target-type")
          }
        />
        {step.target && step.target.type !== "maxEffort" && (
          <TargetFields
            step={step}
            target={step.target}
            reference={reference}
            problems={problems}
            set={set}
          />
        )}
      </div>

      <div className="form-row">
        <Select
          label="Cadence"
          value={step.cadence?.kind ?? "none"}
          options={[
            ["none", "Any"],
            ["constant", "Steady"],
            ["range", "Range"],
          ]}
          onChange={(kind) =>
            set({ ...step, cadence: withCadence(step.cadence, kind, sport) }, "cadence-kind")
          }
        />
        <CadenceFields step={step} sport={sport} problems={problems} set={set} />
        <Select<Intensity | "none">
          label="Kind of step"
          value={step.intensity ?? "none"}
          options={[
            ["none", "Not set"],
            ...Object.entries(intensityNames).map(
              ([value, name]) => [value as Intensity, name] as const,
            ),
          ]}
          onChange={(intensity) =>
            set({ ...step, intensity: intensity === "none" ? undefined : intensity }, "intensity")
          }
        />
      </div>

      <div className="form-row">
        <TextField
          label="Name"
          value={step.name ?? ""}
          format={(value) => value}
          parse={(text) => text}
          width={220}
          onCommit={(name) => set({ ...step, name: name.trim() ? name : undefined }, "name")}
        />
      </div>
      <NotesField value={step.notes} onChange={(notes) => set({ ...step, notes }, "notes")} />
      <CueList
        cues={step.cues ?? []}
        unit={step.duration.type}
        problem={problemAt(problems, "cues")}
        onChange={(cues, field) =>
          set({ ...step, cues: cues.length > 0 ? cues : undefined }, field)
        }
      />
    </div>
  );
}

type UnitView = {
  readonly unit: string;
  readonly label: string;
  readonly suffix: string;
  readonly format: (value: number) => string;
  readonly parse: (text: string) => number | null;
  readonly hint: string;
};

function unitView(target: LevelTarget, unit: string, reference: Reference): UnitView {
  const percent: Omit<UnitView, "unit" | "label" | "suffix"> = {
    format: (value) => formatNumber(1)(value * 100),
    parse: (text) => {
      const value = parseNumber(0, 1000, 1)(text);
      return value === null ? null : Number((value / 100).toFixed(4));
    },
    hint: "A percentage, like 95",
  };
  switch (target.type) {
    case "power":
      return unit === "ftp"
        ? { unit, label: "% of FTP", suffix: "% FTP", ...percent }
        : {
            unit,
            label: "Watts",
            suffix: "W",
            format: formatNumber(0),
            parse: parseNumber(0, 3000),
            hint: "Watts, like 250",
          };
    case "heartRate":
      return unit === "threshold"
        ? { unit, label: "% of threshold HR", suffix: "% LTHR", ...percent }
        : {
            unit,
            label: "Beats per minute",
            suffix: "bpm",
            format: formatNumber(0),
            parse: parseNumber(0, 250),
            hint: "Beats per minute, like 150",
          };
    case "pace": {
      const per = reference.paceDistance;
      return unit === "threshold"
        ? { unit, label: "% of threshold pace", suffix: "% pace", ...percent }
        : {
            unit,
            label: per === 100 ? "Pace per 100 m" : "Pace per km",
            suffix: per === 100 ? "/100 m" : "/km",
            format: (speed) => (speed > 0 ? formatClock(per / speed) : "0:00"),
            parse: (text) => {
              const seconds = parseClock(text);
              return seconds === null || seconds <= 0 ? null : Number((per / seconds).toFixed(4));
            },
            hint: "Minutes and seconds, like 4:30",
          };
    }
  }
}

const unitsOf: Record<LevelTarget["type"], readonly string[]> = {
  power: ["ftp", "watts"],
  pace: ["threshold", "metersPerSecond"],
  heartRate: ["threshold", "bpm"],
};

function TargetFields({
  step,
  target,
  reference,
  problems,
  set,
}: {
  step: Step;
  target: LevelTarget;
  reference: Reference;
  problems: readonly Problem[];
  set: (step: Step, field: string) => void;
}) {
  const view = unitView(target, target.unit, reference);
  const setLevel = (level: Level, field: string) =>
    set({ ...step, target: { ...target, level } as LevelTarget }, field);
  const problem = problemAt(problems, "target");
  const value = (
    label: string,
    amount: number,
    apply: (amount: number) => Level,
    field: string,
  ) => (
    <TextField
      key={field}
      label={label}
      value={amount}
      format={view.format}
      parse={view.parse}
      hint={view.hint}
      unit={view.suffix}
      inputMode="decimal"
      width={80}
      onCommit={(next) => setLevel(apply(next), field)}
    />
  );
  const level = target.level;
  return (
    <>
      <Select
        label="Unit"
        value={target.unit}
        options={unitsOf[target.type].map(
          (unit) => [unit, unitView(target, unit, reference).label] as const,
        )}
        onChange={(unit) =>
          set({ ...step, target: withUnit(target, unit, reference) }, "target-unit")
        }
      />
      <Segmented
        label="Level"
        value={level.kind}
        options={[
          ["constant", "Steady"],
          ["range", "Range"],
          ["ramp", "Ramp"],
        ]}
        onChange={(kind) => setLevel(withLevelKind(level, kind), "level-kind")}
      />
      <div className="level-values">
        {level.kind === "constant" &&
          value("Target", level.value, (amount) => ({ kind: "constant", value: amount }), "value")}
        {level.kind === "range" && (
          <>
            {value("From", level.low, (amount) => ({ ...level, low: amount }), "low")}
            {value("To", level.high, (amount) => ({ ...level, high: amount }), "high")}
          </>
        )}
        {level.kind === "ramp" && (
          <>
            {value("Start", level.from, (amount) => ({ ...level, from: amount }), "from")}
            {value("End", level.to, (amount) => ({ ...level, to: amount }), "to")}
          </>
        )}
        {problem && (
          <p className="field-problem" role="alert">
            {problem}
          </p>
        )}
      </div>
    </>
  );
}

function CadenceFields({
  step,
  sport,
  problems,
  set,
}: {
  step: Step;
  sport: Sport;
  problems: readonly Problem[];
  set: (step: Step, field: string) => void;
}) {
  const cadence = step.cadence;
  if (!cadence) return null;
  const unit = sport === "running" ? "spm" : "rpm";
  const field = (
    label: string,
    value: number,
    apply: (value: number) => Step["cadence"],
    key: string,
  ) => (
    <TextField
      key={key}
      label={label}
      value={value}
      format={formatNumber(0)}
      parse={parseNumber(0, 300)}
      hint="A whole number"
      unit={unit}
      inputMode="numeric"
      width={64}
      problem={problemAt(problems, "cadence")}
      onCommit={(next) => set({ ...step, cadence: apply(next) }, `cadence-${key}`)}
    />
  );
  return cadence.kind === "constant" ? (
    field("Cadence", cadence.value, (value) => ({ kind: "constant", value }), "value")
  ) : (
    <>
      {field("From", cadence.low, (low) => ({ ...cadence, low }), "low")}
      {field("To", cadence.high, (high) => ({ ...cadence, high }), "high")}
    </>
  );
}

function NotesField({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <label className="field editor-field wide">
      <span>Notes</span>
      <textarea
        rows={2}
        value={value ?? ""}
        onChange={(event) =>
          onChange(event.currentTarget.value.trim() ? event.currentTarget.value : undefined)
        }
      />
    </label>
  );
}

function CueList({
  cues,
  unit,
  problem,
  onChange,
}: {
  cues: readonly Cue[];
  unit: "time" | "distance";
  problem: string | undefined;
  onChange: (cues: Cue[], field: string) => void;
}) {
  const replace = (index: number, cue: Cue, field: string) =>
    onChange(
      cues.map((held, at) => (at === index ? cue : held)),
      `cue-${index}-${field}`,
    );
  return (
    <fieldset className="cue-list">
      <legend className="field-legend">Cues</legend>
      {cues.map((cue, index) => (
        <div key={index} className="cue-row">
          {cue.at.type === "time" ? (
            <TextField
              label="At"
              value={cue.at.seconds}
              format={formatClock}
              parse={parseClock}
              hint="Minutes and seconds in"
              width={72}
              onCommit={(seconds) =>
                replace(index, { ...cue, at: { type: "time", seconds } }, "at")
              }
            />
          ) : (
            <TextField
              label="At"
              value={cue.at.meters}
              format={formatNumber(0)}
              parse={parseNumber(0, 1_000_000)}
              unit="m"
              width={72}
              onCommit={(meters) =>
                replace(index, { ...cue, at: { type: "distance", meters } }, "at")
              }
            />
          )}
          <TextField
            label="Text"
            value={cue.text}
            format={(text) => text}
            parse={(text) => (text.trim() ? text : null)}
            hint="Write the cue"
            width={240}
            onCommit={(text) => replace(index, { ...cue, text }, "text")}
          />
          <TextField<number | undefined>
            label="Shown for"
            value={cue.shownForSeconds}
            format={(seconds) => (seconds === undefined ? "" : String(seconds))}
            parse={parseShownFor}
            hint="Seconds, or leave empty"
            unit="s"
            inputMode="numeric"
            width={64}
            onCommit={(shownForSeconds) =>
              replace(
                index,
                shownForSeconds === undefined
                  ? { at: cue.at, text: cue.text }
                  : { ...cue, shownForSeconds },
                "shown",
              )
            }
          />
          <button
            type="button"
            className="quiet icon-button"
            aria-label={`Remove cue ${index + 1}`}
            onClick={() =>
              onChange(
                cues.filter((_, at) => at !== index),
                "cue-remove",
              )
            }
          >
            <TrashIcon />
          </button>
        </div>
      ))}
      {problem && (
        <p className="field-problem" role="alert">
          {problem}
        </p>
      )}
      <button
        type="button"
        className="quiet compact"
        onClick={() =>
          onChange(
            [
              ...cues,
              {
                at:
                  unit === "time" ? { type: "time", seconds: 0 } : { type: "distance", meters: 0 },
                text: "Settle in",
              },
            ],
            "cue-add",
          )
        }
      >
        Add cue
      </button>
    </fieldset>
  );
}

function parseShownFor(text: string): number | undefined | null {
  const trimmed = text.trim().replace(",", ".");
  if (trimmed === "") return undefined;
  const seconds = Number(trimmed);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function RepeatEditor({
  repeat,
  path,
  last,
  context,
}: {
  repeat: Repeat;
  path: Path;
  last: boolean;
  context: TreeContext;
}) {
  const key = pathKey(path);
  const problems = context.problems.get(key);
  const name = repeat.name ?? `${repeat.count} × repeat`;
  const set = (next: Repeat, field: string) =>
    context.actions.change(path, next, `${key}:${field}`);
  return (
    <div
      data-path={key}
      className="editor-block editor-repeat"
      data-invalid={problems ? true : undefined}
      data-checked={context.checked.has(key) || undefined}
      onKeyDown={(event) => {
        const head = (event.target as HTMLElement).closest(".repeat-head");
        if (head?.parentElement === event.currentTarget) onRowKeys(event, path, context);
      }}
    >
      <div className="block-row repeat-head">
        <input
          type="checkbox"
          className="block-check"
          aria-label={`Select ${name}`}
          checked={context.checked.has(key)}
          onChange={() => context.actions.toggleChecked(path)}
        />
        <TextField
          label="Repeat count"
          hideLabel
          value={repeat.count}
          format={formatNumber(0)}
          parse={parseNumber(1, 1000)}
          hint="A whole number of at least 1"
          unit="×"
          inputMode="numeric"
          width={56}
          onCommit={(count) => set({ ...repeat, count }, "count")}
        />
        <TextField
          label="Repeat name"
          hideLabel
          value={repeat.name ?? ""}
          format={(value) => value}
          parse={(text) => text}
          width={160}
          onCommit={(text) => set({ ...repeat, name: text.trim() ? text : undefined }, "name")}
        />
        <span className="repeat-tools">
          <button
            type="button"
            className="quiet compact"
            onClick={() => context.actions.ungroup(path)}
          >
            Ungroup
          </button>
          <BlockButtons path={path} last={last} name={name} context={context} />
        </span>
      </div>
      <Problems problems={problems} />
      <StepTree blocks={repeat.steps} prefix={path} context={context} />
      <div className="repeat-foot">
        <button
          type="button"
          className="quiet compact"
          onClick={() => context.actions.addStep(path)}
        >
          Add step to repeat
        </button>
        <RepeatCues repeat={repeat} set={set} />
      </div>
    </div>
  );
}

function RepeatCues({
  repeat,
  set,
}: {
  repeat: Repeat;
  set: (repeat: Repeat, field: string) => void;
}) {
  const first = repeat.steps.find((block): block is Step => block.type === "step");
  return (
    <details className="repeat-cues" open={(repeat.cues?.length ?? 0) > 0}>
      <summary className="quiet compact link-button">Cues over the repeat</summary>
      <CueList
        cues={repeat.cues ?? []}
        unit={first?.duration.type ?? "time"}
        problem={undefined}
        onChange={(cues, field) =>
          set({ ...repeat, cues: cues.length > 0 ? cues : undefined }, field)
        }
      />
    </details>
  );
}

function Arrow({ up = false }: { up?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d={up ? "M8 13V3m0 0L4 7m4-4 4 4" : "M8 3v10m0 0-4-4m4 4 4-4"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M5.5 5.5h7v7h-7Z M3.5 10.5v-7h7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
