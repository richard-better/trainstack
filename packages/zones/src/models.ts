import {
  isDescending,
  type ThresholdName,
  type ThresholdValues,
  type ZoneMetric,
} from "./metrics.ts";

export type Intensity = "easy" | "moderate" | "hard";

export type ZoneBasis =
  | { type: "percent_of"; threshold: ThresholdName }
  | { type: "heart_rate_reserve" }
  | { type: "measured"; thresholds: readonly ThresholdName[] };

export type ZoneModel = {
  metric: ZoneMetric;
  name: string;
  basis: ZoneBasis;
  zoneStartPercents: readonly number[];
  zoneNames: readonly string[];
  zoneLabels: readonly string[];
  intensities: readonly Intensity[];
};

const numbered = (count: number) => Array.from({ length: count }, (_, index) => String(index + 1));

const frielNames = [
  "Recovery",
  "Aerobic",
  "Tempo",
  "Subthreshold",
  "Superthreshold",
  "Aerobic capacity",
  "Anaerobic capacity",
];
const frielLabels = ["1", "2", "3", "4", "5a", "5b", "5c"];
const frielIntensities: Intensity[] = [
  "easy",
  "easy",
  "moderate",
  "moderate",
  "hard",
  "hard",
  "hard",
];
const fiveIntensities: Intensity[] = ["easy", "easy", "moderate", "moderate", "hard"];
const threeNames = ["Easy", "Moderate", "Hard"];
const threeIntensities: Intensity[] = ["easy", "moderate", "hard"];

export const zoneModels = {
  friel_cycling: {
    metric: "heart_rate",
    name: "Joe Friel for cycling",
    basis: { type: "percent_of", threshold: "lactate_threshold_heart_rate" },
    zoneStartPercents: [81, 90, 94, 100, 103, 107],
    zoneNames: frielNames,
    zoneLabels: frielLabels,
    intensities: frielIntensities,
  },
  friel_running: {
    metric: "heart_rate",
    name: "Joe Friel for running",
    basis: { type: "percent_of", threshold: "lactate_threshold_heart_rate" },
    zoneStartPercents: [85, 90, 95, 100, 103, 107],
    zoneNames: frielNames,
    zoneLabels: frielLabels,
    intensities: frielIntensities,
  },
  coggan_heart_rate: {
    metric: "heart_rate",
    name: "Andy Coggan",
    basis: { type: "percent_of", threshold: "lactate_threshold_heart_rate" },
    zoneStartPercents: [69, 84, 95, 106],
    zoneNames: ["Active recovery", "Endurance", "Tempo", "Threshold", "VO2 max"],
    zoneLabels: numbered(5),
    intensities: fiveIntensities,
  },
  percent_of_max: {
    metric: "heart_rate",
    name: "Percent of max",
    basis: { type: "percent_of", threshold: "max_heart_rate" },
    zoneStartPercents: [60, 70, 80, 90],
    zoneNames: ["Recovery", "Aerobic", "Tempo", "Threshold", "VO2 max"],
    zoneLabels: numbered(5),
    intensities: fiveIntensities,
  },
  karvonen: {
    metric: "heart_rate",
    name: "Karvonen",
    basis: { type: "heart_rate_reserve" },
    zoneStartPercents: [60, 70, 80, 90],
    zoneNames: ["Recovery", "Aerobic", "Tempo", "Threshold", "VO2 max"],
    zoneLabels: numbered(5),
    intensities: fiveIntensities,
  },
  seiler_heart_rate: {
    metric: "heart_rate",
    name: "Stephen Seiler",
    basis: {
      type: "measured",
      thresholds: ["aerobic_threshold_heart_rate", "lactate_threshold_heart_rate"],
    },
    zoneStartPercents: [],
    zoneNames: threeNames,
    zoneLabels: numbered(3),
    intensities: threeIntensities,
  },
  coggan_6: {
    metric: "power",
    name: "Andy Coggan",
    basis: { type: "percent_of", threshold: "ftp" },
    zoneStartPercents: [56, 76, 91, 106, 121],
    zoneNames: ["Active recovery", "Endurance", "Tempo", "Threshold", "VO2 max", "Anaerobic"],
    zoneLabels: numbered(6),
    intensities: ["easy", "easy", "moderate", "moderate", "hard", "hard"],
  },
  coggan_7: {
    metric: "power",
    name: "Andy Coggan",
    basis: { type: "percent_of", threshold: "ftp" },
    zoneStartPercents: [56, 76, 91, 106, 121, 151],
    zoneNames: [
      "Active recovery",
      "Endurance",
      "Tempo",
      "Threshold",
      "VO2 max",
      "Anaerobic",
      "Neuromuscular",
    ],
    zoneLabels: numbered(7),
    intensities: frielIntensities,
  },
  polarized: {
    metric: "power",
    name: "Polarized",
    basis: { type: "percent_of", threshold: "ftp" },
    zoneStartPercents: [76, 101],
    zoneNames: threeNames,
    zoneLabels: numbered(3),
    intensities: threeIntensities,
  },
  seiler_power: {
    metric: "power",
    name: "Stephen Seiler",
    basis: { type: "measured", thresholds: ["aerobic_threshold_power", "ftp"] },
    zoneStartPercents: [],
    zoneNames: threeNames,
    zoneLabels: numbered(3),
    intensities: threeIntensities,
  },
  friel_running_pace: {
    metric: "pace",
    name: "Joe Friel for running",
    basis: { type: "percent_of", threshold: "threshold_pace" },
    zoneStartPercents: [129, 113, 105, 100, 96, 90],
    zoneNames: frielNames,
    zoneLabels: frielLabels,
    intensities: frielIntensities,
  },
  critical_swim_speed: {
    metric: "pace",
    name: "Critical swim speed",
    basis: { type: "percent_of", threshold: "threshold_pace" },
    zoneStartPercents: [110, 105, 100, 95],
    zoneNames: ["Aerobic", "Endurance", "Threshold", "VO2 max", "Sprint"],
    zoneLabels: numbered(5),
    intensities: ["easy", "easy", "moderate", "hard", "hard"],
  },
} as const satisfies Record<string, ZoneModel>;

export type ZoneModelName = keyof typeof zoneModels;

export const isZoneModelName = (word: string): word is ZoneModelName =>
  Object.hasOwn(zoneModels, word);

export const zoneCount = (model: ZoneModelName) => zoneModels[model].zoneNames.length;

export function basisThresholds(model: ZoneModelName): readonly ThresholdName[] {
  const { basis } = zoneModels[model] as ZoneModel;
  switch (basis.type) {
    case "percent_of":
      return [basis.threshold];
    case "heart_rate_reserve":
      return ["max_heart_rate", "resting_heart_rate"];
    case "measured":
      return basis.thresholds;
  }
}

export type ZoneModelGroup = { title: string; models: ZoneModelName[] };

export function zoneModelGroups(metric: ZoneMetric, sport: string | null): ZoneModelGroup[] {
  switch (metric) {
    case "heart_rate":
      return [
        {
          title: "From lactate threshold",
          models: ["friel_cycling", "friel_running", "coggan_heart_rate"],
        },
        { title: "From max heart rate", models: ["percent_of_max"] },
        { title: "From max and resting heart rate", models: ["karvonen"] },
        { title: "From aerobic and lactate thresholds", models: ["seiler_heart_rate"] },
      ];
    case "power":
      return [
        { title: "From FTP", models: ["coggan_6", "coggan_7", "polarized"] },
        { title: "From aerobic threshold and FTP", models: ["seiler_power"] },
      ];
    case "pace":
      if (sport === "running") {
        return [{ title: "From threshold pace", models: ["friel_running_pace"] }];
      }
      if (sport === "swimming") {
        return [{ title: "From critical swim speed", models: ["critical_swim_speed"] }];
      }
      return [];
  }
}

export function standardZoneModel(metric: ZoneMetric, sport: string | null): ZoneModelName | null {
  switch (metric) {
    case "heart_rate":
      return "percent_of_max";
    case "power":
      return "coggan_6";
    case "pace":
      return zoneModelGroups("pace", sport)[0]?.models[0] ?? null;
  }
}

const percentOf = (percent: number, value: number) => Math.round((value * percent) / 100);

export function zoneLimits(model: ZoneModelName, values: ThresholdValues): number[] | null {
  const definition = zoneModels[model] as ZoneModel;
  const stepIntoNextZone = isDescending(definition.metric) ? -1 : 1;
  const { basis } = definition;
  let start: (percent: number) => number;
  switch (basis.type) {
    case "measured": {
      const starts = basis.thresholds.map((threshold) => values[threshold]);
      return starts.every((value) => value !== undefined)
        ? starts.map((value) => value - stepIntoNextZone)
        : null;
    }
    case "heart_rate_reserve": {
      const max = values.max_heart_rate;
      const resting = values.resting_heart_rate;
      if (max === undefined || resting === undefined) return null;
      start = (percent) => resting + percentOf(percent, max - resting);
      break;
    }
    case "percent_of": {
      const value = values[basis.threshold];
      if (value === undefined) return null;
      start = (percent) => percentOf(percent, value);
      break;
    }
  }
  return definition.zoneStartPercents.map((percent) => start(percent) - stepIntoNextZone);
}

export function areValidLimits(model: ZoneModelName, limits: readonly number[]) {
  if (limits.length !== zoneCount(model) - 1) return false;
  if (!limits.every(Number.isInteger)) return false;
  if (isDescending(zoneModels[model].metric)) {
    return limits.every((limit, index) => limit > (limits[index + 1] ?? 1));
  }
  return limits.every((limit, index) => limit > (index === 0 ? -1 : limits[index - 1]!));
}

export type Zone = {
  index: number;
  label: string;
  name: string;
  start: number | null;
  end: number | null;
  intensity: Intensity;
};

export type ZoneSet = {
  model: ZoneModelName;
  metric: ZoneMetric;
  descending: boolean;
  limits: number[];
  zones: Zone[];
};

export function zoneSet(model: ZoneModelName, limits: readonly number[]): ZoneSet | null {
  if (!areValidLimits(model, limits)) return null;
  const definition = zoneModels[model] as ZoneModel;
  const descending = isDescending(definition.metric);
  const step = descending ? -1 : 1;
  return {
    model,
    metric: definition.metric,
    descending,
    limits: [...limits],
    zones: definition.zoneNames.map((name, index) => ({
      index,
      label: definition.zoneLabels[index]!,
      name,
      start: index === 0 ? null : limits[index - 1]! + step,
      end: index < limits.length ? limits[index]! : null,
      intensity: definition.intensities[index]!,
    })),
  };
}

export function zoneContaining(set: ZoneSet, value: number): Zone {
  const containing = set.zones.findLast(
    (zone) => zone.start === null || (set.descending ? value <= zone.start : value >= zone.start),
  );
  return containing ?? set.zones[0]!;
}

export function limitsSettingZoneEnd(set: ZoneSet, index: number, limit: number): number[] | null {
  if (index < 0 || index >= set.limits.length) return null;
  const limits = set.limits.with(index, limit);
  return areValidLimits(set.model, limits) ? limits : null;
}
