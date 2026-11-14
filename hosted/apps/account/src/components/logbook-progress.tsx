import type { PyramidScale } from "@trainstack/contract";
import { fontGrades, fontToV, type MassUnit, inUnit } from "@trainstack/logbook";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { api } from "../api";
import { dayInShort } from "../lib/calendar";
import { exerciseName, formatMass, formatVolume } from "../lib/logbook";
import { type LoadRangeKey, loadRange } from "../lib/training";
import { logbookKey, useExercises, useLatest } from "./logbook-data";
import { Pyramid } from "./logged-activity";
import { PeriodPicker } from "./period-picker";

const progressRanges = ["3m", "1y", "3y"] as const satisfies readonly LoadRangeKey[];

export function LogbookProgress({ today }: { today: string }) {
  const strength = useLatest("strength");
  const bouldering = useLatest("bouldering");
  const [range, setRange] = useState<(typeof progressRanges)[number]>("1y");
  if (!strength.data && !bouldering.data) return null;
  const period = loadRange(range, today);
  return (
    <section aria-labelledby="logbook-title" className="logbook-progress">
      <div className="section-head">
        <h2 id="logbook-title" className="section-title">
          Lifting and climbing
        </h2>
        <PeriodPicker
          label="Progress over"
          options={progressRanges.map((key) => ({ key, label: loadRange(key, today).label }))}
          value={range}
          onChange={setRange}
        />
      </div>
      <div className="bests-grid">
        {strength.data && <StrengthProgress from={period.from} through={period.through} />}
        {bouldering.data && <BoulderingProgress from={period.from} through={period.through} />}
      </div>
    </section>
  );
}

function LoadFailed({ retry }: { retry: () => void }) {
  return (
    <div role="alert">
      <p className="notice">This did not load.</p>
      <button type="button" className="secondary" onClick={retry}>
        Try again
      </button>
    </div>
  );
}

function StrengthProgress({ from, through }: { from: string; through: string }) {
  const exercises = useExercises();
  const used = exercises.data?.used ?? [];
  const custom = exercises.data?.custom ?? [];
  const [chosen, setChosen] = useState<string | null>(null);
  const exerciseId = chosen ?? used[0]?.exerciseId ?? null;
  const progress = useQuery({
    queryKey: [...logbookKey, "progress", "strength", exerciseId, from, through],
    queryFn: () => api.logbook.strengthProgress({ exerciseId: exerciseId!, from, through }),
    enabled: exerciseId !== null,
  });
  const unit = progress.data?.unit ?? "kg";
  const points = progress.data?.points ?? [];
  const maxes = points.flatMap(({ day, numbers }) =>
    numbers.estimatedOneRepMaxKg === null ? [] : [{ day, value: numbers.estimatedOneRepMaxKg }],
  );
  const volumes = points.flatMap(({ day, numbers }) =>
    numbers.volumeKg === null ? [] : [{ day, value: numbers.volumeKg }],
  );
  return (
    <div>
      <div className="progress-head">
        <h3 className="group-title">Strength</h3>
        <label className="field">
          <span className="visually-hidden">Exercise</span>
          <select value={exerciseId ?? ""} onChange={(event) => setChosen(event.target.value)}>
            {used.map(({ exerciseId: id, sessions }) => (
              <option key={id} value={id}>
                {exerciseName(id, custom)} ({sessions})
              </option>
            ))}
          </select>
        </label>
      </div>
      {progress.isError ? (
        <LoadFailed retry={() => progress.refetch()} />
      ) : progress.isPending && exerciseId !== null ? (
        <div className="traces-loading short" aria-busy="true" aria-label="Loading progress" />
      ) : points.length === 0 ? (
        <p className="lede">No sessions of this exercise in this period.</p>
      ) : (
        <>
          {maxes.length > 1 && (
            <ProgressChart
              title="Estimated 1RM"
              points={maxes}
              format={(kg) => formatMass(kg, unit)}
              scale={(kg) => inUnit(kg, unit)}
              note="Epley, from the best set of 1 to 12 reps"
            />
          )}
          {volumes.length > 1 && (
            <ProgressChart
              title="Volume"
              points={volumes}
              format={(kg) => formatVolume(kg, unit)}
              scale={(kg) => inUnit(kg, unit)}
              bars
              note="Reps times load, warm-ups left out"
            />
          )}
          <ProgressTable points={points} unit={unit} />
        </>
      )}
    </div>
  );
}

function ProgressTable({
  points,
  unit,
}: {
  points: {
    sessionId: string;
    activityId: string;
    day: string;
    numbers: { sets: number; reps: number; heaviestKg: number | null };
  }[];
  unit: MassUnit;
}) {
  return (
    <ol className="progress-sessions">
      {[...points]
        .reverse()
        .slice(0, 5)
        .map((point) => (
          <li key={point.sessionId}>
            <Link to="/activities/$id" params={{ id: point.activityId }} className="text-link">
              {dayInShort(point.day)}
            </Link>
            <span className="muted">
              {plural(point.numbers.sets, "set")} · {plural(point.numbers.reps, "rep")}
              {point.numbers.heaviestKg !== null &&
                ` · top ${formatMass(point.numbers.heaviestKg, unit)}`}
            </span>
          </li>
        ))}
    </ol>
  );
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

const CHART_WIDTH = 320;
const CHART_HEIGHT = 96;

function ProgressChart({
  title,
  points,
  format,
  scale,
  bars = false,
  note,
}: {
  title: string;
  points: { day: string; value: number }[];
  format: (value: number) => string;
  scale: (value: number) => number;
  bars?: boolean;
  note: string;
}) {
  const values = points.map(({ value }) => scale(value));
  const high = Math.max(...values);
  const low = bars ? 0 : Math.min(...values);
  const span = high - low;
  const step = points.length > 1 ? CHART_WIDTH / (points.length - 1) : 0;
  const x = (index: number) => (points.length > 1 ? index * step : CHART_WIDTH / 2);
  const y = (value: number) =>
    span === 0 ? CHART_HEIGHT / 2 : CHART_HEIGHT - 8 - ((value - low) / span) * (CHART_HEIGHT - 16);
  const latest = points.at(-1)!;
  const best = points.reduce((top, point) => (point.value > top.value ? point : top), latest);
  return (
    <figure className="progress-chart">
      <figcaption>
        <span>{title}</span>
        <span>
          <strong>{format(latest.value)}</strong>
          {best !== latest && <span className="muted"> · best {format(best.value)}</span>}
        </span>
      </figcaption>
      <svg
        viewBox={`-6 0 ${CHART_WIDTH + 12} ${CHART_HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${title}: ${points.map((point) => `${point.day} ${format(point.value)}`).join(", ")}`}
      >
        {bars ? (
          values.map((value, index) => (
            <rect
              key={points[index]!.day + index}
              x={x(index) - 3}
              y={y(value)}
              width={6}
              height={CHART_HEIGHT - 8 - y(value)}
              rx={2}
            />
          ))
        ) : (
          <polyline points={values.map((value, index) => `${x(index)},${y(value)}`).join(" ")} />
        )}
      </svg>
      <p className="chart-note">{note}</p>
    </figure>
  );
}

function BoulderingProgress({ from, through }: { from: string; through: string }) {
  const [scale, setScale] = useState<PyramidScale>("v");
  const progress = useQuery({
    queryKey: [...logbookKey, "progress", "bouldering", from, through, scale],
    queryFn: () => api.logbook.boulderingProgress({ from, through, scale }),
  });
  const circuits = progress.data?.circuits ?? [];
  const scaleValue = typeof scale === "string" ? scale : `circuit:${scale.circuit}`;
  const steps = progress.data?.pyramid.steps ?? [];
  const widest = Math.max(1, ...steps.map((step) => step.flashes + step.sends + step.projects));
  const sessions = progress.data?.sessions ?? [];
  const hardest = sessions.flatMap(({ day, hardestTop }) =>
    hardestTop?.font ? [{ day, value: fontGrades.indexOf(hardestTop.font) }] : [],
  );
  return (
    <div>
      <div className="progress-head">
        <h3 className="group-title">Bouldering</h3>
        <label className="field">
          <span className="visually-hidden">Grades in</span>
          <select
            value={scaleValue}
            onChange={(event) => {
              const value = event.target.value;
              setScale(
                value === "font" || value === "v"
                  ? value
                  : { circuit: value.slice("circuit:".length) },
              );
            }}
          >
            <option value="v">V grades</option>
            <option value="font">Font grades</option>
            {circuits.map((circuit) => (
              <option key={circuit} value={`circuit:${circuit}`}>
                {circuit} colours
              </option>
            ))}
          </select>
        </label>
      </div>
      {progress.isError ? (
        <LoadFailed retry={() => progress.refetch()} />
      ) : progress.isPending ? (
        <div className="traces-loading short" aria-busy="true" aria-label="Loading progress" />
      ) : sessions.length === 0 ? (
        <p className="lede">No bouldering sessions in this period.</p>
      ) : (
        <>
          {steps.length > 0 ? (
            <Pyramid steps={steps} widest={widest} />
          ) : (
            <p className="lede">No problems in these grades.</p>
          )}
          {(progress.data?.pyramid.ungraded ?? 0) > 0 && (
            <p className="chart-note">
              {progress.data!.pyramid.ungraded} problems are on colours without a grade, so they are
              not in this pyramid.
            </p>
          )}
          {hardest.length > 1 && (
            <ProgressChart
              title="Hardest top"
              points={hardest}
              format={(index) => {
                const font = fontGrades[Math.round(index)];
                return font ? (scale === "v" ? fontToV[font] : font) : "";
              }}
              scale={(index) => index}
              note="Each session's hardest top"
            />
          )}
          <p className="chart-note">
            {plural(sessions.length, "session")} ·{" "}
            {plural(
              sessions.reduce((sum, { sends }) => sum + sends, 0),
              "send",
            )}{" "}
            ·{" "}
            {plural(
              sessions.reduce((sum, { attempts }) => sum + attempts, 0),
              "attempt",
            )}
          </p>
        </>
      )}
    </div>
  );
}
