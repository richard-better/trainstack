import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { encodePolyline } from "@trainstack/analysis";
import { readActivityFile } from "../hosted/apps/account/src/lib/activity-file.ts";
import {
  decodePolyline,
  mercator,
  metresBetween,
  nearestPoint,
  pointAtSecond,
  routeOf,
  routePath,
  storedRouteSegments,
} from "../hosted/apps/account/src/lib/route.ts";
import {
  MAGNITUDE_RAMP,
  PLAIN_ROUTE,
  UNMEASURED,
  bandOf,
  colouredRuns,
  gradeBands,
  magnitudeBands,
  routeMeasures,
} from "../hosted/apps/account/src/lib/route-colours.ts";
import {
  bucketedAcrossPauses,
  positionAt,
  secondAt,
  steppedSecond,
  traceOf,
} from "../hosted/apps/account/src/lib/series.ts";
import { distancesOf, elevationOf, gradesOf } from "../hosted/apps/account/src/lib/terrain.ts";
import { activityFile, trainingHistory, tracks } from "../scripts/dev-history.mjs";

const SAMPLE_RIDE = "apps/ride/RideKit/Sources/RideData/Resources/SampleRide.fit";
const history = trainingHistory({ today: new Date("2026-11-14T12:00:00Z") });

function decoded(activity) {
  const reading = readActivityFile(
    activityFile({ ...activity, track: activity.route ? tracks[activity.route]() : null }),
  );
  assert.equal(reading.kind, "decoded");
  return reading.activity;
}

const named = (prefix) => history.activities.find((activity) => activity.name.startsWith(prefix));

const record = (elapsedSeconds, latitude, longitude, extra = {}) => ({
  elapsedSeconds,
  latitude,
  longitude,
  ...extra,
});

test("an outdoor ride's route is one unbroken line through every recorded position, inside its bounds", () => {
  const ride = decoded(
    history.activities.find((a) => a.kind === "endurance" && !a.name.startsWith("Coffee")),
  );
  const route = routeOf(ride.records);
  assert.equal(route.points.length, ride.records.length);
  assert.equal(route.segments.length, 1);
  const [west, south, east, north] = route.bounds;
  assert.ok(west > 18.6 && east < 19.1 && south > 47.4 && north < 47.7, `${route.bounds}`);
  for (const point of route.points) {
    assert.ok(point.longitude >= west && point.longitude <= east);
    assert.ok(point.latitude >= south && point.latitude <= north);
  }
});

test("a cafe stop ends one line and starts another, so the pause is not drawn as a line", () => {
  const ride = decoded(named("Coffee ride"));
  const route = routeOf(ride.records);
  assert.equal(route.segments.length, 2);
  const [before, after] = route.segments;
  assert.equal(after[0].second - before.at(-1).second, 25 * 60 + 1);
  assert.equal(pointAtSecond(route, before.at(-1).second + 600), null, "no position mid-coffee");
});

test("positions lost to a GPS gap leave a hole in the route and no position on the map", () => {
  const run = decoded(named("Easy run, GPS lost"));
  const route = routeOf(run.records);
  assert.equal(route.segments.length, 2);
  assert.ok(route.points.every((point) => point.second < 900 || point.second >= 1040));
  assert.equal(pointAtSecond(route, 970), null);
  assert.equal(pointAtSecond(route, 899).second, 899);
  assert.equal(pointAtSecond(route, 1041).second, 1041);
});

test("a jump faster than 100 m/s breaks the line even when no record is missing", () => {
  const north = 47.5 + 500 / 111_000;
  const route = routeOf([
    record(0, 47.5, 19.04),
    record(1, 47.50005, 19.04),
    record(2, north, 19.04),
    record(3, north + 0.00005, 19.04),
  ]);
  assert.equal(route.segments.length, 2);
  assert.ok(metresBetween(route.points[1], route.points[2]) > 100);
});

test("the timer's pauses end a line and what was recorded during them is not drawn", () => {
  const records = Array.from({ length: 10 }, (_, second) =>
    record(second, 47.5 + second * 0.00005, 19.04),
  );
  const route = routeOf(records, [{ from: 3, to: 6 }]);
  assert.deepEqual(
    route.segments.map((segment) => segment.map((point) => point.second)),
    [
      [0, 1, 2, 3],
      [6, 7, 8, 9],
    ],
  );
});

test("indoor rides and files without usable positions have no route", async () => {
  assert.equal(routeOf(decoded(history.activities.find((a) => a.indoor)).records), null);
  const sample = readActivityFile(new Uint8Array(await readFile(SAMPLE_RIDE)));
  assert.equal(routeOf(sample.activity.records), null);
  assert.equal(routeOf([record(0, 0, 0), record(1, 0, 0), record(2, 47.5, 19.04)]), null);
});

test("the route thumbnail is a plain SVG path, one stroke per line, fitted to its box and thinned to its pixels", () => {
  const ride = decoded(named("Coffee ride"));
  const route = routeOf(ride.records);
  const path = routePath(route.segments, 64, 40, 2);
  assert.equal(path.match(/M/g).length, 2);
  const numbers = path.match(/-?\d+(\.\d+)?/g).map(Number);
  const xs = numbers.filter((_, index) => index % 2 === 0);
  const ys = numbers.filter((_, index) => index % 2 === 1);
  assert.ok(
    Math.min(...xs) >= 1.9 && Math.max(...xs) <= 62.1,
    `${Math.min(...xs)} ${Math.max(...xs)}`,
  );
  assert.ok(Math.min(...ys) >= 1.9 && Math.max(...ys) <= 38.1);
  assert.ok(
    xs.length < route.points.length / 10,
    `${xs.length} of ${route.points.length} points kept`,
  );
});

test("the chart cursor and the map share one position: chart to route and route to chart", () => {
  const run = decoded(named("Tempo run"));
  const trace = traceOf(run);
  const route = routeOf(run.records);
  const second = secondAt(trace, "distance", 3000);
  assert.ok(Math.abs(trace.distances[second] - 3000) < 5, `${trace.distances[second]}`);
  const onMap = pointAtSecond(route, second);
  assert.equal(onMap.second, second);

  const within = 16 / (512 * 2 ** 15);
  const near = mercator(onMap.latitude + 0.00002, onMap.longitude);
  const picked = nearestPoint(route, near.x, near.y, within);
  assert.ok(Math.abs(picked.second - second) <= 3, `${picked.second} vs ${second}`);
  assert.ok(Math.abs(positionAt(trace, "distance", picked.second) - 3000) < 15);
  assert.equal(nearestPoint(route, near.x + 0.01, near.y, within), null, "far from the route");
});

test("the elevation profile climbs and descends with a three metre threshold, and a flat file has none", () => {
  const profile = [100, 101, 102, 104, 103, 107, 110, 108, 106, 104, 105, 101].map(
    (altitude, index) => record(index, undefined, undefined, { altitudeMetres: altitude }),
  );
  const elevation = elevationOf(profile);
  assert.equal(elevation.ascent, 10);
  assert.equal(elevation.descent, 9);
  assert.equal(elevation.min, 100);
  assert.equal(elevation.max, 110);
  assert.equal(elevationOf(decoded(history.activities.find((a) => a.indoor)).records), null);
  const ride = traceOf(decoded(named("Coffee ride")));
  assert.ok(ride.elevation.ascent > 200, `${ride.elevation.ascent}`);
});

test("distances come from the file, or from its positions when it records none", () => {
  const positions = [record(0, 47.5, 19.04), record(1, 47.5009, 19.04), record(2, 47.5018, 19.04)];
  const distances = distancesOf(positions);
  assert.ok(Math.abs(distances[2] - 200) < 1, `${distances}`);
  assert.deepEqual(
    distancesOf([record(0), record(1, undefined, undefined, { distanceMetres: 5 }), record(2)]),
    [0, 5, 5],
  );
  assert.equal(distancesOf([record(0), record(1)]), null);
});

test("grade is rise over run across a hundred metres, and stays unknown on short stretches", () => {
  const distances = Array.from({ length: 101 }, (_, index) => index * 5);
  const altitudes = distances.map((distance) => 200 + distance * 0.05);
  const grades = gradesOf(distances, altitudes);
  assert.ok(
    grades.every((grade) => Math.abs(grade - 5) < 1e-9),
    `${grades}`,
  );
  assert.deepEqual(gradesOf([0, 10, 20], [1, 2, 3]), [null, null, null]);
});

test("route colours step through one hue for a magnitude and two hues around grey for grade", () => {
  const values = Array.from({ length: 1000 }, (_, index) => index);
  const bands = magnitudeBands(values);
  assert.deepEqual(
    bands.map((band) => band.color),
    MAGNITUDE_RAMP,
  );
  assert.equal(bands[0].from, null);
  assert.equal(bands.at(-1).to, null);
  assert.equal(bandOf(bands, 0).color, MAGNITUDE_RAMP[0]);
  assert.equal(bandOf(bands, 999).color, MAGNITUDE_RAMP.at(-1));
  assert.equal(bandOf(bands, null), null);
  assert.equal(bandOf(gradeBands(), 0).color, "#8e9096");
  assert.equal(bandOf(gradeBands(), 12).color, gradeBands().at(-1).color);
  assert.equal(bandOf(gradeBands(), -12).color, gradeBands()[0].color);
});

test("a coloured route changes colour where its measure does, and never joins across a gap", () => {
  const route = routeOf([
    record(0, 47.5, 19.04),
    record(1, 47.5001, 19.04),
    record(2, 47.5002, 19.04),
    record(3),
    record(64, 47.5003, 19.04),
    record(65, 47.5004, 19.04),
  ]);
  const bands = [
    { color: "low", from: null, to: 10 },
    { color: "high", from: 10, to: null },
  ];
  const runs = colouredRuns(route, [1, 1, 20, 20, 20, null], bands);
  assert.deepEqual(
    runs.map((run) => [run.color, run.coordinates.length]),
    [
      ["low", 3],
      ["high", 1 + 1],
      ["high", 2],
      [UNMEASURED, 2],
    ],
  );
  assert.deepEqual(
    runs[0].coordinates.at(-1),
    runs[1].coordinates[0],
    "no hole at a colour change",
  );
  assert.deepEqual(
    colouredRuns(route, null, []).map((run) => run.color),
    [PLAIN_ROUTE, PLAIN_ROUTE],
  );
});

test("a run colours its route by pace in minutes per kilometre, and by grade where it has altitude", () => {
  const run = decoded(named("Tempo run"));
  const trace = traceOf(run);
  const measures = routeMeasures(trace, trace.elevation, "pace_km");
  assert.deepEqual(
    measures.map((measure) => measure.label),
    ["Pace", "Heart rate", "Grade"],
  );
  const pace = measures[0];
  assert.equal(pace.unit, "/km");
  assert.match(pace.format(12), /^5:00$/);
});

test("charts break their lines at a pause instead of drawing across it", () => {
  const ride = decoded(named("Coffee ride"));
  const trace = traceOf(ride);
  const heartRate = trace.channels.find((channel) => channel.key === "heartRate");
  const buckets = bucketedAcrossPauses(trace.seconds, trace.seconds, heartRate.values, 600);
  const gaps = buckets.filter((bucket) => bucket.value === null);
  assert.equal(gaps.length, 1);
  const at = buckets.indexOf(gaps[0]);
  assert.ok(
    buckets[at + 1].at - buckets[at - 1].at > 25 * 60,
    "the next line starts after the stop",
  );
  const steady = bucketedAcrossPauses([0, 1, 2, 3], [0, 1, 2, 3], [1, 2, 3, 4], 10);
  assert.ok(steady.every((bucket) => bucket.value !== null));
});

test("the arrow keys step across a pause instead of sticking at its edge", () => {
  const trace = traceOf(decoded(named("Coffee ride")));
  const lastBefore = trace.seconds.findLast((second) => second < 4500);
  const firstAfter = trace.seconds.find((second) => second > lastBefore + 60);
  assert.equal(steppedSecond(trace, "time", lastBefore, 1), firstAfter);
  assert.equal(steppedSecond(trace, "time", firstAfter, -1), lastBefore);
  assert.equal(steppedSecond(trace, "time", null, 1), 0);
  assert.equal(steppedSecond(trace, "time", null, -1), trace.seconds.at(-1));
  assert.equal(steppedSecond(trace, "time", trace.seconds.at(-1), 1), trace.seconds.at(-1));
});

test("pointing anywhere on the drawn line picks the route, not only near its recorded points", () => {
  const route = routeOf([record(0, 47.5, 19.04), record(1, 47.5, 19.041), record(2, 47.5, 19.042)]);
  const between = mercator(47.5, 19.0404);
  const tight = 16 / (512 * 2 ** 20);
  assert.equal(nearestPoint(route, between.x, between.y, tight).second, 0);
  const later = mercator(47.5, 19.0407);
  assert.equal(nearestPoint(route, later.x, later.y, tight).second, 1);
  const gapped = routeOf([record(0, 47.5, 19.04), record(1), record(100, 47.5, 19.042)]);
  assert.equal(
    nearestPoint(gapped, mercator(47.5, 19.041).x, mercator(47.5, 19.041).y, tight),
    null,
  );
});

test("a stored route decodes from its polylines and draws in true proportion at any latitude", () => {
  const square = (latitude) => {
    const north = latitude + 1000 / 111_195;
    const east = 19 + 1000 / (111_195 * Math.cos((latitude * Math.PI) / 180));
    return [
      { latitude, longitude: 19 },
      { latitude: north, longitude: 19 },
      { latitude: north, longitude: east },
      { latitude, longitude: east },
    ];
  };
  for (const latitude of [0, 47.5, 70]) {
    const corners = square(latitude);
    const encoded = encodePolyline(corners);
    decodePolyline(encoded).forEach((point, index) => {
      assert.ok(Math.abs(point.latitude - corners[index].latitude) < 1e-5);
      assert.ok(Math.abs(point.longitude - corners[index].longitude) < 1e-5);
    });
    const path = routePath(
      storedRouteSegments({ segments: [encoded], bounds: [0, 0, 0, 0] }),
      100,
      100,
    );
    const numbers = path.match(/-?\d+(\.\d+)?/g).map(Number);
    const xs = numbers.filter((_, index) => index % 2 === 0);
    const ys = numbers.filter((_, index) => index % 2 === 1);
    const ratio = (Math.max(...xs) - Math.min(...xs)) / (Math.max(...ys) - Math.min(...ys));
    assert.ok(
      Math.abs(ratio - 1) < 0.03,
      `a square kilometre at ${latitude}° draws ${ratio} wide per tall`,
    );
  }
});

test("each stored segment is its own stroke, so a pause in a stored route is not bridged", () => {
  const first = encodePolyline([
    { latitude: 47.5, longitude: 19 },
    { latitude: 47.51, longitude: 19 },
  ]);
  const second = encodePolyline([
    { latitude: 47.52, longitude: 19.01 },
    { latitude: 47.53, longitude: 19.01 },
  ]);
  const path = routePath(
    storedRouteSegments({ segments: [first, second], bounds: [19, 47.5, 19.01, 47.53] }),
    72,
    44,
    5,
  );
  assert.equal(path.match(/M/g).length, 2);
});
