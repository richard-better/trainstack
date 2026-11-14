import {
  type GeoJSONSource,
  type IControl,
  FullscreenControl,
  Map as MapLibre,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

import { MAP_STYLE_URL } from "../lib/map-tiles";
import { type Route, mercator, nearestPoint, pointAtSecond } from "../lib/route";
import type { ColouredRun } from "../lib/route-colours";

setWorkerUrl(workerUrl);

const PICK_RADIUS_PIXELS = 16;
const WORLD_PIXELS_AT_ZOOM_ZERO = 512;
const FIT_PADDING = 40;
const LABEL_FONT = ["Noto Sans Regular"];

export interface RouteMapHandle {
  showRuns(runs: readonly ColouredRun[]): void;
  showCursor(second: number | null): void;
  remove(): void;
}

const empty = { type: "FeatureCollection" as const, features: [] };

const runFeatures = (runs: readonly ColouredRun[]) => ({
  type: "FeatureCollection" as const,
  features: runs.map((run) => ({
    type: "Feature" as const,
    properties: { color: run.color },
    geometry: { type: "LineString" as const, coordinates: run.coordinates.map((c) => [...c]) },
  })),
});

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

class FitRouteControl implements IControl {
  private element: HTMLDivElement | null = null;
  constructor(private readonly fit: () => void) {}
  onAdd() {
    const element = document.createElement("div");
    element.className = "maplibregl-ctrl maplibregl-ctrl-group";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "fit-route";
    button.title = "Fit the route";
    button.setAttribute("aria-label", "Fit the route");
    button.innerHTML =
      '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><circle cx="3.5" cy="12.5" r="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="12.5" cy="3.5" r="1.6" fill="currentColor"/><path d="M4.8 11.4c1.6-1.7 1-3.6 3-4.2s2.6-.4 3.6-2.1" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
    button.addEventListener("click", this.fit);
    element.append(button);
    this.element = element;
    return element;
  }
  onRemove() {
    this.element?.remove();
  }
}

export function mountRouteMap(
  container: HTMLElement,
  {
    route,
    runs,
    label,
    onReady,
    onCursor,
  }: {
    route: Route;
    runs: readonly ColouredRun[];
    label: string;
    onReady: () => void;
    onCursor: (second: number | null) => void;
  },
): RouteMapHandle {
  const [west, south, east, north] = route.bounds;
  const bounds = [
    [west, south],
    [east, north],
  ] as [[number, number], [number, number]];
  const map = new MapLibre({
    container,
    style: MAP_STYLE_URL,
    bounds,
    fitBoundsOptions: { padding: FIT_PADDING },
    cooperativeGestures: true,
    pitchWithRotate: false,
    maxPitch: 0,
    attributionControl: { compact: false },
  });
  map.getCanvas().setAttribute("aria-label", label);
  map.addControl(new NavigationControl({ visualizePitch: false }), "top-right");
  map.addControl(new FullscreenControl(), "top-right");
  map.addControl(
    new FitRouteControl(() =>
      map.fitBounds(bounds, { padding: FIT_PADDING, animate: !reducedMotion() }),
    ),
    "top-right",
  );
  map.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");

  let latestRuns = runs;
  let latestCursor: number | null = null;
  let loaded = false;

  const cursorData = (second: number | null) => {
    const point = second === null ? null : pointAtSecond(route, second);
    return point
      ? {
          type: "FeatureCollection" as const,
          features: [
            {
              type: "Feature" as const,
              properties: {},
              geometry: { type: "Point" as const, coordinates: [point.longitude, point.latitude] },
            },
          ],
        }
      : empty;
  };

  map.on("load", () => {
    const start = route.points[0]!;
    const finish = route.points.at(-1)!;
    map.addSource("route", { type: "geojson", data: runFeatures(latestRuns) });
    map.addSource("ends", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [
          { point: start, kind: "start", name: "Start" },
          { point: finish, kind: "finish", name: "Finish" },
        ].map(({ point, kind, name }) => ({
          type: "Feature",
          properties: { kind, name },
          geometry: { type: "Point", coordinates: [point.longitude, point.latitude] },
        })),
      },
    });
    map.addSource("cursor", { type: "geojson", data: cursorData(latestCursor) });
    const width = (thin: number, thick: number) =>
      ["interpolate", ["linear"], ["zoom"], 8, thin, 16, thick] as unknown as number;
    map.addLayer({
      id: "route-casing",
      type: "line",
      source: "route",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#0f1011", "line-width": width(5, 10), "line-opacity": 0.85 },
    });
    map.addLayer({
      id: "route-line",
      type: "line",
      source: "route",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": ["get", "color"], "line-width": width(2.5, 5.5) },
    });
    map.addLayer({
      id: "ends",
      type: "circle",
      source: "ends",
      paint: {
        "circle-radius": 6,
        "circle-color": ["match", ["get", "kind"], "start", "#0f1011", "#f2f2f3"],
        "circle-stroke-color": ["match", ["get", "kind"], "start", "#f2f2f3", "#0f1011"],
        "circle-stroke-width": ["match", ["get", "kind"], "start", 3, 2],
      },
    });
    map.addLayer({
      id: "end-labels",
      type: "symbol",
      source: "ends",
      layout: {
        "text-field": ["get", "name"],
        "text-font": LABEL_FONT,
        "text-size": 12,
        "text-anchor": ["match", ["get", "kind"], "start", "right", "left"],
        "text-offset": [
          "match",
          ["get", "kind"],
          "start",
          ["literal", [-1, 0]],
          ["literal", [1, 0]],
        ],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: { "text-color": "#ececee", "text-halo-color": "#0f1011", "text-halo-width": 1.5 },
    });
    map.addLayer({
      id: "cursor",
      type: "circle",
      source: "cursor",
      paint: {
        "circle-radius": 7,
        "circle-color": "#3987e5",
        "circle-stroke-color": "#f2f2f3",
        "circle-stroke-width": 2.5,
      },
    });
    loaded = true;
    onReady();
  });

  const pick = (lngLat: { lat: number; lng: number }) => {
    const { x, y } = mercator(lngLat.lat, lngLat.lng);
    const within = PICK_RADIUS_PIXELS / (WORLD_PIXELS_AT_ZOOM_ZERO * 2 ** map.getZoom());
    return nearestPoint(route, x, y, within);
  };
  map.on("mousemove", (event) => {
    const point = pick(event.lngLat);
    map.getCanvas().style.cursor = point ? "crosshair" : "";
    onCursor(point?.second ?? null);
  });
  map.on("mouseout", () => onCursor(null));
  map.on("click", (event) => {
    const point = pick(event.lngLat);
    if (point) onCursor(point.second);
  });

  return {
    showRuns(next) {
      latestRuns = next;
      if (loaded) (map.getSource("route") as GeoJSONSource).setData(runFeatures(next));
    },
    showCursor(second) {
      latestCursor = second;
      if (loaded) (map.getSource("cursor") as GeoJSONSource).setData(cursorData(second));
    },
    remove() {
      map.remove();
    },
  };
}
