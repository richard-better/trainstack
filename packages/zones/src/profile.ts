import {
  type ThresholdName,
  type ThresholdValues,
  thresholds,
  type ZoneMetric,
} from "./metrics.ts";
import {
  basisThresholds,
  standardZoneModel,
  type ZoneModelName,
  type ZoneSet,
  zoneLimits,
  zoneSet,
} from "./models.ts";
import { defaultMetrics, sportMetrics, sportOrder } from "./sports.ts";

export type SettingChange =
  | { kind: "threshold"; sport: string | null; threshold: ThresholdName; value: number | null }
  | {
      kind: "zones";
      sport: string | null;
      metric: ZoneMetric;
      model: ZoneModelName;
      customLimits: number[] | null;
    }
  | { kind: "own_zones"; sport: string; metric: ZoneMetric; own: boolean }
  | { kind: "sport"; sport: string; listed: boolean }
  | { kind: "weight"; kg: number }
  | {
      kind: "threshold_test";
      id: string;
      sport: string | null;
      threshold: ThresholdName;
      protocol: string;
      value: number;
      activityId: string | null;
    };

export type DatedChange = { day: string; change: SettingChange };

export type MetricZones = {
  thresholds: ThresholdValues;
  model: ZoneModelName;
  customLimits: number[] | null;
};

export type Profile = {
  defaults: Partial<Record<ZoneMetric, MetricZones>>;
  sports: Record<string, Partial<Record<ZoneMetric, MetricZones>>>;
  weightKg: number | null;
};

export function emptyProfile(): Profile {
  const defaults: Profile["defaults"] = {};
  for (const metric of defaultMetrics) {
    const model = standardZoneModel(metric, null);
    if (model) defaults[metric] = { thresholds: {}, model, customLimits: null };
  }
  return { defaults, sports: {}, weightKg: null };
}

const copyZones = (zones: MetricZones): MetricZones => ({
  thresholds: { ...zones.thresholds },
  model: zones.model,
  customLimits: zones.customLimits && [...zones.customLimits],
});

function ownZones(profile: Profile, metric: ZoneMetric, sport: string | null) {
  return sport === null ? profile.defaults[metric] : profile.sports[sport]?.[metric];
}

function apply(profile: Profile, change: SettingChange) {
  switch (change.kind) {
    case "threshold": {
      const zones = ownZones(profile, thresholds[change.threshold].metric, change.sport);
      if (!zones) return;
      if (change.value === null) delete zones.thresholds[change.threshold];
      else zones.thresholds[change.threshold] = change.value;
      return;
    }
    case "zones": {
      const zones = ownZones(profile, change.metric, change.sport);
      if (!zones) return;
      zones.model = change.model;
      zones.customLimits = change.customLimits && [...change.customLimits];
      return;
    }
    case "own_zones": {
      const sport = profile.sports[change.sport];
      if (!sport || change.metric === "pace") return;
      if (!change.own) {
        delete sport[change.metric];
        return;
      }
      const defaults = profile.defaults[change.metric];
      if (!sport[change.metric] && defaults) sport[change.metric] = copyZones(defaults);
      return;
    }
    case "sport": {
      if (!change.listed) {
        delete profile.sports[change.sport];
        return;
      }
      if (profile.sports[change.sport]) return;
      const own: Partial<Record<ZoneMetric, MetricZones>> = {};
      const paceModel = standardZoneModel("pace", change.sport);
      if (sportMetrics(change.sport).includes("pace") && paceModel) {
        own.pace = { thresholds: {}, model: paceModel, customLimits: null };
      }
      profile.sports[change.sport] = own;
      return;
    }
    case "weight":
      profile.weightKg = change.kg;
      return;
    case "threshold_test":
      return;
  }
}

export function applyOrder(change: SettingChange) {
  switch (change.kind) {
    case "sport":
      return 0;
    case "weight":
    case "threshold_test":
      return 1;
    case "zones":
    case "threshold":
      return change.sport === null ? 1 : 3;
    case "own_zones":
      return 2;
  }
}

const sameProfile = (a: Profile, b: Profile) => JSON.stringify(a) === JSON.stringify(b);

function byDay(changes: readonly DatedChange[]) {
  const days = new Map<string, SettingChange[]>();
  for (const { day, change } of changes) {
    const list = days.get(day) ?? [];
    list.push(change);
    days.set(day, list);
  }
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, list]) => ({
      day,
      changes: list.toSorted((a, b) => applyOrder(a) - applyOrder(b)),
    }));
}

export function profileOn(changes: readonly DatedChange[], day: string | null): Profile {
  const profile = emptyProfile();
  let tookEffect = false;
  for (const entry of byDay(changes)) {
    if (day !== null && entry.day > day && tookEffect) break;
    const before = JSON.parse(JSON.stringify(profile)) as Profile;
    for (const change of entry.changes) apply(profile, change);
    tookEffect ||= !sameProfile(before, profile);
  }
  return profile;
}

export function listedSports(profile: Profile) {
  return Object.keys(profile.sports).toSorted(sportOrder);
}

export function metricSettings(
  profile: Profile,
  metric: ZoneMetric,
  sport: string | null,
): MetricZones | null {
  if (sport !== null) {
    const own = profile.sports[sport]?.[metric];
    if (own) return own;
  }
  return metric === "pace" ? null : (profile.defaults[metric] ?? null);
}

export function usesDefault(profile: Profile, metric: ZoneMetric, sport: string) {
  return metric !== "pace" && profile.sports[sport]?.[metric] === undefined;
}

export function zonesOf(settings: MetricZones): ZoneSet | null {
  const limits = settings.customLimits ?? zoneLimits(settings.model, settings.thresholds);
  return limits && zoneSet(settings.model, limits);
}

export function missingThresholds(settings: MetricZones): ThresholdName[] {
  if (settings.customLimits) return [];
  return basisThresholds(settings.model).filter(
    (threshold) => settings.thresholds[threshold] === undefined,
  );
}

export function zonesFor(profile: Profile, metric: ZoneMetric, sport: string | null) {
  const settings = metricSettings(profile, metric, sport);
  return settings && zonesOf(settings);
}

export function zoneMetricsFor(profile: Profile, sport: string | null): ZoneMetric[] {
  const own = sport === null ? [] : Object.keys(profile.sports[sport] ?? {});
  const metrics = new Set<string>([
    ...(sport === null ? defaultMetrics : sportMetrics(sport)),
    ...own,
  ]);
  return (["heart_rate", "power", "pace"] as const).filter((metric) => metrics.has(metric));
}
