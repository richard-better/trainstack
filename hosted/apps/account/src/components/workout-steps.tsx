import {
  type Block,
  type Cue,
  type Repeat,
  type Step,
  type Workout,
  totals,
} from "@trainstack/workout";

import {
  cadenceText,
  durationText,
  formatMeters,
  formatSpan,
  lapStepsText,
  intensityNames,
  type Overview,
  type Reference,
  stepTitle,
  targetText,
} from "../lib/workout-profile";
import { pathKey, zoneClass } from "./workout-chart";

export function cueText(cue: Cue) {
  const at = cue.at.type === "time" ? formatSpan(cue.at.seconds) : formatMeters(cue.at.meters);
  return `${at} in: ${cue.text}`;
}

export function WorkoutSteps({
  workout,
  overview,
  reference,
  highlight,
  onHighlight,
}: {
  workout: Workout;
  overview: Overview;
  reference: Reference;
  highlight: string | null;
  onHighlight: (path: string | null) => void;
}) {
  const zoneOf = new Map(overview.segments.map((segment) => [pathKey(segment.path), segment]));
  return (
    <Blocks
      blocks={workout.steps}
      prefix={[]}
      context={{ reference, zoneOf, highlight, onHighlight }}
    />
  );
}

type Context = {
  readonly reference: Reference;
  readonly zoneOf: Map<string, Overview["segments"][number]>;
  readonly highlight: string | null;
  readonly onHighlight: (path: string | null) => void;
};

function Blocks({
  blocks,
  prefix,
  context,
}: {
  blocks: readonly Block[];
  prefix: readonly number[];
  context: Context;
}) {
  return (
    <ol className="workout-steps">
      {blocks.map((block, index) => {
        const path = [...prefix, index];
        return (
          <li key={pathKey(path)}>
            {block.type === "repeat" ? (
              <RepeatItem repeat={block} path={path} context={context} />
            ) : (
              <StepItem step={block} path={path} context={context} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function RepeatItem({
  repeat,
  path,
  context,
}: {
  repeat: Repeat;
  path: readonly number[];
  context: Context;
}) {
  const inner = totals(repeat.steps);
  const once = [
    inner.seconds > 0 ? formatSpan(inner.seconds) : null,
    inner.meters > 0 ? formatMeters(inner.meters) : null,
    inner.open.steps > 0 ? lapStepsText(inner.open.steps) : null,
  ]
    .filter(Boolean)
    .join(" + ");
  return (
    <div className="repeat-block">
      <p className="repeat-head">
        <span className="repeat-count">{repeat.count} ×</span>
        <span>{repeat.name ?? "Repeat"}</span>
        <span className="muted">{once} each</span>
      </p>
      {repeat.cues && repeat.cues.length > 0 && <Cues cues={repeat.cues} />}
      <Blocks blocks={repeat.steps} prefix={path} context={context} />
    </div>
  );
}

function StepItem({
  step,
  path,
  context,
}: {
  step: Step;
  path: readonly number[];
  context: Context;
}) {
  const { reference } = context;
  const key = pathKey(path);
  const segment = context.zoneOf.get(key);
  const target = targetText(step.target, reference);
  const cadence = cadenceText(step.cadence, reference.sport);
  const title = stepTitle(step, reference);
  const extra = [
    step.intensity && title !== intensityNames[step.intensity]
      ? intensityNames[step.intensity]
      : null,
    cadence,
  ].filter(Boolean);
  return (
    <div
      className="step-item"
      data-highlighted={context.highlight === key || undefined}
      onPointerEnter={() => context.onHighlight(key)}
      onPointerLeave={() => context.onHighlight(null)}
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
        {extra.length > 0 && <span className="step-extra">{extra.join(", ")}</span>}
        {step.notes && <span className="step-notes">{step.notes}</span>}
        {step.cues && step.cues.length > 0 && <Cues cues={step.cues} />}
      </span>
      <span className="step-duration">{durationText(step)}</span>
    </div>
  );
}

function Cues({ cues }: { cues: readonly Cue[] }) {
  return (
    <ul className="cues" aria-label="Cues">
      {cues.map((cue, index) => (
        <li key={index}>{cueText(cue)}</li>
      ))}
    </ul>
  );
}
