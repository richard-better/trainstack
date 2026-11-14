import type { ActivityRecord } from "@trainstack/activity-file";

type Positioned = Pick<ActivityRecord, "elapsedSeconds" | "latitude" | "longitude">;

export interface RoutePoint {
  readonly record: number;
  readonly second: number;
  readonly latitude: number;
  readonly longitude: number;
  readonly x: number;
  readonly y: number;
}

export interface Route {
  readonly points: readonly RoutePoint[];
  readonly segments: readonly (readonly RoutePoint[])[];
  readonly bounds: readonly [west: number, south: number, east: number, north: number];
}

export const BREAK_AFTER_SECONDS = 60;
export const BREAK_AFTER_METRES = 250;
const EARTH_RADIUS_METRES = 6_371_008.8;
const MAX_MERCATOR_LATITUDE = 85.051129;

const radians = (degrees: number) => (degrees * Math.PI) / 180;

export function metresBetween(
  from: Pick<RoutePoint, "latitude" | "longitude">,
  to: Pick<RoutePoint, "latitude" | "longitude">,
) {
  const latitudeChange = radians(to.latitude - from.latitude);
  const longitudeChange = radians(to.longitude - from.longitude);
  const haversine =
    Math.sin(latitudeChange / 2) ** 2 +
    Math.cos(radians(from.latitude)) *
      Math.cos(radians(to.latitude)) *
      Math.sin(longitudeChange / 2) ** 2;
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

export function mercator(latitude: number, longitude: number) {
  const clamped = Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, latitude));
  const sine = Math.sin(radians(clamped));
  return {
    x: (longitude + 180) / 360,
    y: 0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI),
  };
}

const usable = (latitude: number | undefined, longitude: number | undefined) =>
  latitude !== undefined &&
  longitude !== undefined &&
  Number.isFinite(latitude) &&
  Number.isFinite(longitude) &&
  Math.abs(latitude) <= 90 &&
  Math.abs(longitude) <= 180 &&
  !(latitude === 0 && longitude === 0);

export function routeOf(records: readonly Positioned[]): Route | null {
  const points: RoutePoint[] = [];
  const segments: RoutePoint[][] = [];
  let current: RoutePoint[] = [];
  let lostPosition = false;
  records.forEach((record, index) => {
    const { latitude, longitude } = record;
    if (!usable(latitude, longitude)) {
      lostPosition = true;
      return;
    }
    const point = {
      record: index,
      second: record.elapsedSeconds,
      latitude: latitude!,
      longitude: longitude!,
      ...mercator(latitude!, longitude!),
    };
    const previous = current.at(-1);
    if (
      previous &&
      (lostPosition ||
        point.second - previous.second > BREAK_AFTER_SECONDS ||
        metresBetween(previous, point) > BREAK_AFTER_METRES)
    ) {
      segments.push(current);
      current = [];
    }
    lostPosition = false;
    current.push(point);
    points.push(point);
  });
  if (current.length > 0) segments.push(current);
  if (points.length < 2) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const point of points) {
    west = Math.min(west, point.longitude);
    east = Math.max(east, point.longitude);
    south = Math.min(south, point.latitude);
    north = Math.max(north, point.latitude);
  }
  return { points, segments, bounds: [west, south, east, north] };
}

export function pointAtSecond(route: Route, second: number): RoutePoint | null {
  const { points } = route;
  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (points[middle]!.second < second) low = middle + 1;
    else high = middle;
  }
  const after = points[low]!;
  const before = low > 0 ? points[low - 1]! : after;
  const nearest =
    Math.abs(before.second - second) <= Math.abs(after.second - second) ? before : after;
  return Math.abs(nearest.second - second) <= BREAK_AFTER_SECONDS / 2 ? nearest : null;
}

export function nearestPoint(
  route: Route,
  x: number,
  y: number,
  within: number,
): RoutePoint | null {
  let best: RoutePoint | null = null;
  let bestDistance = within * within;
  const consider = (from: RoutePoint, to: RoutePoint) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = dx * dx + dy * dy;
    const share =
      length === 0 ? 0 : Math.max(0, Math.min(1, ((x - from.x) * dx + (y - from.y) * dy) / length));
    const distance = (from.x + share * dx - x) ** 2 + (from.y + share * dy - y) ** 2;
    if (distance <= bestDistance) {
      best = share < 0.5 ? from : to;
      bestDistance = distance;
    }
  };
  for (const segment of route.segments) {
    if (segment.length === 1) consider(segment[0]!, segment[0]!);
    for (let index = 1; index < segment.length; index++) {
      consider(segment[index - 1]!, segment[index]!);
    }
  }
  return best;
}

export function routePath(route: Route, width: number, height: number, padding = 0) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of route.points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const scale = Math.min(
    spanX > 0 ? (width - 2 * padding) / spanX : Infinity,
    spanY > 0 ? (height - 2 * padding) / spanY : Infinity,
  );
  const fitted = Number.isFinite(scale) ? scale : 0;
  const offsetX = (width - spanX * fitted) / 2;
  const offsetY = (height - spanY * fitted) / 2;
  const at = (point: RoutePoint) =>
    [offsetX + (point.x - minX) * fitted, offsetY + (point.y - minY) * fitted] as const;
  return route.segments
    .map((segment) => {
      let path = "";
      let last: readonly [number, number] | null = null;
      segment.forEach((point, index) => {
        const [px, py] = at(point);
        const end = index === segment.length - 1;
        if (last && !end && Math.hypot(px - last[0], py - last[1]) < 1) return;
        path += `${last ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`;
        last = [px, py];
      });
      return segment.length === 1 ? `${path}h0` : path;
    })
    .join("");
}
