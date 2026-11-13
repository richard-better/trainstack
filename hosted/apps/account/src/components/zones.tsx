import type { Zone, ZoneMetric, ZoneSet } from "@trainstack/zones";

import { formatValue, unitOf } from "../lib/settings";
import type { ZoneShare } from "@trainstack/analysis";
import { formatDuration } from "../lib/statistics";

const RAMP_STEPS = 7;

export const zoneStep = (index: number, count: number) =>
  count <= 1 ? 0 : Math.round((index * (RAMP_STEPS - 1)) / (count - 1));

export function ZoneSwatch({ zone, count }: { zone: Zone; count: number }) {
  return (
    <span className={`zone-swatch zone-step-${zoneStep(zone.index, count)}`} aria-hidden="true" />
  );
}

export function zoneRange(set: ZoneSet, zone: Zone, metric: ZoneMetric, sport: string | null) {
  const unit = unitOf(metric, sport);
  const value = (number: number) => formatValue(metric, number);
  if (zone.start === null && zone.end !== null) {
    return set.descending
      ? `${value(zone.end)} ${unit} and slower`
      : `up to ${value(zone.end)} ${unit}`;
  }
  if (zone.end === null && zone.start !== null) {
    return set.descending
      ? `${value(zone.start)} ${unit} and faster`
      : `${value(zone.start)} ${unit} and up`;
  }
  return `${value(zone.start!)}-${value(zone.end!)} ${unit}`;
}

export function scaleRange(set: ZoneSet, thresholds: Record<string, number | undefined>) {
  const firstEnd = set.limits[0]!;
  const lastStart = set.zones.at(-1)?.start ?? firstEnd;
  switch (set.metric) {
    case "heart_rate": {
      const max = thresholds.max_heart_rate;
      return max !== undefined
        ? {
            easiest: Math.min(Math.floor(max / 2), firstEnd),
            hardest: Math.max(max, lastStart + 1),
          }
        : { easiest: Math.floor((firstEnd * 4) / 5), hardest: Math.ceil((lastStart * 11) / 10) };
    }
    case "power": {
      const ftp = thresholds.ftp;
      return {
        easiest: 0,
        hardest:
          ftp !== undefined
            ? Math.max(Math.round((ftp * 8) / 5), lastStart + 1)
            : Math.ceil((lastStart * 13) / 10),
      };
    }
    case "pace": {
      const pace = thresholds.threshold_pace;
      return pace !== undefined
        ? {
            easiest: Math.max(Math.round((pace * 7) / 5), firstEnd + 1),
            hardest: Math.min(Math.round((pace * 17) / 20), lastStart - 1),
          }
        : { easiest: Math.round((firstEnd * 11) / 10), hardest: Math.round((lastStart * 9) / 10) };
    }
  }
}

export function ZoneScale({
  set,
  thresholds,
  sport,
}: {
  set: ZoneSet;
  thresholds: Record<string, number | undefined>;
  sport: string | null;
}) {
  const range = scaleRange(set, thresholds);
  const sign = set.descending ? -1 : 1;
  const low = sign * range.easiest;
  const high = sign * range.hardest;
  const widthOf = (zone: Zone) => {
    const start = zone.start === null ? low : Math.max(sign * zone.start, low);
    const end = zone.end === null ? Math.max(high, start + 1) : sign * zone.end + 1;
    return Math.max(1, end - start);
  };
  const unit = unitOf(set.metric, sport);
  return (
    <div className="zone-scale" aria-hidden="true">
      <div className="zone-band">
        {set.zones.map((zone) => (
          <span
            key={zone.index}
            className={`zone-step-${zoneStep(zone.index, set.zones.length)}`}
            style={{ flexGrow: widthOf(zone) }}
          />
        ))}
      </div>
      <div className="zone-scale-ends">
        <span>
          {formatValue(set.metric, range.easiest)} {unit}
        </span>
        <span>
          {formatValue(set.metric, range.hardest)} {unit}
        </span>
      </div>
    </div>
  );
}

export function ZoneTimeRows({
  set,
  shares,
  sport,
}: {
  set: ZoneSet;
  shares: readonly ZoneShare[];
  sport: string | null;
}) {
  const longest = Math.max(...shares.map((share) => share.fraction));
  return (
    <table className="zone-time">
      <thead className="visually-hidden">
        <tr>
          <th scope="col">Zone</th>
          <th scope="col">Range</th>
          <th scope="col">Share of time</th>
          <th scope="col">Percent</th>
          <th scope="col">Time</th>
        </tr>
      </thead>
      <tbody>
        {shares.map(({ zone, seconds, fraction }) => {
          const range = zoneRange(set, zone, set.metric, sport);
          const percent = Math.round(fraction * 100);
          return (
            <tr
              key={zone.index}
              title={`Zone ${zone.label} ${zone.name}, ${range}: ${formatDuration(seconds)}, ${percent}%`}
            >
              <th scope="row">
                <ZoneSwatch zone={zone} count={set.zones.length} />
                <span className="zone-label">{zone.label}</span>
                <span className="zone-name">{zone.name}</span>
              </th>
              <td className="zone-range">{range}</td>
              <td className="zone-bar-cell" aria-hidden="true">
                <span
                  className={`zone-bar zone-step-${zoneStep(zone.index, set.zones.length)}`}
                  style={{ width: longest > 0 ? `${(fraction / longest) * 100}%` : 0 }}
                  data-empty={seconds === 0 || undefined}
                />
              </td>
              <td className="zone-percent">{percent}%</td>
              <td className="zone-seconds">{seconds > 0 ? formatDuration(seconds) : "-"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
