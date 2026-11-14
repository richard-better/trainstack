import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";

import {
  type Bucket,
  type Channel,
  type LapRow,
  type Trace,
  bucketed,
  indexAt,
  niceCeiling,
} from "../lib/series";
import { formatDuration } from "../lib/statistics";

const HEIGHT = 132;
const AXIS_HEIGHT = 22;
const GUTTER = 40;
const TOP = 10;

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

function domainOf(channel: Channel) {
  const top = niceCeiling(Math.max(channel.max, ...(channel.target ?? []).map((v) => v ?? 0)));
  if (channel.key !== "heartRate") return [0, top] as const;
  const present = channel.values.filter((value): value is number => value !== null);
  const bottom = Math.max(0, Math.floor((Math.min(...present) - 10) / 20) * 20);
  return [bottom, top] as const;
}

type Scale = (input: number) => number;

function runs(points: Bucket[]) {
  const found: { second: number; value: number }[][] = [];
  let current: { second: number; value: number }[] = [];
  for (const point of points) {
    if (point.value === null) {
      if (current.length) found.push(current);
      current = [];
    } else current.push({ second: point.second, value: point.value });
  }
  if (current.length) found.push(current);
  return found;
}

const coordinates = (run: { second: number; value: number }[], x: Scale, y: Scale) =>
  run.map((point) => `${x(point.second).toFixed(1)},${y(point.value).toFixed(1)}`).join("L");

function linePath(points: Bucket[], x: Scale, y: Scale) {
  return runs(points)
    .map((run) => `M${coordinates(run, x, y)}`)
    .join("");
}

function areaPath(points: Bucket[], x: Scale, y: Scale, baseline: number) {
  return runs(points)
    .map((run) => {
      const floor = y(baseline).toFixed(1);
      const start = x(run[0]!.second).toFixed(1);
      const end = x(run.at(-1)!.second).toFixed(1);
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
            ? `M${x(point.second).toFixed(1)},${y(point.value).toFixed(1)}`
            : `H${x(point.second).toFixed(1)}V${y(point.value).toFixed(1)}`,
        )
        .join("");
      const last = run.at(-1)!.second;
      return `${steps}H${x(last === points.at(-1)?.second ? end : last).toFixed(1)}`;
    })
    .join("");
}

function timeTicks(duration: number) {
  const steps = [60, 120, 300, 600, 900, 1200, 1800, 3600, 7200];
  const step = steps.find((candidate) => duration / candidate <= 6) ?? 14_400;
  const ticks: number[] = [];
  for (let second = 0; second <= duration; second += step) ticks.push(second);
  return duration < 60 ? [0, duration] : ticks;
}

const formatValue = (channel: Channel, value: number) =>
  value.toLocaleString("en-GB", {
    minimumFractionDigits: channel.digits,
    maximumFractionDigits: channel.digits,
  });

export function Traces({ trace, laps }: { trace: Trace; laps: LapRow[] }) {
  const [ref, width] = useWidth();
  const [cursor, setCursor] = useState<number | null>(null);
  const plotWidth = Math.max(0, width - GUTTER);
  const x = (second: number) =>
    GUTTER + (trace.duration ? (second / trace.duration) * plotWidth : 0);
  const cursorIndex = cursor === null ? null : indexAt(trace.seconds, cursor);
  const cursorSecond = cursorIndex === null ? null : trace.seconds[cursorIndex]!;

  function track(event: PointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const offset = event.clientX - bounds.left - GUTTER;
    if (offset < 0 || plotWidth === 0) return setCursor(null);
    setCursor(Math.min(1, offset / plotWidth) * trace.duration);
  }

  function step(event: KeyboardEvent<HTMLDivElement>) {
    const stride = Math.max(1, Math.round(trace.duration / 100));
    const moves: Record<string, number | null> = {
      ArrowRight: Math.min(trace.duration, (cursor ?? -stride) + stride),
      ArrowLeft: Math.max(0, (cursor ?? trace.duration + stride) - stride),
      Home: 0,
      End: trace.duration,
      Escape: null,
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    setCursor(moves[event.key]!);
  }

  return (
    <div
      ref={ref}
      className="traces"
      tabIndex={0}
      role="group"
      aria-label="Activity over time. Use the arrow keys to read values along the activity."
      onKeyDown={step}
      onBlur={() => setCursor(null)}
    >
      {width > 0 &&
        trace.channels.map((channel, index) => {
          const last = index === trace.channels.length - 1;
          const [bottom, top] = domainOf(channel);
          const plotHeight = HEIGHT - TOP;
          const y = (value: number) =>
            TOP + plotHeight - ((Math.max(bottom, value) - bottom) / (top - bottom)) * plotHeight;
          const points = bucketed(trace.seconds, channel.values, Math.max(2, plotWidth / 2));
          const target = channel.target
            ? bucketed(trace.seconds, channel.target, Math.max(2, plotWidth / 2))
            : null;
          const line = linePath(points, x, y);
          const area = areaPath(points, x, y, bottom);
          const value = cursorIndex === null ? null : channel.values[cursorIndex];
          const targetValue = cursorIndex === null ? null : channel.target?.[cursorIndex];
          const svgHeight = HEIGHT + (last ? AXIS_HEIGHT : 0);
          return (
            <figure key={channel.key} className={`trace trace-${channel.key}`}>
              <figcaption>
                <span className="trace-name">
                  <span className="swatch" aria-hidden="true" />
                  {channel.label}
                  {channel.target && (
                    <span className="target-key">
                      <span className="swatch target" aria-hidden="true" />
                      Target
                    </span>
                  )}
                </span>
                <span className="readout" aria-live="off">
                  {cursorSecond !== null ? (
                    <>
                      <strong>
                        {value === null || value === undefined ? "-" : formatValue(channel, value)}
                      </strong>{" "}
                      {channel.unit}
                      {targetValue !== null && targetValue !== undefined && (
                        <span className="muted"> of {formatValue(channel, targetValue)}</span>
                      )}
                      <span className="muted"> at {formatDuration(cursorSecond)}</span>
                    </>
                  ) : (
                    <>
                      <span className="muted">avg</span>{" "}
                      <strong>{formatValue(channel, channel.average)}</strong>
                      <span className="muted"> max</span>{" "}
                      <strong>{formatValue(channel, channel.max)}</strong> {channel.unit}
                    </>
                  )}
                </span>
              </figcaption>
              <svg
                width={width}
                height={svgHeight}
                viewBox={`0 0 ${width} ${svgHeight}`}
                role="img"
                aria-label={`${channel.label}: average ${formatValue(channel, channel.average)} ${channel.unit}, maximum ${formatValue(channel, channel.max)} ${channel.unit}`}
                onPointerMove={track}
                onPointerDown={track}
                onPointerLeave={(event) => event.pointerType === "mouse" && setCursor(null)}
              >
                {laps.map(
                  (lap) =>
                    lap.number % 2 === 0 && (
                      <rect
                        key={lap.number}
                        className="lap-band"
                        x={x(lap.startSecond)}
                        y={TOP}
                        width={Math.max(
                          0,
                          x(lap.startSecond + (lap.seconds ?? 0)) - x(lap.startSecond),
                        )}
                        height={plotHeight}
                      />
                    ),
                )}
                {[bottom, (bottom + top) / 2, top].map((tick) => (
                  <g key={tick}>
                    <line className="grid" x1={GUTTER} x2={width} y1={y(tick)} y2={y(tick)} />
                    <text className="tick" x={GUTTER - 8} y={y(tick)} dy="0.32em" textAnchor="end">
                      {tick.toLocaleString("en-GB")}
                    </text>
                  </g>
                ))}
                {target && (
                  <path className="target-line" d={stepPath(target, x, y, trace.duration)} />
                )}
                <path className="area" d={area} />
                <path className="line" d={line} />
                {cursorSecond !== null && (
                  <g className="cursor">
                    <line x1={x(cursorSecond)} x2={x(cursorSecond)} y1={TOP} y2={HEIGHT} />
                    {value !== null && value !== undefined && (
                      <circle cx={x(cursorSecond)} cy={y(value)} r={4} />
                    )}
                  </g>
                )}
                {last &&
                  timeTicks(trace.duration).map((second) => (
                    <text
                      key={second}
                      className="tick"
                      x={x(second)}
                      y={HEIGHT + 16}
                      textAnchor={
                        second === 0 ? "start" : second === trace.duration ? "end" : "middle"
                      }
                    >
                      {formatDuration(second)}
                    </text>
                  ))}
              </svg>
            </figure>
          );
        })}
    </div>
  );
}
