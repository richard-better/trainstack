import type { SettingChange as WireChange, SettingKey } from "@trainstack/contract";
import {
  areValidLimits,
  isThresholdName,
  isValidThresholdValue,
  isZoneModelName,
  type SettingChange,
  thresholds,
  zoneModels,
} from "@trainstack/zones";

export const ALLOWED_CLOCK_AHEAD_MS = 10 * 60 * 1000;

export type StoredKey = { kind: string; scope: string; name: string };

const EVERY_SPORT = "";

export function storedKey(key: SettingKey): StoredKey {
  switch (key.kind) {
    case "threshold":
      return { kind: key.kind, scope: key.sport ?? EVERY_SPORT, name: key.threshold };
    case "zones":
      return { kind: key.kind, scope: key.sport ?? EVERY_SPORT, name: key.metric };
    case "own_zones":
      return { kind: key.kind, scope: key.sport, name: key.metric };
    case "sport":
      return { kind: key.kind, scope: key.sport, name: "" };
    case "weight":
      return { kind: key.kind, scope: EVERY_SPORT, name: "" };
    case "threshold_test":
      return { kind: key.kind, scope: EVERY_SPORT, name: key.id };
  }
}

export function keyOf(stored: StoredKey): SettingKey {
  const sport = stored.scope === EVERY_SPORT ? null : stored.scope;
  switch (stored.kind) {
    case "threshold":
      return { kind: "threshold", sport, threshold: stored.name };
    case "zones":
      return { kind: "zones", sport, metric: stored.name as "heart_rate" | "power" | "pace" };
    case "own_zones":
      return {
        kind: "own_zones",
        sport: stored.scope,
        metric: stored.name as "heart_rate" | "power" | "pace",
      };
    case "sport":
      return { kind: "sport", sport: stored.scope };
    case "weight":
      return { kind: "weight" };
    case "threshold_test":
      return { kind: "threshold_test", id: stored.name };
  }
  throw new Error(`Unknown setting kind ${stored.kind}`);
}

export function canonical(change: SettingChange): SettingChange {
  switch (change.kind) {
    case "threshold":
      return {
        kind: change.kind,
        sport: change.sport,
        threshold: change.threshold,
        value: change.value,
      };
    case "zones":
      return {
        kind: change.kind,
        sport: change.sport,
        metric: change.metric,
        model: change.model,
        customLimits: change.customLimits,
      };
    case "own_zones":
      return { kind: change.kind, sport: change.sport, metric: change.metric, own: change.own };
    case "sport":
      return { kind: change.kind, sport: change.sport, listed: change.listed };
    case "weight":
      return { kind: change.kind, kg: change.kg };
    case "threshold_test":
      return {
        kind: change.kind,
        id: change.id,
        sport: change.sport,
        threshold: change.threshold,
        protocol: change.protocol,
        value: change.value,
        activityId: change.activityId,
      };
  }
}

export function validated(change: WireChange): SettingChange | string {
  switch (change.kind) {
    case "threshold": {
      const { threshold, value, sport } = change;
      if (!isThresholdName(threshold)) return `${threshold} is not a threshold`;
      if (value !== null && !isValidThresholdValue(threshold, value)) {
        const { min, max } = thresholds[threshold];
        return `${threshold} must be a whole number from ${min} to ${max}`;
      }
      if (sport === null && thresholds[threshold].metric === "pace") {
        return `${threshold} belongs to a sport`;
      }
      return { ...change, threshold };
    }
    case "zones": {
      const { model, metric, customLimits, sport } = change;
      if (!isZoneModelName(model)) return `${model} is not a zone model`;
      if (zoneModels[model].metric !== metric) return `${model} draws no ${metric} zones`;
      if (customLimits !== null && !areValidLimits(model, customLimits)) {
        return `${model} needs ${zoneModels[model].zoneNames.length - 1} limits, each leaving every zone room`;
      }
      if (sport === null && metric === "pace") return "pace zones belong to a sport";
      return { ...change, model };
    }
    case "own_zones":
      if (change.metric === "pace") return "pace zones always belong to their sport";
      return change;
    case "threshold_test": {
      const { threshold, value } = change;
      if (!isThresholdName(threshold)) return `${threshold} is not a threshold`;
      if (!isValidThresholdValue(threshold, value)) {
        const { min, max } = thresholds[threshold];
        return `${threshold} must be a whole number from ${min} to ${max}`;
      }
      return { ...change, threshold };
    }
    case "sport":
    case "weight":
      return change;
  }
}
