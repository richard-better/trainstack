import {
  basisThresholds,
  metricSettings,
  missingThresholds,
  type Profile,
  profileOn,
  sportMetrics,
  type ZoneMetric,
  type ZoneSet,
  isZoneModelName,
  zonesOf,
} from "@trainstack/zones";
import type { ZoneSetOutput } from "@trainstack/contract";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { api } from "../api";

import {
  datedChanges,
  formatDay,
  formatWithUnit,
  listOfWords,
  metricNames,
  metricTitles,
  modelTitle,
  scopeLabel,
  thresholdTitle,
  thresholdWord,
} from "../lib/settings";
import type { DecodedActivity } from "@trainstack/activity-file";
import type { ActivityAnalysis, ZoneShare } from "@trainstack/analysis";

import { analysisOf, recordedMetrics, storedShares } from "../lib/activity-zones";
import type { Trace } from "../lib/series";
import { useSettingsHistory } from "./settings-data";
import { ZoneTimeRows } from "./zones";

export interface StoredZones {
  readonly statistics: Readonly<Record<string, number>>;
  readonly day: string;
}

const knownZoneSet = (set: ZoneSetOutput | undefined): ZoneSet | undefined =>
  set && isZoneModelName(set.model) ? { ...set, model: set.model } : undefined;

export function TimeInZones({
  activity,
  sport,
  day,
  trace,
  stored,
}: {
  activity: DecodedActivity;
  sport: string | null;
  day: string;
  trace: Trace;
  stored: StoredZones | null;
}) {
  const history = useSettingsHistory();
  const storedDay = stored?.day ?? day;
  const zonesOfDay = useQuery({
    queryKey: ["settings", "zones", storedDay, sport],
    queryFn: () => api.settings.zones({ day: storedDay, sport: sport ?? undefined }),
    enabled: stored !== null,
  });
  const profile = history.data && profileOn(datedChanges(history.data.entries), storedDay);
  const analysis = !stored && profile ? analysisOf(activity, sport, profile) : null;
  const scope = analysis ? analysis.sport : sport;
  const recorded = recordedMetrics(trace, scope);
  if (recorded.length === 0) return null;
  const sharesOf = (metric: ZoneMetric) => {
    if (!stored) return { shares: analysis?.timeInZones[metric] ?? [], set: undefined };
    const set = knownZoneSet(zonesOfDay.data?.zones[metric]);
    return { shares: set ? storedShares(stored.statistics, set) : [], set: set ?? null };
  };
  const loading = stored ? zonesOfDay.isPending : !analysis;

  return (
    <section aria-labelledby="time-in-zones">
      <h2 id="time-in-zones" className="section-title">
        Time in zones
      </h2>
      {history.isError || zonesOfDay.isError ? (
        <div className="note inline" role="status">
          <p className="lede">Your zones did not load.</p>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              void history.refetch();
              if (stored) void zonesOfDay.refetch();
            }}
          >
            Try again
          </button>
        </div>
      ) : !profile || loading ? (
        <div className="traces-loading short" aria-busy="true" aria-label="Loading zones" />
      ) : (
        <>
          <p className="lede zones-day">
            Using the settings that held on {formatDay(storedDay)}.
            {analysis && loadSentence(analysis)}
          </p>
          <div className="zone-metrics">
            {recorded.map((metric) => (
              <MetricZones
                key={metric}
                metric={metric}
                scope={scope}
                {...sharesOf(metric)}
                profile={profile}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function loadSentence(analysis: ActivityAnalysis) {
  const parts = [
    analysis.normalizedPowerWatts === null
      ? null
      : `normalized power ${Math.round(analysis.normalizedPowerWatts)} W`,
    analysis.load === null
      ? null
      : `stress score ${Math.round(analysis.load.stressScore)}, from ${metricNames[analysis.load.source]}`,
  ].filter((part) => part !== null);
  if (parts.length === 0) return "";
  const text = listOfWords(parts);
  return ` ${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

function MetricZones({
  metric,
  scope,
  shares,
  set,
  profile,
}: {
  metric: ZoneMetric;
  scope: string | null;
  shares: readonly ZoneShare[];
  set: ZoneSet | null | undefined;
  profile: Profile;
}) {
  const settings = metricSettings(profile, metric, scope);
  const zones = set === undefined ? settings && zonesOf(settings) : set;
  const listedHere = scope !== null && profile.sports[scope] !== undefined;
  const link =
    listedHere && (metric === "pace" || profile.sports[scope]?.[metric])
      ? { sport: scope, metric }
      : metric === "pace"
        ? {}
        : { metric };

  if (!settings || !zones) {
    const missing = settings ? missingThresholds(settings) : [];
    const prompt = !settings
      ? scope !== null && sportMetrics(scope).includes("pace")
        ? `Add ${scopeLabel(scope).toLowerCase()} in Settings and set your ${thresholdWord("threshold_pace", scope)} to see ${metricNames[metric]} zones.`
        : `Set up ${metricNames[metric]} zones in Settings to see time in them.`
      : missing.length > 0
        ? `Set your ${listOfWords(missing.map((name) => thresholdWord(name, scope)))} to see time in ${metricNames[metric]} zones.`
        : `Your ${metricNames[metric]} thresholds leave no room for every zone. Check them in Settings.`;
    return (
      <div className="zone-metric">
        <h3 className="group-title">{metricTitles[metric]}</h3>
        <div className="zone-prompt">
          <p className="lede">{prompt}</p>
          <Link to="/settings" search={link} className="secondary link-button compact">
            {missing.length > 0 ? "Set thresholds" : "Open settings"}
          </Link>
        </div>
      </div>
    );
  }

  const basis = settings.customLimits
    ? `Your own zones, based on ${modelTitle(settings.model)}`
    : basisThresholds(settings.model)
        .map((name) => {
          const value = settings.thresholds[name];
          return value === undefined
            ? null
            : `${thresholdTitle(name, scope)} ${formatWithUnit(metric, value, scope)}`;
        })
        .filter((text) => text !== null)
        .join(", ");

  return (
    <div className="zone-metric">
      <div className="zone-metric-head">
        <h3 className="group-title">{metricTitles[metric]}</h3>
        <p className="setting-help">
          {basis}.{" "}
          <Link to="/settings" search={link}>
            Edit zones
          </Link>
        </p>
      </div>
      {shares.length > 0 ? (
        <ZoneTimeRows set={zones} shares={shares} sport={scope} />
      ) : (
        <p className="lede">This activity has too little {metricNames[metric]} data for zones.</p>
      )}
    </div>
  );
}
