import { type KeyboardEvent, type PointerEvent, useId } from "react";

import { niceCeiling } from "../lib/series";
import { type LoadDay, formZones, signed } from "../lib/training";
import { useWidth } from "./traces";

const GUTTER = 40;
const RIGHT = 76;
const TOP = 10;
const BOTTOM = 8;
const LINES_HEIGHT = 190;
const FORM_HEIGHT = 140;
const LOAD_HEIGHT = 84;
const AXIS_HEIGHT = 22;

const monthFormat = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" });
const yearFormat = new Intl.DateTimeFormat("en-GB", { year: "numeric", timeZone: "UTC" });
const dayFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const dateOf = (day: string) => new Date(`${day}T00:00:00Z`);

function ticksOf(days: readonly LoadDay[]) {
  const count = days.length;
  if (count <= 60) {
    return days.flatMap((entry, index) =>
      dateOf(entry.day).getUTCDay() === 1
        ? [{ index, label: dayFormat.format(dateOf(entry.day)) }]
        : [],
    );
  }
  const every = count > 500 ? 3 : count > 200 ? 2 : 1;
  return days.flatMap((entry, index) => {
    const date = dateOf(entry.day);
    if (date.getUTCDate() !== 1 || date.getUTCMonth() % every !== 0) return [];
    const label = date.getUTCMonth() === 0 ? yearFormat.format(date) : monthFormat.format(date);
    return [{ index, label }];
  });
}

const linePath = (
  values: readonly number[],
  x: (index: number) => number,
  y: (v: number) => number,
) =>
  values
    .map(
      (value, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(value).toFixed(1)}`,
    )
    .join("");

export function LoadChart({
  days,
  selected,
  onSelect,
}: {
  days: readonly LoadDay[];
  selected: number;
  onSelect: (index: number) => void;
}) {
  const [ref, width] = useWidth();
  const hatch = useId();
  const plotWidth = Math.max(0, width - GUTTER - RIGHT);
  const step = days.length > 0 ? plotWidth / days.length : 0;
  const x = (index: number) => GUTTER + (index + 0.5) * step;
  const ticks = ticksOf(days);

  const linesTop = niceCeiling(Math.max(10, ...days.flatMap((d) => [d.fitness, d.fatigue])));
  const linesY = (value: number) => TOP + (1 - value / linesTop) * (LINES_HEIGHT - TOP - BOTTOM);

  const formLow = Math.min(-40, Math.floor(Math.min(...days.map((d) => d.form)) / 10) * 10);
  const formHigh = Math.max(30, Math.ceil(Math.max(...days.map((d) => d.form)) / 10) * 10);
  const formY = (value: number) =>
    TOP +
    ((formHigh - Math.min(formHigh, Math.max(formLow, value))) / (formHigh - formLow)) *
      (FORM_HEIGHT - TOP - BOTTOM);

  const loadTop = niceCeiling(Math.max(50, ...days.map((d) => d.stress)));
  const loadY = (value: number) => TOP + (1 - value / loadTop) * (LOAD_HEIGHT - TOP - BOTTOM);

  const last = days.length - 1;
  const current = days[selected];

  function track(event: PointerEvent<SVGSVGElement>) {
    if (step === 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const index = Math.floor((event.clientX - bounds.left - GUTTER) / step);
    onSelect(Math.max(0, Math.min(last, index)));
  }

  function move(event: KeyboardEvent<HTMLDivElement>) {
    const weekStep = event.shiftKey ? 7 : 1;
    const moves: Record<string, number> = {
      ArrowRight: Math.min(last, selected + weekStep),
      ArrowLeft: Math.max(0, selected - weekStep),
      PageUp: Math.max(0, selected - 28),
      PageDown: Math.min(last, selected + 28),
      Home: 0,
      End: last,
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    onSelect(moves[event.key]!);
  }

  const cursor = (height: number) =>
    current ? (
      <line
        className="cursor-line"
        x1={x(selected)}
        x2={x(selected)}
        y1={TOP}
        y2={height - BOTTOM}
      />
    ) : null;

  const axis = (
    <svg width={width} height={AXIS_HEIGHT} aria-hidden="true" className="load-axis">
      {ticks.map(({ index, label }) => (
        <text key={index} className="tick" x={x(index)} y={14} textAnchor="middle">
          {label}
        </text>
      ))}
    </svg>
  );

  const svgProps = {
    width,
    "aria-hidden": true as const,
    onPointerMove: track,
    onPointerDown: track,
  };

  const fitness = days.map((d) => d.fitness);
  const fatigue = days.map((d) => d.fatigue);
  const form = days.map((d) => d.form);
  const end = days.at(-1);

  return (
    <div
      ref={ref}
      className="load-chart"
      tabIndex={0}
      role="group"
      aria-label="Fitness, fatigue, form and daily load by day. Use the arrow keys to move a day, with Shift to move a week."
      onKeyDown={move}
    >
      {width > 0 && end && (
        <>
          <figure className="load-panel">
            <figcaption className="load-legend">
              <span className="load-key key-fitness">
                <svg width="22" height="10" aria-hidden="true">
                  <line x1="1" x2="21" y1="5" y2="5" />
                </svg>
                Fitness
              </span>
              <span className="load-key key-fatigue">
                <svg width="22" height="10" aria-hidden="true">
                  <line x1="1" x2="21" y1="5" y2="5" />
                </svg>
                Fatigue
              </span>
            </figcaption>
            <svg {...svgProps} height={LINES_HEIGHT} viewBox={`0 0 ${width} ${LINES_HEIGHT}`}>
              {[0, linesTop / 2, linesTop].map((tick) => (
                <g key={tick}>
                  <line
                    className="grid"
                    x1={GUTTER}
                    x2={width - RIGHT}
                    y1={linesY(tick)}
                    y2={linesY(tick)}
                  />
                  <text
                    className="tick"
                    x={GUTTER - 8}
                    y={linesY(tick)}
                    dy="0.32em"
                    textAnchor="end"
                  >
                    {tick}
                  </text>
                </g>
              ))}
              {cursor(LINES_HEIGHT)}
              <path className="line-fatigue" d={linePath(fatigue, x, linesY)} />
              <path className="line-fitness" d={linePath(fitness, x, linesY)} />
              <text className="end-label" x={x(last) + 8} y={linesY(end.fitness)} dy="0.32em">
                Fitness {Math.round(end.fitness)}
              </text>
              <text
                className="end-label"
                x={x(last) + 8}
                y={
                  linesY(end.fatigue) +
                  (Math.abs(linesY(end.fatigue) - linesY(end.fitness)) < 14
                    ? end.fatigue > end.fitness
                      ? -14
                      : 14
                    : 0)
                }
                dy="0.32em"
              >
                Fatigue {Math.round(end.fatigue)}
              </text>
              {current && (
                <>
                  <circle
                    className="dot-fatigue"
                    cx={x(selected)}
                    cy={linesY(current.fatigue)}
                    r={4}
                  />
                  <circle
                    className="dot-fitness"
                    cx={x(selected)}
                    cy={linesY(current.fitness)}
                    r={4}
                  />
                </>
              )}
            </svg>
          </figure>

          <figure className="load-panel">
            <figcaption className="load-legend">
              <span>Form, fitness minus fatigue</span>
            </figcaption>
            <svg {...svgProps} height={FORM_HEIGHT} viewBox={`0 0 ${width} ${FORM_HEIGHT}`}>
              <defs>
                <pattern
                  id={hatch}
                  width="6"
                  height="6"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <line x1="0" y1="0" x2="0" y2="6" className="hatch-line" />
                </pattern>
              </defs>
              {formZones.map((zone) => {
                const top = formY(Math.min(zone.to, formHigh));
                const bottom = formY(Math.max(zone.from, formLow));
                if (bottom - top < 1) return null;
                return (
                  <g key={zone.key} className={`form-zone zone-${zone.key}`}>
                    <rect x={GUTTER} y={top} width={plotWidth} height={bottom - top} />
                    {bottom - top >= 14 && (
                      <text
                        className="zone-name"
                        x={width - RIGHT + 8}
                        y={(top + bottom) / 2}
                        dy="0.32em"
                      >
                        {zone.label}
                      </text>
                    )}
                  </g>
                );
              })}
              {[formLow, 0, formHigh].map((tick) => (
                <text
                  key={tick}
                  className="tick"
                  x={GUTTER - 8}
                  y={formY(tick)}
                  dy="0.32em"
                  textAnchor="end"
                >
                  {signed(tick)}
                </text>
              ))}
              <line
                className="zero-line"
                x1={GUTTER}
                x2={width - RIGHT}
                y1={formY(0)}
                y2={formY(0)}
              />
              <path
                className="form-below"
                style={{ fill: `url(#${hatch})` }}
                d={`M${x(0)},${formY(0)}${form.map((value, index) => `L${x(index).toFixed(1)},${formY(Math.min(0, value)).toFixed(1)}`).join("")}L${x(last)},${formY(0)}Z`}
              />
              {cursor(FORM_HEIGHT)}
              <path className="line-form" d={linePath(form, x, formY)} />
              {current && (
                <circle className="dot-form" cx={x(selected)} cy={formY(current.form)} r={4} />
              )}
            </svg>
          </figure>

          <figure className="load-panel">
            <figcaption className="load-legend">
              <span>Daily load</span>
            </figcaption>
            <svg {...svgProps} height={LOAD_HEIGHT} viewBox={`0 0 ${width} ${LOAD_HEIGHT}`}>
              {[0, loadTop].map((tick) => (
                <g key={tick}>
                  <line
                    className="grid"
                    x1={GUTTER}
                    x2={width - RIGHT}
                    y1={loadY(tick)}
                    y2={loadY(tick)}
                  />
                  <text
                    className="tick"
                    x={GUTTER - 8}
                    y={loadY(tick)}
                    dy="0.32em"
                    textAnchor="end"
                  >
                    {tick}
                  </text>
                </g>
              ))}
              {cursor(LOAD_HEIGHT)}
              {days.map((entry, index) =>
                entry.stress > 0 ? (
                  <rect
                    key={entry.day}
                    className={index === selected ? "load-bar selected" : "load-bar"}
                    x={x(index) - Math.max(1, step * 0.7) / 2}
                    y={loadY(entry.stress)}
                    width={Math.max(1, step * 0.7)}
                    height={Math.max(1, loadY(0) - loadY(entry.stress))}
                    rx={step > 6 ? 2 : 0}
                  />
                ) : null,
              )}
            </svg>
          </figure>
          {axis}
        </>
      )}
    </div>
  );
}
