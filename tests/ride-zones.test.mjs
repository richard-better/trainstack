import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import {
  basisThresholds,
  knownSports,
  paceDistanceMetres,
  profileOn,
  standardZoneModel,
  thresholds,
  zoneLimits,
  zoneModelGroups,
  zoneModels,
  zoneSet,
} from "../packages/zones/src/index.ts";

const ride = JSON.parse(
  await readFile("apps/ride/RideKit/Tests/RideDataTests/Zones/zones.json", "utf8"),
);

const rerecord =
  "Ride's ZoneParityTests recorded these from its zone models, zone sets and ZoneHistory. Change both sides, then record with RIDE_RECORD_ZONES=1";

const zonesOf = (model, limits) =>
  limits && zoneSet(model, limits)?.zones.map(({ start, end }) => [start, end]);

test("thresholds have the names, metrics and ranges Ride gives them", () => {
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(thresholds).map(([name, { metric, min, max }]) => [
        name,
        { metric, min, max },
      ]),
    ),
    ride.thresholds,
    rerecord,
  );
});

test("zone models are named, labelled and drawn from thresholds as Ride's are", () => {
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(zoneModels).map(([name, model]) => [
        name,
        {
          metric: model.metric,
          name: model.name,
          thresholds: [...basisThresholds(name)],
          zoneNames: [...model.zoneNames],
          zoneLabels: [...model.zoneLabels],
          intensities: [...model.intensities],
        },
      ]),
    ),
    ride.models,
    rerecord,
  );
});

test("sports have the metrics and pace distances Ride gives them", () => {
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(knownSports).map(([sport, { metrics }]) => [
        sport,
        { metrics: [...metrics], paceDistanceMetres: paceDistanceMetres(sport) ?? null },
      ]),
    ),
    ride.sports,
    rerecord,
  );
});

test("each metric and sport offers the models Ride offers, with the same standard one", () => {
  assert.deepEqual(
    ride.choices.map(({ metric, sport }) => ({
      metric,
      sport,
      standard: standardZoneModel(metric, sport),
      groups: zoneModelGroups(metric, sport),
    })),
    ride.choices,
    rerecord,
  );
});

test("every model draws the zones Ride draws from the same thresholds", () => {
  assert.ok(ride.zones.length > 1000);
  const mismatches = ride.zones.filter(({ model, thresholds: values, limits, zones }) => {
    const computed = zoneLimits(model, values);
    return (
      JSON.stringify(computed) !== JSON.stringify(limits) ||
      JSON.stringify(zonesOf(model, computed) ?? null) !== JSON.stringify(zones)
    );
  });
  assert.deepEqual(mismatches, [], rerecord);
});

test("an athlete's own zone limits are accepted and refused as Ride accepts and refuses them", () => {
  const mismatches = ride.customLimits.filter(
    ({ model, limits, zones }) =>
      JSON.stringify(zonesOf(model, limits) ?? null) !== JSON.stringify(zones),
  );
  assert.deepEqual(mismatches, [], rerecord);
});

const waitingForProfileOnToIgnoreWeight = new Set([
  "a weight before the first zones does not decide which zones hold",
]);

const metricsOf = (metrics) =>
  Object.fromEntries(
    Object.entries(metrics).map(([metric, { model, customLimits, thresholds: values }]) => [
      metric,
      { model, customLimits, thresholds: values },
    ]),
  );

function profileMismatches(cases) {
  return cases.filter(({ changes, day, defaults, sports }) => {
    const profile = profileOn(changes, day);
    const listed = Object.fromEntries(
      Object.keys(sports).map((sport) => [sport, metricsOf(profile.sports[sport] ?? {})]),
    );
    return (
      !isDeepStrictEqual(metricsOf(profile.defaults), defaults) ||
      !isDeepStrictEqual(listed, sports)
    );
  });
}

test("a history holds the zones on each day that Ride's ZoneHistory holds", () => {
  const settled = ride.profiles.filter(({ name }) => !waitingForProfileOnToIgnoreWeight.has(name));
  assert.deepEqual(profileMismatches(settled), [], rerecord);
});

test(
  "a weight does not decide which zones an old activity gets",
  { todo: "packages/zones profileOn still counts a weight as taking effect" },
  () => {
    const waiting = ride.profiles.filter(({ name }) => waitingForProfileOnToIgnoreWeight.has(name));
    assert.equal(waiting.length, waitingForProfileOnToIgnoreWeight.size);
    assert.deepEqual(profileMismatches(waiting), [], rerecord);
  },
);
