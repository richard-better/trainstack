import { useEffect, useMemo, useRef, useState } from "react";

import { type Route, pointAtSecond, routePath } from "../lib/route";
import { type MeasureOption, type RouteMeasure, bandOf, colouredRuns } from "../lib/route-colours";
import { formatDistance, formatDuration } from "../lib/statistics";
import { PeriodPicker } from "./period-picker";
import type { RouteMapHandle } from "./route-map-engine";

const PREVIEW_WIDTH = 1000;
const PREVIEW_HEIGHT = 400;

type MapState = "loading" | "ready" | "failed";

export function RouteSection({
  route,
  measures,
  distances,
  cursor,
  onCursor,
  title,
}: {
  route: Route;
  measures: readonly MeasureOption[];
  distances: readonly number[] | null;
  cursor: number | null;
  onCursor: (second: number | null) => void;
  title: string;
}) {
  const [measureKey, setMeasureKey] = useState<RouteMeasure | "none">("none");
  const measure = measures.find((option) => option.key === measureKey) ?? null;
  const runs = useMemo(
    () => colouredRuns(route, measure?.values ?? null, measure?.bands ?? []),
    [route, measure],
  );
  const point = cursor === null ? null : pointAtSecond(route, cursor);

  return (
    <section aria-labelledby="route">
      <div className="section-head">
        <h2 id="route" className="section-title">
          Route
        </h2>
        {measures.length > 0 && (
          <PeriodPicker
            label="Colour the route by"
            options={[
              { key: "none" as const, label: "Plain" },
              ...measures.map((option) => ({ key: option.key, label: option.label })),
            ]}
            value={measure ? measure.key : "none"}
            onChange={setMeasureKey}
          />
        )}
      </div>
      <RouteMap route={route} runs={runs} cursor={cursor} onCursor={onCursor} title={title} />
      <div className="route-foot">
        {measure ? <Legend measure={measure} route={route} /> : <EndsKey />}
        <p className="route-readout" aria-live="off">
          {point ? (
            <>
              {distances && (
                <>
                  <strong>{distanceText(distances[point.record] ?? 0)}</strong>{" "}
                </>
              )}
              <span className="muted">at</span> <strong>{formatDuration(point.second)}</strong>
              {measure && (
                <>
                  {" "}
                  <span className="muted">{measure.label.toLowerCase()}</span>{" "}
                  <strong>{valueText(measure, measure.values[point.record] ?? null)}</strong>
                </>
              )}
            </>
          ) : (
            <span className="muted">Point at the route or a chart to follow the activity.</span>
          )}
        </p>
      </div>
    </section>
  );
}

const distanceText = (metres: number) => {
  const { value, unit } = formatDistance(metres);
  return `${value} ${unit}`;
};

const valueText = (measure: MeasureOption, value: number | null) =>
  value === null
    ? "-"
    : `${measure.format(measure.key === "grade" ? Math.round(value) : value)} ${measure.unit}`;

function EndsKey() {
  return (
    <ul className="route-key" aria-label="Map key">
      <li>
        <span className="end-mark start" aria-hidden="true" />
        Start
      </li>
      <li>
        <span className="end-mark finish" aria-hidden="true" />
        Finish
      </li>
    </ul>
  );
}

function Legend({ measure, route }: { measure: MeasureOption; route: Route }) {
  const unmeasured = route.points.some(
    (point) => bandOf(measure.bands, measure.values[point.record] ?? null) === null,
  );
  const edges = measure.bands.slice(0, -1).map((band) => band.to!);
  return (
    <figure className="route-legend">
      <figcaption>
        {measure.label} <span className="muted">{measure.unit}</span>
      </figcaption>
      <div className="legend-scale">
        <div className="legend-bands" aria-hidden="true">
          {measure.bands.map((band) => (
            <span key={band.color} style={{ background: band.color }} />
          ))}
        </div>
        {edges.length > 0 && (
          <div className="legend-edges" aria-hidden="true">
            {edges.map((edge, index) => (
              <span key={index} style={{ left: `${((index + 1) / measure.bands.length) * 100}%` }}>
                {measure.format(edge)}
              </span>
            ))}
          </div>
        )}
        <ul className="visually-hidden">
          {measure.bands.map((band) => (
            <li key={band.color}>
              {band.from === null && band.to === null
                ? "All values"
                : band.from === null
                  ? `Below ${measure.format(band.to!)} ${measure.unit}`
                  : band.to === null
                    ? `${measure.format(band.from)} ${measure.unit} and above`
                    : `${measure.format(band.from)} to ${measure.format(band.to)} ${measure.unit}`}
            </li>
          ))}
        </ul>
      </div>
      {unmeasured && (
        <span className="legend-missing">
          <span className="legend-swatch" aria-hidden="true" />
          Not recorded
        </span>
      )}
    </figure>
  );
}

function RouteMap({
  route,
  runs,
  cursor,
  onCursor,
  title,
}: {
  route: Route;
  runs: ReturnType<typeof colouredRuns>;
  cursor: number | null;
  onCursor: (second: number | null) => void;
  title: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const handle = useRef<RouteMapHandle | null>(null);
  const latest = useRef({ runs, cursor, onCursor });
  latest.current = { runs, cursor, onCursor };
  const [state, setState] = useState<MapState>("loading");

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let cancelled = false;
    setState("loading");
    import("./route-map-engine")
      .then(({ mountRouteMap }) => {
        if (cancelled) return;
        handle.current = mountRouteMap(element, {
          route,
          runs: latest.current.runs,
          label: `Map of the route of ${title}`,
          onReady: () => {
            if (cancelled) return;
            handle.current?.showCursor(latest.current.cursor);
            setState("ready");
          },
          onCursor: (second) => latest.current.onCursor(second),
        });
      })
      .catch(() => {
        if (!cancelled) setState("failed");
      });
    return () => {
      cancelled = true;
      handle.current?.remove();
      handle.current = null;
    };
  }, [route, title]);

  useEffect(() => {
    handle.current?.showRuns(runs);
  }, [runs]);

  useEffect(() => {
    handle.current?.showCursor(cursor);
  }, [cursor]);

  return (
    <div className="route-map" data-state={state}>
      <svg
        className="route-preview"
        viewBox={`0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={state === "failed" ? `The shape of the route of ${title}` : undefined}
        aria-hidden={state === "failed" ? undefined : true}
      >
        <path d={routePath(route.segments, PREVIEW_WIDTH, PREVIEW_HEIGHT, 40)} />
      </svg>
      <div ref={container} className="route-canvas" />
      {state === "failed" && (
        <p className="route-failed" role="status">
          The map did not load, so this is the route's shape without streets.
        </p>
      )}
    </div>
  );
}
