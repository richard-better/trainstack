import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  type MetricZones,
  limitsSettingZoneEnd,
  missingThresholds,
  type ThresholdValues,
  zoneContaining,
  zoneCount,
  zoneLimits,
  zoneMetrics,
  zoneModelGroups,
  type ZoneModelName,
  zoneModels,
  zonesOf,
  zoneSet,
} from "../src/index.ts";

const zones = (
  model: ZoneModelName,
  thresholds: ThresholdValues,
  customLimits: number[] | null = null,
): MetricZones => ({ thresholds, model, customLimits });

const set = (settings: MetricZones) => {
  const zoneSet = zonesOf(settings);
  assert.ok(zoneSet);
  return zoneSet;
};

describe("zone tables agree with Ride's ZoneTests", () => {
  test("calculates Friel cycling zones from lactate threshold", () => {
    const friel = set(zones("friel_cycling", { lactate_threshold_heart_rate: 170 }));
    assert.deepEqual(friel.limits, [137, 152, 159, 169, 174, 181]);
    assert.deepEqual(
      friel.zones.map((zone) => zone.label),
      ["1", "2", "3", "4", "5a", "5b", "5c"],
    );
    assert.equal(friel.zones[0]!.start, null);
    assert.equal(friel.zones.at(-1)!.start, 182);
    assert.equal(friel.zones.at(-1)!.end, null);
  });

  test("calculates Karvonen zones from heart rate reserve", () => {
    assert.deepEqual(
      set(zones("karvonen", { max_heart_rate: 190, resting_heart_rate: 50 })).limits,
      [133, 147, 161, 175],
    );
  });

  test("calculates Coggan power zones from FTP", () => {
    const coggan = set(zones("coggan_6", { ftp: 200 }));
    assert.deepEqual(coggan.limits, [111, 151, 181, 211, 241]);
    assert.equal(zoneContaining(coggan, 111).name, "Active recovery");
    assert.equal(zoneContaining(coggan, 112).name, "Endurance");
    assert.equal(zoneContaining(coggan, 1000).name, "Anaerobic");
  });

  test("splits Seiler zones at the measured thresholds", () => {
    const heartRate = set(
      zones("seiler_heart_rate", {
        aerobic_threshold_heart_rate: 142,
        lactate_threshold_heart_rate: 168,
      }),
    );
    assert.deepEqual(heartRate.limits, [141, 167]);
    assert.equal(zoneContaining(heartRate, 142).name, "Moderate");
    assert.equal(zoneContaining(heartRate, 168).name, "Hard");
    assert.deepEqual(
      set(zones("seiler_power", { aerobic_threshold_power: 190, ftp: 260 })).limits,
      [189, 259],
    );
  });

  test("needs both Seiler thresholds in order", () => {
    const missing = zones("seiler_heart_rate", { lactate_threshold_heart_rate: 168 });
    assert.equal(zonesOf(missing), null);
    assert.deepEqual(missingThresholds(missing), ["aerobic_threshold_heart_rate"]);
    const reversed = zones("seiler_heart_rate", {
      aerobic_threshold_heart_rate: 170,
      lactate_threshold_heart_rate: 168,
    });
    assert.equal(zonesOf(reversed), null);
    assert.deepEqual(missingThresholds(reversed), []);
  });

  test("calculates pace zones from slow to fast", () => {
    const fourMinutesPerKilometre = 240;
    const pace = set(zones("friel_running_pace", { threshold_pace: fourMinutesPerKilometre }));
    assert.deepEqual(pace.limits, [311, 272, 253, 241, 231, 217]);
    assert.equal(pace.zones[1]!.start, 310);
    assert.equal(zoneContaining(pace, 400).index, 0);
    assert.equal(zoneContaining(pace, 240).label, "5a");
    assert.equal(zoneContaining(pace, 200).label, "5c");
    assert.equal(limitsSettingZoneEnd(pace, 0, 272), null);
    assert.equal(limitsSettingZoneEnd(pace, 5, 1), null);
  });

  test("needs the thresholds of the chosen model", () => {
    const karvonen = zones("karvonen", { max_heart_rate: 190 });
    assert.equal(zonesOf(karvonen), null);
    assert.deepEqual(missingThresholds(karvonen), ["resting_heart_rate"]);
  });

  test("keeps custom limits without thresholds", () => {
    const custom = zones("percent_of_max", {}, [1, 2, 3, 4]);
    assert.deepEqual(set(custom).limits, [1, 2, 3, 4]);
    assert.deepEqual(missingThresholds(custom), []);
  });

  test("custom limits stay put when thresholds change", () => {
    const custom = zones("percent_of_max", { max_heart_rate: 180 }, [110, 130, 150, 170]);
    assert.deepEqual(set(custom).limits, [110, 130, 150, 170]);
  });

  test("moves the next zone with an edited limit", () => {
    const percent = set(zones("percent_of_max", { max_heart_rate: 200 }));
    assert.deepEqual(percent.limits, [119, 139, 159, 179]);
    assert.deepEqual(limitsSettingZoneEnd(percent, 1, 145), [119, 145, 159, 179]);
    assert.deepEqual(limitsSettingZoneEnd(percent, 3, 250), [119, 139, 159, 250]);
  });

  test("refuses a limit that empties a zone", () => {
    const percent = set(zones("percent_of_max", { max_heart_rate: 200 }));
    assert.equal(limitsSettingZoneEnd(percent, 1, 119), null);
    assert.equal(limitsSettingZoneEnd(percent, 1, 159), null);
    assert.equal(limitsSettingZoneEnd(percent, 0, -1), null);
    assert.equal(limitsSettingZoneEnd(percent, 4, 200), null);
  });

  test("every model has a label and ordered limit for each zone", () => {
    const thresholds: ThresholdValues = {
      lactate_threshold_heart_rate: 170,
      max_heart_rate: 190,
      resting_heart_rate: 50,
      ftp: 250,
      threshold_pace: 240,
      aerobic_threshold_heart_rate: 140,
      aerobic_threshold_power: 180,
    };
    for (const model of Object.keys(zoneModels) as ZoneModelName[]) {
      const definition = zoneModels[model];
      assert.equal(definition.zoneLabels.length, zoneCount(model));
      assert.equal(definition.intensities.length, zoneCount(model));
      const limits = zoneLimits(model, thresholds);
      assert.ok(limits, model);
      assert.equal(limits.length, zoneCount(model) - 1, model);
      assert.ok(zoneSet(model, limits), model);
    }
    const offered = new Set(
      zoneMetrics.flatMap((metric) =>
        [null, "running", "swimming"].flatMap((sport) =>
          zoneModelGroups(metric, sport)
            .flatMap((group) => group.models)
            .filter((model) => zoneModels[model].metric === metric),
        ),
      ),
    );
    assert.deepEqual(offered, new Set(Object.keys(zoneModels)));
  });

  test("rounds halves up as Swift's rounded() does", () => {
    assert.deepEqual(zoneLimits("coggan_6", { ftp: 250 }), [139, 189, 227, 264, 302]);
    assert.deepEqual(zoneLimits("percent_of_max", { max_heart_rate: 185 }), [110, 129, 147, 166]);
  });
});
