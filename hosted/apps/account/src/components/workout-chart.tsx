import type { Target } from "@trainstack/workout";
import { type KeyboardEvent, useId, useLayoutEffect, useRef, useState } from "react";

import {
  durationText,
  formatClock,
  formatMinutes,
  type Overview,
  type Reference,
  type Segment,
  stepTitle,
  targetText,
} from "../lib/workout-profile";
import { zoneStep } from "./zones";

export function useWidth<Element extends HTMLElement>() {
  const ref = useRef<Element>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export const zoneClass = (segment: Segment) =>
  segment.zone ? `zone-step-${zoneStep(segment.zone.index, segment.zone.count)}` : "zone-none";

export const pathKey = (path: readonly number[]) => path.join(".");

export type Geometry = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly total: number;
  readonly yMax: number;
};

export const xOf = (geometry: Geometry, seconds: number) =>
  geometry.left + (seconds / Math.max(geometry.total, 1)) * geometry.width;

export const yOf = (geometry: Geometry, share: number) =>
  geometry.top +
  geometry.height -
  (Math.min(share, geometry.yMax) / geometry.yMax) * geometry.height;

export const ceilingOf = (segments: readonly Segment[]) =>
  Math.max(
    1.25,
    ...segments.map((segment) => Math.max(segment.from, segment.to, segment.high) * 1.08),
  );

function roundedTop(x0: number, x1: number, top: number, base: number, radius: number) {
  const r = Math.max(0, Math.min(radius, (x1 - x0) / 2, base - top));
  return `M${x0},${base}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x1 - r}Q${x1},${top} ${x1},${top + r}V${base}Z`;
}

export function SegmentShape({
  segment,
  geometry,
  gap,
  radius,
  className,
}: {
  segment: Segment;
  geometry: Geometry;
  gap: number;
  radius: number;
  className?: string;
}) {
  const start = xOf(geometry, segment.start);
  const end = xOf(geometry, segment.start + segment.seconds);
  const inset = end - start > gap * 3 ? gap / 2 : 0;
  const x0 = start + inset;
  const x1 = Math.max(x0 + 0.5, end - inset);
  const base = geometry.top + geometry.height;
  const classes = `segment ${zoneClass(segment)} shape-${segment.shape} ${className ?? ""}`;
  switch (segment.shape) {
    case "ramp":
      return (
        <path
          className={classes}
          d={`M${x0},${base}L${x0},${yOf(geometry, segment.from)}L${x1},${yOf(geometry, segment.to)}L${x1},${base}Z`}
        />
      );
    case "range":
      return (
        <g className={classes}>
          <path
            className="range-band"
            d={roundedTop(x0, x1, yOf(geometry, segment.high), base, radius)}
          />
          <path d={roundedTop(x0, x1, yOf(geometry, segment.low), base, radius)} />
        </g>
      );
    default:
      return (
        <path
          className={classes}
          d={roundedTop(x0, x1, yOf(geometry, segment.from), base, radius)}
        />
      );
  }
}

export function WorkoutThumb({ overview, label }: { overview: Overview; label?: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const height = 36;
  const geometry: Geometry = {
    left: 0,
    top: 0,
    width,
    height,
    total: overview.seconds,
    yMax: ceilingOf(overview.segments),
  };
  return (
    <div
      ref={ref}
      className="workout-thumb"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {width > 0 && (
        <svg width={width} height={height} aria-hidden="true" focusable="false">
          {overview.segments.map((segment) => (
            <SegmentShape
              key={segment.key}
              segment={segment}
              geometry={geometry}
              gap={1}
              radius={1.5}
            />
          ))}
        </svg>
      )}
    </div>
  );
}

function tickStep(total: number) {
  const minutes = total / 60;
  const steps = [1, 2, 5, 10, 15, 20, 30, 60, 120];
  return (steps.find((step) => minutes / step <= 8) ?? 240) * 60;
}

type Line = { readonly share: number; readonly label: string; readonly kind: "threshold" | "zone" };

function zoneLines(overview: Overview, reference: Reference): Line[] {
  const seconds = new Map<Target["type"], number>();
  for (const segment of overview.segments) {
    const target = segment.step.target;
    if (target && target.type !== "maxEffort" && !segment.scaled) {
      seconds.set(target.type, (seconds.get(target.type) ?? 0) + segment.seconds);
    }
  }
  const main = [...seconds].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!main || main === "maxEffort") return [];
  const thresholdLabel = {
    power: reference.ftp === null ? "FTP" : `FTP ${reference.ftp} W`,
    heartRate:
      reference.thresholdHeartRate === null
        ? "Threshold HR"
        : `Threshold ${reference.thresholdHeartRate} bpm`,
    pace: "Threshold pace",
  }[main];
  const lines: Line[] = [{ share: 1, label: thresholdLabel, kind: "threshold" }];
  const set = reference.zones[main === "heartRate" ? "heart_rate" : main];
  const toShare = (value: number) => {
    if (main === "power") return reference.ftp ? value / reference.ftp : null;
    if (main === "heartRate")
      return reference.thresholdHeartRate ? value / reference.thresholdHeartRate : null;
    return reference.thresholdSpeed
      ? reference.paceDistance / value / reference.thresholdSpeed
      : null;
  };
  for (const zone of set?.zones ?? []) {
    if (zone.start === null) continue;
    const share = toShare(zone.start);
    if (share !== null) lines.push({ share, label: zone.label, kind: "zone" });
  }
  return lines;
}

export function useHighlight() {
  const [highlight, setHighlight] = useState<string | null>(null);
  return { highlight, setHighlight };
}

export function WorkoutChart({
  overview,
  reference,
  highlight,
  onHighlight,
  title,
}: {
  overview: Overview;
  reference: Reference;
  highlight: string | null;
  onHighlight: (path: string | null) => void;
  title: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hovered, setHovered] = useState<string | null>(null);
  const describedBy = useId();
  const narrow = width < 520;
  const height = narrow ? 200 : 260;
  const geometry: Geometry = {
    left: 40,
    top: 12,
    width: Math.max(0, width - 40 - (narrow ? 8 : 64)),
    height: height - 12 - 24,
    total: overview.seconds,
    yMax: ceilingOf(overview.segments),
  };
  const lines = zoneLines(overview, reference).filter((line) => line.share < geometry.yMax);
  const labelled = (line: Line) =>
    !narrow &&
    (line.kind === "threshold" || Math.abs(yOf(geometry, line.share) - yOf(geometry, 1)) >= 12);
  const ticks = Array.from(
    { length: Math.floor(overview.seconds / tickStep(overview.seconds)) + 1 },
    (_, index) => index * tickStep(overview.seconds),
  );
  const shares = [0.5, 1, 1.5, 2, 2.5].filter((share) => share < geometry.yMax);
  const active = overview.segments.find((segment) => segment.key === hovered) ?? null;

  function segmentAt(clientX: number, element: Element) {
    const x = clientX - element.getBoundingClientRect().left;
    const seconds = ((x - geometry.left) / Math.max(geometry.width, 1)) * overview.seconds;
    return (
      overview.segments.find(
        (segment) => seconds >= segment.start && seconds < segment.start + segment.seconds,
      ) ?? null
    );
  }

  function show(segment: Segment | null) {
    setHovered(segment?.key ?? null);
    onHighlight(segment ? pathKey(segment.path) : null);
  }

  function onKeyDown(event: KeyboardEvent) {
    const index = overview.segments.findIndex((segment) => segment.key === hovered);
    const next =
      event.key === "ArrowRight"
        ? index + 1
        : event.key === "ArrowLeft"
          ? index < 0
            ? overview.segments.length - 1
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? overview.segments.length - 1
              : null;
    if (next === null) {
      if (event.key === "Escape") show(null);
      return;
    }
    event.preventDefault();
    show(overview.segments[Math.max(0, Math.min(overview.segments.length - 1, next))] ?? null);
  }

  return (
    <figure className="workout-chart">
      <div
        ref={ref}
        className="workout-chart-plot"
        tabIndex={0}
        role="group"
        aria-label={`${title} profile. Use the left and right arrow keys to go through its steps.`}
        aria-describedby={describedBy}
        onKeyDown={onKeyDown}
        onBlur={() => show(null)}
        onPointerMove={(event) => show(segmentAt(event.clientX, event.currentTarget))}
        onPointerLeave={() => show(null)}
      >
        {width > 0 && (
          <svg width={width} height={height} aria-hidden="true" focusable="false">
            {shares.map((share) => (
              <g key={share}>
                <line
                  className="grid"
                  x1={geometry.left}
                  x2={geometry.left + geometry.width}
                  y1={yOf(geometry, share)}
                  y2={yOf(geometry, share)}
                />
                <text
                  className="tick"
                  x={geometry.left - 8}
                  y={yOf(geometry, share) + 4}
                  textAnchor="end"
                >
                  {Math.round(share * 100)}%
                </text>
              </g>
            ))}
            {ticks.map((seconds) => (
              <text
                key={seconds}
                className="tick"
                x={xOf(geometry, seconds)}
                y={height - 6}
                textAnchor={seconds === 0 ? "start" : "middle"}
              >
                {formatClock(seconds)}
              </text>
            ))}
            {overview.segments.map((segment) => (
              <SegmentShape
                key={segment.key}
                segment={segment}
                geometry={geometry}
                gap={2}
                radius={3}
                className={
                  highlight !== null && pathKey(segment.path) !== highlight ? "dimmed" : undefined
                }
              />
            ))}
            {lines.map((line) => (
              <g key={`${line.kind}-${line.label}`} className={`chart-line ${line.kind}`}>
                <line
                  x1={geometry.left}
                  x2={geometry.left + geometry.width}
                  y1={yOf(geometry, line.share)}
                  y2={yOf(geometry, line.share)}
                />
                {labelled(line) && (
                  <text
                    className="tick"
                    x={geometry.left + geometry.width + 8}
                    y={yOf(geometry, line.share) + 4}
                  >
                    {line.kind === "threshold" ? line.label.split(" ")[0] : `Z${line.label}`}
                  </text>
                )}
              </g>
            ))}
          </svg>
        )}
        {active && width > 0 && (
          <ChartTip
            segment={active}
            reference={reference}
            left={xOf(geometry, active.start + active.seconds / 2)}
            top={yOf(geometry, Math.max(active.from, active.to, active.high))}
            width={width}
          />
        )}
      </div>
      <figcaption id={describedBy} className="visually-hidden">
        {active ? describe(active, reference) : "The steps follow as a list."}
      </figcaption>
    </figure>
  );
}

function describe(segment: Segment, reference: Reference) {
  const target = targetText(segment.step.target, reference);
  return `${stepTitle(segment.step, reference)}, ${durationText(segment.step)}, ${target.main}${target.detail ? `, ${target.detail}` : ""}`;
}

function ChartTip({
  segment,
  reference,
  left,
  top,
  width,
}: {
  segment: Segment;
  reference: Reference;
  left: number;
  top: number;
  width: number;
}) {
  const target = targetText(segment.step.target, reference);
  const title = stepTitle(segment.step, reference);
  const clamped = Math.max(90, Math.min(width - 90, left));
  return (
    <div className="chart-tip" style={{ left: clamped, top }} aria-hidden="true">
      <span className="chart-tip-title">
        <span className={`zone-dot ${zoneClass(segment)}`} />
        {title}
      </span>
      <span>
        {durationText(segment.step)}
        {segment.estimated && (
          <span className="muted"> (about {formatMinutes(segment.seconds)})</span>
        )}
      </span>
      {title !== target.main && <span>{target.main}</span>}
      {target.detail && <span className="muted">{target.detail}</span>}
    </div>
  );
}
