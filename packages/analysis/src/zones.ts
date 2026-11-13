import { type Zone, zoneContaining, type ZoneMetric, type ZoneSet } from "@trainstack/zones";

import { forEachHeldInterval, rounded, type Samples } from "./samples.ts";

export interface ZoneShare {
  readonly zone: Zone;
  readonly seconds: number;
  readonly fraction: number;
}

function zoneValues(
  samples: Samples,
  metric: ZoneMetric,
  paceDistanceMetres: number | undefined,
): Float64Array | null {
  switch (metric) {
    case "heart_rate":
      return samples.heartRate;
    case "power":
      return samples.power;
    case "pace":
      if (paceDistanceMetres === undefined) return null;
      return samples.speed.map((speed) => (speed > 0 ? rounded(paceDistanceMetres / speed) : NaN));
  }
}

export function timeInZones(
  samples: Samples,
  zones: ZoneSet,
  paceDistanceMetres?: number,
): ZoneShare[] {
  const values = zoneValues(samples, zones.metric, paceDistanceMetres);
  if (!values) return [];
  const seconds = zones.zones.map(() => 0);
  forEachHeldInterval(samples, (index, duration) => {
    const value = values[index]!;
    if (Number.isNaN(value)) return;
    seconds[zoneContaining(zones, value).index]! += duration;
  });
  const total = seconds.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return [];
  return zones.zones.map((zone) => ({
    zone,
    seconds: seconds[zone.index]!,
    fraction: seconds[zone.index]! / total,
  }));
}

export function combineZoneShares(activities: readonly (readonly ZoneShare[])[]): ZoneShare[] {
  const zones = new Map<string, Zone>();
  const seconds = new Map<string, number>();
  for (const shares of activities) {
    for (const share of shares) {
      const key = JSON.stringify([share.zone.label, share.zone.name]);
      if (!zones.has(key)) zones.set(key, share.zone);
      seconds.set(key, (seconds.get(key) ?? 0) + share.seconds);
    }
  }
  const total = [...seconds.values()].reduce((sum, value) => sum + value, 0);
  if (total <= 0) return [];
  return [...zones].map(([key, zone]) => ({
    zone,
    seconds: seconds.get(key)!,
    fraction: seconds.get(key)! / total,
  }));
}
