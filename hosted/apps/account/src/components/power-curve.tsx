import { type KeyboardEvent, type PointerEvent, useState } from "react";

import { durationLabel, powerCurveDurations } from "../lib/analysis";
import { niceCeiling } from "../lib/series";
import { useWidth } from "./traces";

export interface CurvePoint {
  readonly durationSeconds: number;
  readonly watts: number;
}

export interface CurveSeries {
  readonly key: string;
  readonly label: string;
  readonly kind: "activity" | "best";
  readonly points: readonly CurvePoint[];
}

const HEIGHT = 200;
const TOP = 12;
const BOTTOM = 26;
const GUTTER = 44;
const RIGHT = 12;

const durations = powerCurveDurations.map(({ seconds }) => seconds);
const first = Math.log(durations[0]!);
const last = Math.log(durations.at(-1)!);

export function PowerCurve({ series, label }: { series: readonly CurveSeries[]; label: string }) {
  const [ref, width] = useWidth();
  const [cursor, setCursor] = useState<number | null>(null);
  const plotWidth = Math.max(0, width - GUTTER - RIGHT);
  const x = (seconds: number) =>
    GUTTER + ((Math.log(seconds) - first) / (last - first)) * plotWidth;
  const top = niceCeiling(
    Math.max(1, ...series.flatMap(({ points }) => points.map((p) => p.watts))),
  );
  const y = (watts: number) => TOP + (1 - watts / top) * (HEIGHT - TOP - BOTTOM);
  const at = cursor === null ? null : durations[cursor]!;

  function track(event: PointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const offset = event.clientX - bounds.left;
    let nearest = 0;
    durations.forEach((seconds, index) => {
      if (Math.abs(x(seconds) - offset) < Math.abs(x(durations[nearest]!) - offset)) {
        nearest = index;
      }
    });
    setCursor(nearest);
  }

  function step(event: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, number | null> = {
      ArrowRight: Math.min(durations.length - 1, (cursor ?? -1) + 1),
      ArrowLeft: Math.max(0, (cursor ?? durations.length) - 1),
      Home: 0,
      End: durations.length - 1,
      Escape: null,
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    setCursor(moves[event.key]!);
  }

  const path = (points: readonly CurvePoint[]) =>
    points
      .map(
        (point, index) =>
          `${index === 0 ? "M" : "L"}${x(point.durationSeconds).toFixed(1)},${y(point.watts).toFixed(1)}`,
      )
      .join("");

  return (
    <div
      ref={ref}
      className="power-curve"
      tabIndex={0}
      role="group"
      aria-label={`${label}. Use the arrow keys to read each duration.`}
      onKeyDown={step}
      onBlur={() => setCursor(null)}
    >
      <div className="curve-head">
        <ul className="curve-legend">
          {series.map((line) => (
            <li key={line.key} className={`curve-key curve-${line.kind}`}>
              <svg width="22" height="10" aria-hidden="true" focusable="false">
                <line x1="1" x2="21" y1="5" y2="5" />
              </svg>
              {line.label}
            </li>
          ))}
        </ul>
        <p className="readout curve-readout" aria-live="polite">
          {at === null ? (
            <span className="muted">Point at the curve, or use the arrow keys</span>
          ) : (
            <>
              <strong>{durationLabel(at)}</strong>
              {series.map((line) => {
                const point = line.points.find((p) => p.durationSeconds === at);
                return (
                  <span key={line.key}>
                    {" "}
                    <span className="muted">{line.label}</span>{" "}
                    {point ? `${Math.round(point.watts)} W` : "-"}
                  </span>
                );
              })}
            </>
          )}
        </p>
      </div>
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          aria-hidden="true"
          onPointerMove={track}
          onPointerDown={track}
          onPointerLeave={(event) => event.pointerType === "mouse" && setCursor(null)}
        >
          {[0, top / 2, top].map((tick) => (
            <g key={tick}>
              <line className="grid" x1={GUTTER} x2={width - RIGHT} y1={y(tick)} y2={y(tick)} />
              <text className="tick" x={GUTTER - 8} y={y(tick)} dy="0.32em" textAnchor="end">
                {tick.toLocaleString("en-GB")} W
              </text>
            </g>
          ))}
          {durations.map((seconds, index) => (
            <text
              key={seconds}
              className="tick"
              x={x(seconds)}
              y={HEIGHT - 8}
              textAnchor={index === 0 ? "start" : index === durations.length - 1 ? "end" : "middle"}
              data-minor={[15, 30, 1800].includes(seconds) || undefined}
            >
              {durationLabel(seconds)}
            </text>
          ))}
          {at !== null && (
            <line className="cursor-line" x1={x(at)} x2={x(at)} y1={TOP} y2={HEIGHT - BOTTOM} />
          )}
          {series.map((line) => (
            <g key={line.key} className={`curve curve-${line.kind}`}>
              <path d={path(line.points)} />
              {line.points.map((point) => (
                <circle
                  key={point.durationSeconds}
                  cx={x(point.durationSeconds)}
                  cy={y(point.watts)}
                  r={point.durationSeconds === at ? 5 : 3.5}
                />
              ))}
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}
