import { Link } from "@tanstack/react-router";
import { type KeyboardEvent, type PointerEvent, useState } from "react";

import {
  checkInItems,
  type HistoryDay,
  illnessSpans,
  injurySpans,
  itemTitles,
  type Span,
  summaryWords,
} from "../lib/check-in";
import { niceCeiling } from "../lib/series";
import { formatDay } from "../lib/settings";
import { useWidth } from "./traces";

const GUTTER = 76;
const RIGHT = 12;
const TOP = 8;
const BOTTOM = 6;
const FATIGUE_HEIGHT = 112;
const LANE = 16;
const LANE_GAP = 6;
const STATES_HEIGHT = 2 * LANE + LANE_GAP + 8;
const RATINGS_HEIGHT = checkInItems.length * (LANE + LANE_GAP) + 4;
const AXIS_HEIGHT = 22;

const monthFormat = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" });
const dayFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function ticksOf(days: readonly HistoryDay[]) {
  const dateOf = (day: string) => new Date(`${day}T00:00:00Z`);
  if (days.length <= 60) {
    return days.flatMap((entry, index) =>
      dateOf(entry.day).getUTCDay() === 1
        ? [{ index, label: dayFormat.format(dateOf(entry.day)) }]
        : [],
    );
  }
  const every = days.length > 200 ? 2 : 1;
  return days.flatMap((entry, index) => {
    const date = dateOf(entry.day);
    return date.getUTCDate() === 1 && date.getUTCMonth() % every === 0
      ? [{ index, label: monthFormat.format(date) }]
      : [];
  });
}

export function CheckInHistory({ days }: { days: readonly HistoryDay[] }) {
  const [ref, width] = useWidth();
  const last = days.length - 1;
  const [selected, setSelected] = useState(last);
  const plotWidth = Math.max(0, width - GUTTER - RIGHT);
  const step = days.length > 0 ? plotWidth / days.length : 0;
  const x = (index: number) => GUTTER + (index + 0.5) * step;
  const cell = Math.max(1, step - (step > 5 ? 2 : 0));
  const indexOf = new Map(days.map((entry, index) => [entry.day, index]));
  const checkIns = days.flatMap((entry) => (entry.checkIn ? [entry.checkIn] : []));

  const fatigues = days.flatMap((entry) => (entry.fatigue === null ? [] : [entry.fatigue]));
  const fatigueTop = niceCeiling(Math.max(10, ...fatigues));
  const fatigueY = (value: number) =>
    TOP + (1 - value / fatigueTop) * (FATIGUE_HEIGHT - TOP - BOTTOM);
  const fatiguePath = days
    .map((entry, index) =>
      entry.fatigue === null
        ? ""
        : `${index === 0 || days[index - 1]!.fatigue === null ? "M" : "L"}${x(index).toFixed(1)},${fatigueY(entry.fatigue).toFixed(1)}`,
    )
    .join("");

  const current = days[Math.min(selected, last)];

  function track(event: PointerEvent<SVGSVGElement>) {
    if (step === 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const index = Math.floor((event.clientX - bounds.left - GUTTER) / step);
    setSelected(Math.max(0, Math.min(last, index)));
  }

  function move(event: KeyboardEvent<HTMLDivElement>) {
    const weekStep = event.shiftKey ? 7 : 1;
    const moves: Record<string, number> = {
      ArrowRight: Math.min(last, selected + weekStep),
      ArrowLeft: Math.max(0, selected - weekStep),
      Home: 0,
      End: last,
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    setSelected(moves[event.key]!);
  }

  const cursor = (height: number) =>
    current ? (
      <line className="cursor-line" x1={x(selected)} x2={x(selected)} y1={2} y2={height - 2} />
    ) : null;

  const svgProps = {
    width,
    "aria-hidden": true as const,
    onPointerMove: track,
    onPointerDown: track,
  };

  const spanLane = (spans: readonly Span[], y: number, kind: "ill" | "injured") =>
    spans.map((span, place) => {
      const from = Math.max(0, indexOf.get(span.from) ?? 0);
      const through = Math.min(last, indexOf.get(span.through) ?? last);
      const left = x(from) - step / 2 + 1;
      const right = x(through) + step / 2 - 1;
      const spanWidth = Math.max(2, right - left);
      const labelWidth = span.label.length * 6.4 + 12;
      const fitsInside = spanWidth > labelWidth;
      const next = spans[place + 1];
      const nextLeft = next ? x(indexOf.get(next.from) ?? last) - step / 2 : width - RIGHT;
      const fitsAfter = right + labelWidth <= nextLeft;
      return (
        <g key={`${kind}-${span.from}`} className={`span span-${kind}`}>
          <rect x={left} y={y} width={spanWidth} height={LANE} rx={3} />
          {(fitsInside || fitsAfter) && (
            <text
              x={fitsInside ? left + 6 : right + 6}
              y={y + LANE / 2}
              dy="0.34em"
              className="span-label"
            >
              {span.label}
            </text>
          )}
        </g>
      );
    });

  return (
    <div className="check-in-history">
      <div
        ref={ref}
        className="history-chart"
        tabIndex={0}
        role="group"
        aria-label="Training fatigue, illness, injury and your check-in ratings by day. Use the arrow keys to move a day, with Shift to move a week. Each day is also in the list below."
        onKeyDown={move}
      >
        {width > 0 && (
          <>
            <figure className="history-panel">
              <figcaption className="load-legend">
                <span className="load-key key-fatigue">
                  <svg width="22" height="10" aria-hidden="true">
                    <line x1="1" x2="21" y1="5" y2="5" />
                  </svg>
                  Fatigue from training
                </span>
              </figcaption>
              <svg {...svgProps} height={FATIGUE_HEIGHT}>
                {[0, fatigueTop].map((tick) => (
                  <g key={tick}>
                    <line
                      className="grid"
                      x1={GUTTER}
                      x2={width - RIGHT}
                      y1={fatigueY(tick)}
                      y2={fatigueY(tick)}
                    />
                    <text
                      className="tick"
                      x={GUTTER - 8}
                      y={fatigueY(tick)}
                      dy="0.32em"
                      textAnchor="end"
                    >
                      {tick}
                    </text>
                  </g>
                ))}
                {cursor(FATIGUE_HEIGHT)}
                <path className="line-fatigue" d={fatiguePath} />
                {current?.fatigue != null && (
                  <circle
                    className="dot-fatigue"
                    cx={x(selected)}
                    cy={fatigueY(current.fatigue)}
                    r={4}
                  />
                )}
              </svg>
            </figure>

            <figure className="history-panel">
              <figcaption className="load-legend">
                <span>How you said you felt</span>
                <span className="rating-key" aria-hidden="true">
                  <span className="rating-key-cells">
                    {[1, 2, 3, 4, 5].map((value) => (
                      <i key={value} className={`tone-${value}`} />
                    ))}
                  </span>
                  <span>worse, normal, better</span>
                </span>
              </figcaption>
              <svg {...svgProps} height={STATES_HEIGHT + RATINGS_HEIGHT}>
                {cursor(STATES_HEIGHT + RATINGS_HEIGHT)}
                {(
                  [
                    ["Ill", "ill", illnessSpans(checkIns)],
                    ["Injured", "injured", injurySpans(checkIns)],
                  ] as const
                ).map(([title, kind, spans], lane) => {
                  const y = 2 + lane * (LANE + LANE_GAP);
                  return (
                    <g key={kind}>
                      <text
                        className="lane-title"
                        x={GUTTER - 8}
                        y={y + LANE / 2}
                        dy="0.34em"
                        textAnchor="end"
                      >
                        {title}
                      </text>
                      <line
                        className="lane-rule"
                        x1={GUTTER}
                        x2={width - RIGHT}
                        y1={y + LANE / 2}
                        y2={y + LANE / 2}
                      />
                      {spanLane(spans, y, kind)}
                    </g>
                  );
                })}
                {checkInItems.map((item, lane) => {
                  const y = STATES_HEIGHT + lane * (LANE + LANE_GAP);
                  return (
                    <g key={item}>
                      <text
                        className="lane-title"
                        x={GUTTER - 8}
                        y={y + LANE / 2}
                        dy="0.34em"
                        textAnchor="end"
                      >
                        {itemTitles[item]}
                      </text>
                      <line
                        className="lane-rule"
                        x1={GUTTER}
                        x2={width - RIGHT}
                        y1={y + LANE / 2}
                        y2={y + LANE / 2}
                      />
                      {days.map((entry, index) => {
                        const value = entry.checkIn?.ratings[item];
                        if (value == null) return null;
                        return (
                          <rect
                            key={entry.day}
                            className={`rating-cell tone-${value}${index === selected ? " selected" : ""}`}
                            x={x(index) - cell / 2}
                            y={y}
                            width={cell}
                            height={LANE}
                            rx={step > 8 ? 2 : 0}
                          />
                        );
                      })}
                    </g>
                  );
                })}
              </svg>
            </figure>
            <svg width={width} height={AXIS_HEIGHT} aria-hidden="true" className="load-axis">
              {ticksOf(days).map(({ index, label }) => (
                <text key={index} className="tick" x={x(index)} y={14} textAnchor="middle">
                  {label}
                </text>
              ))}
            </svg>
          </>
        )}
      </div>
      {current && <DayReadout day={current} />}
      <p className="lede history-caution">
        These sit side by side by day, so you can look for your own patterns. A pattern here does
        not show that one causes the other.
      </p>
    </div>
  );
}

function DayReadout({ day }: { day: HistoryDay }) {
  return (
    <div className="history-readout" aria-live="polite">
      <p className="day-title">{formatDay(day.day)}</p>
      <p className="lede">
        {day.fatigue === null
          ? "No training fatigue yet."
          : `Fatigue from training ${Math.round(day.fatigue)}.`}{" "}
        {day.checkIn ? summaryWords(day.checkIn).join(". ") + "." : "No check-in."}
      </p>
      <Link to="/check-in" search={{ day: day.day }} className="secondary link-button compact">
        {day.checkIn ? "Edit this day" : "Check in for this day"}
      </Link>
    </div>
  );
}
