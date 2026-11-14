import assert from "node:assert/strict";
import { test } from "node:test";

import { encodePolyline, routeMaxPoints, routeOf, type RouteColumns } from "../src/index.ts";
import { measured } from "./measure.ts";

function decodePolyline(text: string) {
  const points: [number, number][] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = text.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < text.length) {
    latitude += next();
    longitude += next();
    points.push([latitude / 1e5, longitude / 1e5]);
  }
  return points;
}

function track(points: { seconds: number; latitude: number; longitude: number }[]): RouteColumns {
  return {
    count: points.length,
    elapsedSeconds: Float64Array.from(points, (point) => point.seconds),
    latitude: Float64Array.from(points, (point) => point.latitude),
    longitude: Float64Array.from(points, (point) => point.longitude),
  };
}

const eastward = (from: number, seconds: number, start = 0, latitude = 47.5) =>
  Array.from({ length: seconds }, (_, second) => ({
    seconds: start + second,
    latitude,
    longitude: from + second * 0.0001,
  }));

test("encodes polylines as Google's documented example", () => {
  assert.equal(
    encodePolyline([
      { latitude: 38.5, longitude: -120.2 },
      { latitude: 40.7, longitude: -120.95 },
      { latitude: 43.252, longitude: -126.453 },
    ]),
    "_p~iF~ps|U_ulLnnqC_mqNvxq`@",
  );
});

test("a straight ride simplifies to its two ends, and the bounds cover it", () => {
  const route = routeOf(track(eastward(19, 600)));
  assert.ok(route);
  assert.equal(route.segments.length, 1);
  assert.deepEqual(decodePolyline(route.segments[0]!), [
    [47.5, 19],
    [47.5, 19.0599],
  ]);
  assert.deepEqual(route.bounds, [19, 47.5, 19 + 599 * 0.0001, 47.5]);
});

test("a pause splits the route, and what was recorded while paused is left out", () => {
  const before = eastward(19, 300);
  const paused = Array.from({ length: 100 }, (_, second) => ({
    seconds: 300 + second,
    latitude: 48,
    longitude: 20,
  }));
  const after = eastward(19.1, 300, 400);
  const route = routeOf(track([...before, ...paused, ...after]), [{ from: 299.5, to: 400 }]);
  assert.equal(route?.segments.length, 2);
  const ends = route.segments.map((segment) => decodePolyline(segment));
  assert.deepEqual(ends[0]!.at(-1), [47.5, 19.0299]);
  assert.deepEqual(ends[1]![0], [47.5, 19.1]);
  assert.equal(route.bounds[3], 47.5, "nothing recorded while paused reaches the bounds");
});

test("a GPS gap or a jump splits the route instead of drawing a line across the map", () => {
  const gap = routeOf(track([...eastward(19, 120), ...eastward(19.5, 120, 400)]));
  assert.equal(gap?.segments.length, 2);
  const jump = routeOf(track([...eastward(19, 120), ...eastward(25, 120, 120)]));
  assert.equal(jump?.segments.length, 2);
});

test("a track without positions, or standing still, has no route", () => {
  const nowhere = track(
    Array.from({ length: 100 }, (_, second) => ({
      seconds: second,
      latitude: NaN,
      longitude: NaN,
    })),
  );
  assert.equal(routeOf(nowhere), null);
  const nullIsland = track(
    Array.from({ length: 100 }, (_, second) => ({ seconds: second, latitude: 0, longitude: 0 })),
  );
  assert.equal(routeOf(nullIsland), null);
  const standing = track(
    Array.from({ length: 100 }, (_, second) => ({
      seconds: second,
      latitude: 47.5,
      longitude: 19,
    })),
  );
  assert.equal(routeOf(standing), null);
});

test("a million winding points stay inside the cap, quickly", () => {
  const count = 1_000_000;
  const columns = track([]);
  const elapsed = new Float64Array(count);
  const latitude = new Float64Array(count);
  const longitude = new Float64Array(count);
  for (let index = 0; index < count; index++) {
    const turn = index / 20_000;
    elapsed[index] = index;
    latitude[index] = 47.5 + 0.02 * Math.sin(turn) + index * 1e-7;
    longitude[index] = 19 + 0.02 * Math.cos(turn) + index * 1e-7;
  }
  const { result: route, cpuMilliseconds: milliseconds } = measured(() =>
    routeOf({ ...columns, count, elapsedSeconds: elapsed, latitude, longitude }),
  );
  assert.ok(route);
  const points = route.segments.reduce((sum, segment) => sum + decodePolyline(segment).length, 0);
  assert.ok(points <= routeMaxPoints, `${points} points`);
  assert.ok(points > routeMaxPoints / 4, `${points} points`);
  const bytes = route.segments.reduce((sum, segment) => sum + segment.length, 0);
  assert.ok(bytes < 3000, `${bytes} bytes`);
  assert.ok(milliseconds < 1000, `${milliseconds} ms of CPU`);
});

test("many short pieces still stay inside the cap", () => {
  const pieces = Array.from({ length: 400 }, (_, piece) =>
    eastward(19 + piece * 0.01, 10, piece * 100),
  ).flat();
  const route = routeOf(track(pieces));
  assert.ok(route);
  const points = route.segments.reduce((sum, segment) => sum + decodePolyline(segment).length, 0);
  assert.ok(points <= routeMaxPoints, `${points} points`);
});

test("a track too tangled to draw in the cap still fits it, quickly", () => {
  const count = 1_000_000;
  const elapsed = new Float64Array(count);
  const latitude = new Float64Array(count);
  const longitude = new Float64Array(count);
  for (let index = 0; index < count; index++) {
    elapsed[index] = index;
    latitude[index] = 47.5 + 0.02 * Math.sin(index / 500) + index * 1e-7;
    longitude[index] = 19 + 0.02 * Math.cos(index / 500) + index * 1e-7;
  }
  const { result: route, cpuMilliseconds: milliseconds } = measured(() =>
    routeOf({ count, elapsedSeconds: elapsed, latitude, longitude }),
  );
  const points = route!.segments.reduce((sum, segment) => sum + decodePolyline(segment).length, 0);
  assert.ok(points <= routeMaxPoints, `${points} points`);
  assert.ok(milliseconds < 1000, `${milliseconds} ms of CPU`);
});

test("thousands of two-point pieces end inside the cap, keeping the longest", () => {
  const pieces = Array.from({ length: 10_000 }, (_, piece) => [
    { seconds: piece * 100, latitude: 47.5, longitude: 19 + piece * 0.001 },
    {
      seconds: piece * 100 + 1,
      latitude: 47.5,
      longitude: 19 + piece * 0.001 + (piece === 7 ? 0.0009 : 0.0002),
    },
  ]).flat();
  const { result: route, cpuMilliseconds: milliseconds } = measured(() => routeOf(track(pieces)));
  assert.ok(milliseconds < 1000, `${milliseconds} ms of CPU`);
  assert.equal(route!.segments.length, routeMaxPoints / 2);
  assert.ok(
    route!.segments.some(
      (segment) => JSON.stringify(decodePolyline(segment)) === "[[47.5,19.007],[47.5,19.0079]]",
    ),
  );
});

test("the bounds cover the route drawn, not a stray position left out of it", () => {
  const stray = { seconds: 300, latitude: -40, longitude: -100 };
  const route = routeOf(track([...eastward(19, 30), stray, ...eastward(19, 30, 301)]));
  assert.deepEqual(route?.bounds, [19, 47.5, 19 + 29 * 0.0001, 47.5]);
});

test("a piece dropped to fit the cap leaves the bounds too", () => {
  const near = Array.from({ length: 150 }, (_, piece) => [
    { seconds: piece * 100, latitude: 47.5, longitude: 19 + piece * 0.001 },
    { seconds: piece * 100 + 1, latitude: 47.5, longitude: 19 + piece * 0.001 + 0.0005 },
  ]).flat();
  const far = [
    { seconds: 20_000, latitude: -40, longitude: -100 },
    { seconds: 20_001, latitude: -40, longitude: -100.0002 },
  ];
  const route = routeOf(track([...near, ...far]));
  assert.equal(route!.segments.length, 150);
  assert.ok(route!.bounds[0] >= 19 && route!.bounds[1] === 47.5, `${route!.bounds}`);
});

test("an unreadable time between two readable ones does not hide records out of order", () => {
  const route = routeOf({
    count: 4,
    elapsedSeconds: Float64Array.from([2, NaN, 0, 1]),
    latitude: Float64Array.from([47.5, 47.5, 47.5, 47.5]),
    longitude: Float64Array.from([19.0004, 19.1, 19, 19.0002]),
  });
  assert.deepEqual(decodePolyline(route!.segments[0]!), [
    [47.5, 19],
    [47.5, 19.0004],
  ]);
});
