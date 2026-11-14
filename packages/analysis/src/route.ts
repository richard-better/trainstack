import type { Span } from "./sampling.ts";

export interface RouteColumns {
  readonly count: number;
  readonly elapsedSeconds: Float64Array;
  readonly latitude: Float64Array;
  readonly longitude: Float64Array;
}

export type RouteBounds = [west: number, south: number, east: number, north: number];

export interface Route {
  readonly segments: string[];
  readonly bounds: RouteBounds;
}

export const routeToleranceDegrees = 1e-4;
export const routeMaxPoints = 300;
export const routeGapSeconds = 60;
export const routeMaxSpeedMetresPerSecond = 100;

const metresPerDegree = 111_195;

type Point = { x: number; y: number; latitude: number; longitude: number };

const isPosition = (latitude: number, longitude: number) =>
  Number.isFinite(latitude) &&
  Number.isFinite(longitude) &&
  Math.abs(latitude) <= 90 &&
  Math.abs(longitude) <= 180 &&
  !(latitude === 0 && longitude === 0);

function timeOrder(elapsed: Float64Array, count: number): Uint32Array | null {
  let ordered = true;
  let previous = -Infinity;
  for (let index = 0; index < count && ordered; index++) {
    const seconds = elapsed[index]!;
    if (!Number.isFinite(seconds)) continue;
    if (seconds < previous) ordered = false;
    previous = seconds;
  }
  if (ordered) return null;
  const sortable = (index: number) => {
    const seconds = elapsed[index]!;
    return Number.isFinite(seconds) ? seconds : Infinity;
  };
  return Uint32Array.from({ length: count }, (_, index) => index).sort(
    (a, b) => sortable(a) - sortable(b) || a - b,
  );
}

function distanceSquared(point: Point, from: Point, to: Point) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = dx * dx + dy * dy;
  const along =
    length === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / length));
  const x = from.x + along * dx - point.x;
  const y = from.y + along * dy - point.y;
  return x * x + y * y;
}

function simplified(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const toleranceSquared = tolerance * tolerance;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let farthest = -1;
    let farthestDistance = toleranceSquared;
    for (let index = first + 1; index < last; index++) {
      const distance = distanceSquared(points[index]!, points[first]!, points[last]!);
      if (distance > farthestDistance) {
        farthest = index;
        farthestDistance = distance;
      }
    }
    if (farthest < 0) continue;
    keep[farthest] = 1;
    stack.push([first, farthest], [farthest, last]);
  }
  return points.filter((_, index) => keep[index] === 1);
}

function encodedNumber(value: number) {
  let rest = value < 0 ? ~(value << 1) : value << 1;
  let text = "";
  while (rest >= 0x20) {
    text += String.fromCharCode((0x20 | (rest & 0x1f)) + 63);
    rest >>>= 5;
  }
  return text + String.fromCharCode(rest + 63);
}

export function encodePolyline(points: readonly { latitude: number; longitude: number }[]) {
  let latitude = 0;
  let longitude = 0;
  let text = "";
  for (const point of points) {
    const nextLatitude = Math.round(point.latitude * 1e5);
    const nextLongitude = Math.round(point.longitude * 1e5);
    text += encodedNumber(nextLatitude - latitude) + encodedNumber(nextLongitude - longitude);
    latitude = nextLatitude;
    longitude = nextLongitude;
  }
  return text;
}

const emptyExtent = (): RouteBounds => [Infinity, Infinity, -Infinity, -Infinity];

function trackSegments(columns: RouteColumns, pauses: readonly Span[]) {
  const { elapsedSeconds: elapsed, latitude, longitude } = columns;
  const segments: Point[][] = [];
  let current: Point[] = [];
  let unkept: Point | undefined;
  let scale: number | undefined;
  let pause = 0;
  let extent = emptyExtent();
  const extents: RouteBounds[] = [];
  const close = () => {
    if (unkept && current.length >= 2) current.push(unkept);
    if (current.length >= 2) {
      segments.push(current);
      extents.push(extent);
    }
    current = [];
    unkept = undefined;
    extent = emptyExtent();
  };
  const order = timeOrder(elapsed, columns.count);
  let lastSeconds = NaN;
  let lastX = NaN;
  let lastY = NaN;
  let lastPause = 0;
  for (let position = 0; position < columns.count; position++) {
    const index = order ? order[position]! : position;
    const seconds = elapsed[index]!;
    const lat = latitude[index]!;
    const lon = longitude[index]!;
    if (!Number.isFinite(seconds) || !isPosition(lat, lon)) continue;
    while (pause < pauses.length && pauses[pause]!.to <= seconds) pause++;
    const within = pauses[pause];
    if (within && within.from < seconds && seconds < within.to) continue;
    scale ??= Math.cos((lat * Math.PI) / 180);
    const x = lon * scale;
    if (!Number.isNaN(lastSeconds)) {
      const gapSeconds = seconds - lastSeconds;
      const metres = Math.hypot(x - lastX, lat - lastY) * metresPerDegree;
      const jumped = metres > routeMaxSpeedMetresPerSecond * Math.max(gapSeconds, 1);
      if (pause !== lastPause || gapSeconds > routeGapSeconds || jumped) close();
    }
    if (lon < extent[0]) extent[0] = lon;
    if (lat < extent[1]) extent[1] = lat;
    if (lon > extent[2]) extent[2] = lon;
    if (lat > extent[3]) extent[3] = lat;
    const kept = current.at(-1);
    if (!kept || Math.hypot(x - kept.x, lat - kept.y) >= routeToleranceDegrees) {
      current.push({ x, y: lat, latitude: lat, longitude: lon });
      unkept = undefined;
    } else if (!unkept || unkept.latitude !== lat || unkept.longitude !== lon) {
      unkept = { x, y: lat, latitude: lat, longitude: lon };
    }
    lastSeconds = seconds;
    lastX = x;
    lastY = lat;
    lastPause = pause;
  }
  close();
  return { segments, extents };
}

function thinned(line: readonly Point[], tolerance: number): Point[] {
  const kept = [line[0]!];
  for (let index = 1; index < line.length - 1; index++) {
    const point = line[index]!;
    const last = kept.at(-1)!;
    if (Math.hypot(point.x - last.x, point.y - last.y) >= tolerance) kept.push(point);
  }
  kept.push(line.at(-1)!);
  return kept;
}

const thinningPoints = 50 * routeMaxPoints;

export function routeOf(columns: RouteColumns, pauses: readonly Span[] = []): Route | null {
  const { segments, extents } = trackSegments(columns, pauses);
  let keptExtents = extents;
  if (segments.length === 0) return null;
  let lines = segments;
  let thinning = routeToleranceDegrees;
  const count = () => lines.reduce((sum, line) => sum + line.length, 0);
  while (count() > thinningPoints && lines.some((line) => line.length > 2)) {
    thinning *= 2;
    lines = lines.map((line) => thinned(line, thinning));
  }
  let tolerance = routeToleranceDegrees;
  let kept = lines.map((line) => simplified(line, tolerance));
  const total = () => kept.reduce((sum, line) => sum + line.length, 0);
  while (total() > routeMaxPoints) {
    if (kept.some((line) => line.length > 2)) {
      tolerance *= 2;
      kept = kept.map((line) => simplified(line, tolerance));
      continue;
    }
    const span = (line: readonly Point[]) =>
      Math.hypot(line[1]!.x - line[0]!.x, line[1]!.y - line[0]!.y);
    const longest = kept
      .map((line, index) => ({ index, span: span(line) }))
      .sort((a, b) => b.span - a.span || a.index - b.index)
      .slice(0, Math.floor(routeMaxPoints / 2))
      .map(({ index }) => index)
      .sort((a, b) => a - b);
    kept = longest.map((index) => kept[index]!);
    keptExtents = longest.map((index) => keptExtents[index]!);
  }
  const bounds = keptExtents.reduce<RouteBounds>(
    (all, [west, south, east, north]) => [
      Math.min(all[0], west),
      Math.min(all[1], south),
      Math.max(all[2], east),
      Math.max(all[3], north),
    ],
    emptyExtent(),
  );
  return { segments: kept.map(encodePolyline), bounds };
}
