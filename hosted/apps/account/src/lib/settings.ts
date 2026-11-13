import type {
  SettingChange as WireChange,
  SettingEntry,
  SettingKey,
  SettingRemoval,
  SettingWrite,
} from "@trainstack/contract";
import {
  applyOrder,
  type DatedChange,
  isThresholdName,
  isZoneModelName,
  knownSports,
  paceDistanceMetres,
  profileOn,
  type SettingChange,
  type ThresholdName,
  thresholds,
  type ZoneMetric,
  type ZoneModelName,
  zoneCount,
  zoneModels,
} from "@trainstack/zones";

import type { ApiClient } from "./client.ts";
import { sportName } from "./sports.ts";

export type SettingsHistory = Awaited<ReturnType<ApiClient["settings"]["history"]>>;
export type SettingsAnswer = Awaited<ReturnType<ApiClient["settings"]["write"]>>;

export const settingsQueryKey = ["settings", "history"] as const;

export const localDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export function knownChange(change: WireChange): SettingChange | null {
  switch (change.kind) {
    case "threshold":
    case "threshold_test":
      return isThresholdName(change.threshold) ? { ...change, threshold: change.threshold } : null;
    case "zones":
      return isZoneModelName(change.model) && zoneModels[change.model].metric === change.metric
        ? { ...change, model: change.model }
        : null;
    default:
      return change;
  }
}

export const datedChanges = (entries: readonly SettingEntry[]): DatedChange[] =>
  entries.flatMap(({ day, change }) => {
    const known = knownChange(change);
    return known ? [{ day, change: known }] : [];
  });

export function keyOf(change: WireChange): SettingKey {
  switch (change.kind) {
    case "threshold":
      return { kind: "threshold", sport: change.sport, threshold: change.threshold };
    case "zones":
      return { kind: "zones", sport: change.sport, metric: change.metric };
    case "own_zones":
      return { kind: "own_zones", sport: change.sport, metric: change.metric };
    case "sport":
      return { kind: "sport", sport: change.sport };
    case "weight":
      return { kind: "weight" };
    case "threshold_test":
      return { kind: "threshold_test", id: change.id };
  }
}

function keyText(key: SettingKey) {
  switch (key.kind) {
    case "threshold":
      return JSON.stringify([key.kind, key.sport, key.threshold]);
    case "zones":
    case "own_zones":
      return JSON.stringify([key.kind, key.sport, key.metric]);
    case "sport":
      return JSON.stringify([key.kind, key.sport]);
    case "weight":
      return JSON.stringify([key.kind]);
    case "threshold_test":
      return JSON.stringify([key.kind, key.id]);
  }
}

export const slotOf = (day: string, key: SettingKey) => `${day} ${keyText(key)}`;

const slotOfWrite = (write: SettingWrite) =>
  slotOf(write.day, "remove" in write ? write.key : keyOf(write.change));

export const put = (day: string, change: SettingChange, now = new Date()): SettingWrite => ({
  day,
  change,
  updatedAt: now,
});

export const removal = (day: string, key: SettingKey, now = new Date()): SettingWrite => ({
  day,
  key,
  updatedAt: now,
  remove: true,
});

export function scopeSetUpOn(
  entries: readonly SettingEntry[],
  day: string,
  sport: string | null,
  metric: ZoneMetric,
  now = new Date(),
): SettingWrite[] {
  if (sport === null) return [];
  const before = profileOn(datedChanges(entries.filter((entry) => entry.day <= day)), day).sports[
    sport
  ];
  const writes: SettingWrite[] = [];
  if (!before) writes.push(put(day, { kind: "sport", sport, listed: true }, now));
  if (metric !== "pace" && before?.[metric] === undefined) {
    writes.push(put(day, { kind: "own_zones", sport, metric, own: true }, now));
  }
  return writes;
}

export function corrected(
  entry: SettingEntry,
  day: string,
  change: SettingChange,
  now = new Date(),
): SettingWrite[] {
  const moved = day !== entry.day || keyText(keyOf(change)) !== keyText(keyOf(entry.change));
  return moved
    ? [removal(entry.day, keyOf(entry.change), now), put(day, change, now)]
    : [put(day, change, now)];
}

const byDay = (a: { day: string }, b: { day: string }) =>
  a.day < b.day ? -1 : a.day > b.day ? 1 : 0;

export function withAnswer(history: SettingsHistory, answer: SettingsAnswer): SettingsHistory {
  const answered = new Set([
    ...answer.entries.map((entry) => slotOf(entry.day, keyOf(entry.change))),
    ...answer.removed.map((removed) => slotOf(removed.day, removed.key)),
  ]);
  const keep = <Item extends SettingEntry | SettingRemoval>(item: Item, key: SettingKey) =>
    !answered.has(slotOf(item.day, key));
  return {
    cursor: history.cursor,
    entries: [
      ...history.entries.filter((entry) => keep(entry, keyOf(entry.change))),
      ...answer.entries,
    ].toSorted(byDay),
    removed: [
      ...history.removed.filter((removed) => keep(removed, removed.key)),
      ...answer.removed,
    ],
  };
}

export type Overruled = { write: SettingWrite; kept: SettingEntry | null };

export function overruled(writes: readonly SettingWrite[], answer: SettingsAnswer): Overruled[] {
  const entries = new Map(
    answer.entries.map((entry) => [slotOf(entry.day, keyOf(entry.change)), entry]),
  );
  const removed = new Map(answer.removed.map((item) => [slotOf(item.day, item.key), item]));
  return writes.flatMap((write): Overruled[] => {
    const slot = slotOfWrite(write);
    const entry = entries.get(slot);
    if ("remove" in write) return entry === undefined ? [] : [{ write, kept: entry }];
    if (entry?.updatedAt.getTime() === write.updatedAt.getTime()) return [];
    if (!entry && !removed.has(slot)) return [];
    return [{ write, kept: entry ?? null }];
  });
}

export const addableSports = (listed: readonly string[]) =>
  Object.keys(knownSports).filter((sport) => !listed.includes(sport));

export const scopeLabel = (sport: string | null) =>
  sport === null ? "Default" : sportName(sport).label;

export const metricTitles: Record<ZoneMetric, string> = {
  heart_rate: "Heart rate",
  power: "Power",
  pace: "Pace",
};

export const metricNames: Record<ZoneMetric, string> = {
  heart_rate: "heart rate",
  power: "power",
  pace: "pace",
};

export function unitOf(metric: ZoneMetric, sport: string | null) {
  switch (metric) {
    case "heart_rate":
      return "bpm";
    case "power":
      return "W";
    case "pace":
      return paceDistanceMetres(sport ?? "") === 100 ? "/100 m" : "/km";
  }
}

export function formatValue(metric: ZoneMetric, value: number) {
  if (metric !== "pace") return String(value);
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

export const formatWithUnit = (metric: ZoneMetric, value: number, sport: string | null) =>
  `${formatValue(metric, value)} ${unitOf(metric, sport)}`;

export function parseValue(metric: ZoneMetric, text: string): number | null {
  const trimmed = text.trim();
  if (metric === "pace") {
    const match = /^(\d{1,2}):([0-5]\d)$/.exec(trimmed);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  }
  return /^\d{1,3}$/.test(trimmed) ? Number(trimmed) : null;
}

export function thresholdTitle(threshold: ThresholdName, sport: string | null) {
  if (threshold === "threshold_pace" && sport === "swimming") return "Critical swim speed";
  const titles: Record<ThresholdName, string> = {
    lactate_threshold_heart_rate: "Lactate threshold heart rate",
    max_heart_rate: "Max heart rate",
    resting_heart_rate: "Resting heart rate",
    aerobic_threshold_heart_rate: "Aerobic threshold heart rate",
    ftp: "FTP",
    aerobic_threshold_power: "Aerobic threshold power",
    threshold_pace: "Threshold pace",
  };
  return titles[threshold];
}

export const thresholdWord = (threshold: ThresholdName, sport: string | null) =>
  threshold === "threshold_pace" && sport === "swimming"
    ? "critical swim speed"
    : thresholds[threshold].name;

export function thresholdHelp(threshold: ThresholdName, sport: string | null) {
  const help: Record<ThresholdName, string> = {
    lactate_threshold_heart_rate:
      "Your average over the last 20 minutes of an all-out 30-minute effort",
    max_heart_rate: "The highest your heart rate reaches in an all-out effort",
    resting_heart_rate: "Measured lying down, just after you wake up",
    aerobic_threshold_heart_rate:
      "Your first lactate or ventilatory threshold (LT1 or VT1), usually from a lab test",
    ftp: "Functional threshold power: the power you could hold for about an hour",
    aerobic_threshold_power:
      "Your power at the first lactate or ventilatory threshold (LT1 or VT1)",
    threshold_pace:
      sport === "swimming"
        ? "Half the difference between your 400 m and 200 m times, per 100 m"
        : "The pace you could hold for about an hour",
  };
  return help[threshold];
}

export const thresholdsOf = (metric: ZoneMetric) =>
  (Object.keys(thresholds) as ThresholdName[]).filter(
    (threshold) => thresholds[threshold].metric === metric,
  );

export function thresholdRange(threshold: ThresholdName, sport: string | null) {
  const { metric, min, max } = thresholds[threshold];
  return `${formatValue(metric, min)} to ${formatWithUnit(metric, max, sport)}`;
}

export const modelTitle = (model: ZoneModelName) =>
  `${zoneModels[model].name}, ${zoneCount(model)} zones`;

export function listOfWords(words: readonly string[]) {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

const thresholdShort = (threshold: string, sport: string | null) =>
  isThresholdName(threshold)
    ? threshold === "threshold_pace" && sport === "swimming"
      ? "CSS"
      : thresholds[threshold].abbreviation
    : threshold.replaceAll("_", " ");

export function changeSummary(change: WireChange) {
  switch (change.kind) {
    case "threshold": {
      const name = thresholdShort(change.threshold, change.sport);
      const shown =
        change.value === null
          ? "cleared"
          : isThresholdName(change.threshold)
            ? formatWithUnit(thresholds[change.threshold].metric, change.value, change.sport)
            : String(change.value);
      return `${scopeLabel(change.sport)}: ${name} ${shown}`;
    }
    case "zones": {
      const model = isZoneModelName(change.model) ? modelTitle(change.model) : change.model;
      return change.customLimits
        ? `${scopeLabel(change.sport)}: custom ${metricNames[change.metric]} zones, based on ${model}`
        : `${scopeLabel(change.sport)}: ${metricNames[change.metric]} zones from ${model}`;
    }
    case "own_zones":
      return change.own
        ? `${scopeLabel(change.sport)}: own ${metricNames[change.metric]} zones`
        : `${scopeLabel(change.sport)}: uses Default ${metricNames[change.metric]} zones`;
    case "sport":
      return change.listed
        ? `Added ${scopeLabel(change.sport).toLowerCase()}`
        : `Removed ${scopeLabel(change.sport).toLowerCase()}`;
    case "weight":
      return `Weight ${formatWeight(change.kg)} kg`;
    case "threshold_test":
      return `${scopeLabel(change.sport)}: ${thresholdShort(change.threshold, change.sport)} test, ${change.value}`;
  }
}

export const formatWeight = (kg: number) => kg.toFixed(1).replace(/\.0$/, "");

export function parseWeight(text: string) {
  const trimmed = text.trim().replace(",", ".");
  if (!/^\d{2,3}(\.\d)?$/.test(trimmed)) return null;
  const kg = Number(trimmed);
  return kg >= 30 && kg <= 200 ? kg : null;
}

export function latestDayOf(
  entries: readonly SettingEntry[],
  matches: (change: WireChange) => boolean,
  onOrBefore: string,
) {
  return entries.findLast((entry) => entry.day <= onOrBefore && matches(entry.change))?.day ?? null;
}

const dayFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export const formatDay = (day: string) => dayFormat.format(new Date(`${day}T00:00:00Z`));

export type HistoryDay = { day: string; entries: SettingEntry[] };

const withinDay = (a: SettingEntry, b: SettingEntry) => {
  const known = (entry: SettingEntry) => knownChange(entry.change);
  const order = (entry: SettingEntry) => {
    const change = known(entry);
    return change ? applyOrder(change) : 9;
  };
  return order(a) - order(b) || changeSummary(a.change).localeCompare(changeSummary(b.change));
};

export function historyByDay(entries: readonly SettingEntry[]): HistoryDay[] {
  const days: HistoryDay[] = [];
  for (const entry of entries.toSorted((a, b) => byDay(b, a) || withinDay(a, b))) {
    const last = days.at(-1);
    if (last?.day === entry.day) last.entries.push(entry);
    else days.push({ day: entry.day, entries: [entry] });
  }
  return days;
}
