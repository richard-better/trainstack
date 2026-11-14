import type { ActivityDetail, BestEffort, BestPower } from "@trainstack/contract";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { api } from "../api";
import {
  activityBestEfforts,
  activityPowerCurve,
  bestEffortDistances,
  durationLabel,
} from "../lib/analysis";
import { formatDay, localDay } from "../lib/settings";
import { sportName } from "../lib/sports";
import { formatDuration, formatPace } from "../lib/statistics";
import { type BestsPeriodKey, bestsPeriod, bestsPeriodKeys, bestsQueryKey } from "../lib/training";
import { membersOf } from "../lib/workouts";
import { PeriodPicker } from "./period-picker";
import { PowerCurve } from "./power-curve";

export function useBests(from: string, sport: string | null, enabled = true) {
  return useQuery({
    queryKey: bestsQueryKey(from, sport),
    queryFn: () => api.training.bests({ from, sport: sport ?? undefined }),
    enabled,
  });
}

export function ActivityBests({
  activity,
  sport,
}: {
  activity: ActivityDetail;
  sport: string | null;
}) {
  const [periodKey, setPeriodKey] = useState<BestsPeriodKey>("all");
  const curve = activityPowerCurve(activity.statistics);
  const efforts = activityBestEfforts(activity.statistics);
  const today = localDay(new Date());
  const period = bestsPeriod(periodKey, today);
  const bests = useBests(period.from, sport, curve.length > 0 || efforts.length > 0);
  if (curve.length === 0 && efforts.length === 0) return null;

  const own = new Set(membersOf(activity));
  const noun = sportName(sport).noun;
  const thisLabel = `This ${noun}`;
  const bestLabel = `Your best, ${period.description}`;

  return (
    <section aria-labelledby="bests">
      <div className="section-head">
        <h2 id="bests" className="section-title">
          Bests
        </h2>
        <PeriodPicker
          label="Compare with your bests from"
          options={bestsPeriodKeys.map((key) => bestsPeriod(key, today))}
          value={periodKey}
          onChange={setPeriodKey}
        />
      </div>
      {bests.isError && (
        <div className="note inline" role="status">
          <p className="lede">Your bests did not load, so this {noun} is shown on its own.</p>
          <button type="button" className="secondary compact" onClick={() => bests.refetch()}>
            Try again
          </button>
        </div>
      )}
      {curve.length > 0 && (
        <>
          <PowerCurve
            label={`Power curve of this ${noun} against ${bestLabel.toLowerCase()}`}
            series={[
              ...(bests.data
                ? [
                    {
                      key: "best",
                      label: "Your best",
                      kind: "best" as const,
                      points: bests.data.powerCurve,
                    },
                  ]
                : []),
              { key: "activity", label: thisLabel, kind: "activity" as const, points: curve },
            ]}
          />
          <PowerTable
            curve={curve}
            bests={bests.data?.powerCurve}
            own={own}
            thisLabel={thisLabel}
            bestLabel={bestLabel}
          />
        </>
      )}
      {efforts.length > 0 && (
        <EffortTable
          efforts={efforts}
          bests={bests.data?.bestEfforts}
          own={own}
          thisLabel={thisLabel}
          bestLabel={bestLabel}
        />
      )}
    </section>
  );
}

function BestCell({
  best,
  own,
  text,
  ahead,
}: {
  best: { activityId: string; day: string } | undefined;
  own: Set<string>;
  text: string | undefined;
  ahead: string | undefined;
}) {
  if (!best || text === undefined) return <td colSpan={2}>-</td>;
  const mine = own.has(best.activityId);
  return (
    <>
      <td>{text}</td>
      <td className="best-from">
        {mine ? (
          <span className="badge">This one</span>
        ) : (
          <>
            <Link to="/activities/$id" params={{ id: best.activityId }}>
              {formatDay(best.day)}
            </Link>
            {ahead && <span className="muted best-ahead"> {ahead}</span>}
          </>
        )}
      </td>
    </>
  );
}

function PowerTable({
  curve,
  bests,
  own,
  thisLabel,
  bestLabel,
}: {
  curve: readonly { durationSeconds: number; watts: number }[];
  bests: readonly BestPower[] | undefined;
  own: Set<string>;
  thisLabel: string;
  bestLabel: string;
}) {
  return (
    <div className="table-scroll">
      <table className="data-table bests-table">
        <caption className="visually-hidden">Best power over each duration</caption>
        <thead>
          <tr>
            <th scope="col">Duration</th>
            <th scope="col">{thisLabel}</th>
            <th scope="col">{bestLabel}</th>
            <th scope="col">From</th>
          </tr>
        </thead>
        <tbody>
          {curve.map((point) => {
            const best = bests?.find((b) => b.durationSeconds === point.durationSeconds);
            const short = best && !own.has(best.activityId) ? best.watts - point.watts : 0;
            return (
              <tr key={point.durationSeconds}>
                <th scope="row">{durationLabel(point.durationSeconds)}</th>
                <td>{Math.round(point.watts)} W</td>
                <BestCell
                  best={best}
                  own={own}
                  text={best ? `${Math.round(best.watts)} W` : bests ? undefined : "…"}
                  ahead={short >= 1 ? `${Math.round(short)} W more` : undefined}
                />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EffortTable({
  efforts,
  bests,
  own,
  thisLabel,
  bestLabel,
}: {
  efforts: readonly { name: string; seconds: number }[];
  bests: readonly BestEffort[] | undefined;
  own: Set<string>;
  thisLabel: string;
  bestLabel: string;
}) {
  return (
    <div className="table-scroll">
      <table className="data-table bests-table">
        <caption className="visually-hidden">Fastest time over each distance</caption>
        <thead>
          <tr>
            <th scope="col">Distance</th>
            <th scope="col">{thisLabel}</th>
            <th scope="col">{bestLabel}</th>
            <th scope="col">From</th>
          </tr>
        </thead>
        <tbody>
          {efforts.map((effort) => {
            const distance = bestEffortDistances.find((d) => d.effort === effort.name);
            const best = bests?.find((b) => b.name === effort.name);
            const pace = distance?.metres
              ? formatPace(distance.metres / effort.seconds, "pace_km")
              : null;
            const slower = best && !own.has(best.activityId) ? effort.seconds - best.seconds : 0;
            return (
              <tr key={effort.name}>
                <th scope="row">{distance?.label ?? effort.name}</th>
                <td>
                  {formatDuration(effort.seconds)}
                  {pace && (
                    <span className="muted">
                      {" "}
                      {pace.value} {pace.unit}
                    </span>
                  )}
                </td>
                <BestCell
                  best={best}
                  own={own}
                  text={best ? formatDuration(best.seconds) : bests ? undefined : "…"}
                  ahead={slower >= 1 ? `${formatDuration(slower)} faster` : undefined}
                />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
