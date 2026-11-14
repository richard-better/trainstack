import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";

import {
  type Axis,
  type Bucket,
  type Channel,
  type LapRow,
  type Trace,
  axisPositions,
  bucketedAcrossPauses,
  indexAt,
  niceCeiling,
  positionAt,
  secondAt,
  steppedSecond,
} from "../lib/series";
import { formatDistance, formatDuration } from "../lib/statistics";
import type { Elevation } from "../lib/terrain";

const HEIGHT = 132;
const AXIS_HEIGHT = 22;
const GUTTER = 40;
const TOP = 10;
const SMALLEST_ELEVATION_SPAN = 50;

export function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

interface Row {
  readonly key: string;
  readonly label: string;
  readonly unit: string;
  readonly digits: number;
  readonly values: readonly (number | null)[];
  readonly target: readonly (number | null)[] | null;
  readonly domain: readonly [number, number];
  readonly summary: React.ReactNode;
  readonly description: string;
}

function channelDomain(channel: Channel) {
  const top = niceCeiling(Math.max(channel.max, ...(channel.target ?? []).map((v) => v ?? 0)));
  if (channel.key !== "heartRate") return [0, top] as const;
  const present = channel.values.filter((value): value is number => value !== null);
  const bottom = Math.max(0, Math.floor((Math.min(...present) - 10) / 20) * 20);
  return [bottom, top] as const;
}

function elevationDomain(elevation: Elevation) {
  let bottom = Math.floor(elevation.min / 10) * 10;
  let top = Math.ceil(elevation.max / 10) * 10;
  if (top - bottom < SMALLEST_ELEVATION_SPAN) {
    const middle = (top + bottom) / 2;
    bottom = Math.floor((middle - SMALLEST_ELEVATION_SPAN / 2) / 10) * 10;
    top = bottom + SMALLEST_ELEVATION_SPAN;
  }
  return [bottom, top] as const;
}

const formatNumber = (value: number, digits: number) =>
  value.toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits });

function rowsOf(trace: Trace, elevation: Elevation | null): Row[] {
  const rows: Row[] = trace.channels.map((channel) => ({
    key: channel.key,
    label: channel.label,
    unit: channel.unit,
    digits: channel.digits,
    values: channel.values,
    target: channel.target,
    domain: channelDomain(channel),
    summary: (
      <>
        <span className="muted">avg</span>{" "}
        <strong>{formatNumber(channel.average, channel.digits)}</strong>
        <span className="muted"> max</span>{" "}
        <strong>{formatNumber(channel.max, channel.digits)}</strong> {channel.unit}
      </>
    ),
    description: `${channel.label}: average ${formatNumber(channel.average, channel.digits)} ${channel.unit}, maximum ${formatNumber(channel.max, channel.digits)} ${channel.unit}`,
  }));
  if (!elevation) return rows;
  const ascent = formatNumber(elevation.ascent, 0);
  const descent = formatNumber(elevation.descent, 0);
  return [
    {
      key: "elevation",
      label: "Elevation",
      unit: "m",
      digits: 0,
      values: elevation.values,
      target: null,
      domain: elevationDomain(elevation),
      summary: (
        <>
          <span className="muted">ascent</span> <strong>{ascent}</strong>
          <span className="muted"> descent</span> <strong>{descent}</strong> m
        </>
      ),
      description: `Elevation from ${formatNumber(elevation.min, 0)} to ${formatNumber(elevation.max, 0)} m, ascent ${ascent} m, descent ${descent} m`,
    },
    ...rows,
  ];
}

type Scale = (input: number) => number;

function runs(points: Bucket[]) {
  const found: { at: number; value: number }[][] = [];
  let current: { at: number; value: number }[] = [];
  for (const point of points) {
    if (point.value === null) {
      if (current.length) found.push(current);
      current = [];
    } else current.push({ at: point.at, value: point.value });
  }
  if (current.length) found.push(current);
  return found;
}

const coordinates = (run: { at: number; value: number }[], x: Scale, y: Scale) =>
  run.map((point) => `${x(point.at).toFixed(1)},${y(point.value).toFixed(1)}`).join("L");

function linePath(points: Bucket[], x: Scale, y: Scale) {
  return runs(points)
    .map((run) => `M${coordinates(run, x, y)}`)
    .join("");
}

function areaPath(points: Bucket[], x: Scale, y: Scale, baseline: number) {
  return runs(points)
    .map((run) => {
      const floor = y(baseline).toFixed(1);
      const start = x(run[0]!.at).toFixed(1);
      const end = x(run.at(-1)!.at).toFixed(1);
      return `M${start},${floor}L${coordinates(run, x, y)}L${end},${floor}Z`;
    })
    .join("");
}

function stepPath(points: Bucket[], x: Scale, y: Scale, end: number) {
  return runs(points)
    .map((run) => {
      const steps = run
        .map((point, index) =>
          index === 0
            ? `M${x(point.at).toFixed(1)},${y(point.value).toFixed(1)}`
            : `H${x(point.at).toFixed(1)}V${y(point.value).toFixed(1)}`,
        )
        .join("");
      const last = run.at(-1)!.at;
      return `${steps}H${x(last === points.at(-1)?.at ? end : last).toFixed(1)}`;
    })
    .join("");
}

function ticksOf(extent: number, steps: readonly number[], fallback: number) {
  const step = steps.find((candidate) => extent / candidate <= 6) ?? fallback;
  const ticks: number[] = [];
  for (let at = 0; at <= extent; at += step) ticks.push(at);
  return ticks;
}

const timeTicks = (duration: number) =>
  duration < 60
    ? [0, duration]
    : ticksOf(duration, [60, 120, 300, 600, 900, 1200, 1800, 3600, 7200], 14_400);

const distanceTicks = (metres: number) =>
  metres < 500
    ? [0, metres]
    : ticksOf(metres, [100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000], 100_000);

const distanceLabel = (metres: number) => {
  const { value, unit } = formatDistance(metres);
  return `${unit === "km" ? String(Number(value)) : value} ${unit}`;
};

export function Traces({
  trace,
  laps,
  elevation,
  axis,
  cursor,
  onCursor,
}: {
  trace: Trace;
  laps: LapRow[];
  elevation: Elevation | null;
  axis: Axis;
  cursor: number | null;
  onCursor: (second: number | null) => void;
}) {
  const [ref, width] = useWidth();
  const positions = axisPositions(trace, axis);
  const extent = positions.at(-1) ?? 0;
  const plotWidth = Math.max(0, width - GUTTER);
  const x = (position: number) => GUTTER + (extent ? (position / extent) * plotWidth : 0);
  const cursorIndex = cursor === null ? null : indexAt(trace.seconds, cursor);
  const cursorPosition = cursorIndex === null ? null : positions[cursorIndex]!;
  const rows = rowsOf(trace, elevation);
  const describe = (position: number) =>
    axis === "distance" ? distanceLabel(position) : formatDuration(position);

  function track(event: PointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const offset = event.clientX - bounds.left - GUTTER;
    if (offset < 0 || plotWidth === 0) return onCursor(null);
    onCursor(secondAt(trace, axis, Math.min(1, offset / plotWidth) * extent));
  }

  function step(event: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, () => number | null> = {
      ArrowRight: () => steppedSecond(trace, axis, cursor, 1),
      ArrowLeft: () => steppedSecond(trace, axis, cursor, -1),
      Home: () => trace.seconds[0] ?? 0,
      End: () => trace.seconds.at(-1) ?? 0,
      Escape: () => null,
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    onCursor(move());
  }

  return (
    <div
      ref={ref}
      className="traces"
      tabIndex={0}
      role="group"
      aria-label="Activity charts. Use the arrow keys to read values along the activity and follow it on the map."
      onKeyDown={step}
      onBlur={() => onCursor(null)}
    >
      {width > 0 &&
        rows.map((row, index) => {
          const last = index === rows.length - 1;
          const [bottom, top] = row.domain;
          const plotHeight = HEIGHT - TOP;
          const y = (value: number) =>
            TOP +
            plotHeight -
            ((Math.min(top, Math.max(bottom, value)) - bottom) / (top - bottom)) * plotHeight;
          const buckets = Math.max(2, plotWidth / 2);
          const points = bucketedAcrossPauses(trace.seconds, positions, row.values, buckets);
          const target = row.target
            ? bucketedAcrossPauses(trace.seconds, positions, row.target, buckets)
            : null;
          const value = cursorIndex === null ? null : row.values[cursorIndex];
          const targetValue = cursorIndex === null ? null : row.target?.[cursorIndex];
          const svgHeight = HEIGHT + (last ? AXIS_HEIGHT : 0);
          return (
            <figure key={row.key} className={`trace trace-${row.key}`}>
              <figcaption>
                <span className="trace-name">
                  <span className="swatch" aria-hidden="true" />
                  {row.label}
                  {row.target && (
                    <span className="target-key">
                      <span className="swatch target" aria-hidden="true" />
                      Target
                    </span>
                  )}
                </span>
                <span className="readout" aria-live="off">
                  {cursorPosition !== null ? (
                    <>
                      <strong>
                        {value === null || value === undefined
                          ? "-"
                          : formatNumber(value, row.digits)}
                      </strong>{" "}
                      {row.unit}
                      {targetValue !== null && targetValue !== undefined && (
                        <span className="muted"> of {formatNumber(targetValue, row.digits)}</span>
                      )}
                      <span className="muted"> at {describe(cursorPosition)}</span>
                    </>
                  ) : (
                    row.summary
                  )}
                </span>
              </figcaption>
              <svg
                width={width}
                height={svgHeight}
                viewBox={`0 0 ${width} ${svgHeight}`}
                role="img"
                aria-label={row.description}
                onPointerMove={track}
                onPointerDown={track}
                onPointerLeave={(event) => event.pointerType === "mouse" && onCursor(null)}
              >
                {laps.map((lap) => {
                  if (lap.number % 2 !== 0) return null;
                  const start = x(positionAt(trace, axis, lap.startSecond));
                  const end = x(positionAt(trace, axis, lap.startSecond + (lap.seconds ?? 0)));
                  return (
                    <rect
                      key={lap.number}
                      className="lap-band"
                      x={start}
                      y={TOP}
                      width={Math.max(0, end - start)}
                      height={plotHeight}
                    />
                  );
                })}
                {[bottom, (bottom + top) / 2, top].map((tick) => (
                  <g key={tick}>
                    <line className="grid" x1={GUTTER} x2={width} y1={y(tick)} y2={y(tick)} />
                    <text className="tick" x={GUTTER - 8} y={y(tick)} dy="0.32em" textAnchor="end">
                      {tick.toLocaleString("en-GB")}
                    </text>
                  </g>
                ))}
                {target && <path className="target-line" d={stepPath(target, x, y, extent)} />}
                <path className="area" d={areaPath(points, x, y, bottom)} />
                <path className="line" d={linePath(points, x, y)} />
                {cursorPosition !== null && (
                  <g className="cursor">
                    <line x1={x(cursorPosition)} x2={x(cursorPosition)} y1={TOP} y2={HEIGHT} />
                    {value !== null && value !== undefined && (
                      <circle cx={x(cursorPosition)} cy={y(value)} r={4} />
                    )}
                  </g>
                )}
                {last &&
                  (axis === "distance" ? distanceTicks(extent) : timeTicks(extent)).map((at) => (
                    <text
                      key={at}
                      className="tick"
                      x={x(at)}
                      y={HEIGHT + 16}
                      textAnchor={at === 0 ? "start" : at === extent ? "end" : "middle"}
                    >
                      {describe(at)}
                    </text>
                  ))}
              </svg>
            </figure>
          );
        })}
    </div>
  );
}
