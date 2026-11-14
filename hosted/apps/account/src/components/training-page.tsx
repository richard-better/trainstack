import type { Activity, BestEffort, BestPower } from "@trainstack/contract";
import { profileOn } from "@trainstack/zones";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { activityKey, api, queryClient } from "../api";
import {
  analysisRefreshMs,
  analysisState,
  durationLabel,
  sourceWords,
  settingsScopeOf,
  thresholdPrompt,
} from "../lib/analysis";
import { datedChanges, formatDay, localDay } from "../lib/settings";
import { activityTitle } from "../lib/sports";
import {
  effortLabel,
  effortDistances,
  formatDuration,
  formatLoad,
  formatPace,
} from "../lib/statistics";
import { todayIn } from "../lib/time-zone";
import {
  type BestsPeriodKey,
  FITNESS_BUILD_DAYS,
  type LoadDay,
  type LoadRangeKey,
  bestsPeriod,
  bestsPeriodKeys,
  daysBetween,
  formZoneOf,
  loadHistory,
  loadQueryKey,
  loadRange,
  loadRangeKeys,
  loadSummary,
  shiftDay,
  signed,
} from "../lib/training";
import { useBests } from "./activity-bests";
import { LoadChart } from "./load-chart";
import { PeriodPicker } from "./period-picker";
import { PowerCurve } from "./power-curve";
import { useSettingsChangedRecently, useSettingsHistory } from "./settings-data";
import { TimeZoneOffer, useAthleteSettings } from "./time-zone";

const HISTORY_DAYS = 3 * 365;
const recentKey = ["activities", "recent-analysis"] as const;

function useRecentActivities(settling: boolean) {
  return useQuery({
    queryKey: recentKey,
    queryFn: () => api.activities.list({ limit: 50, onePerWorkout: true }),
    refetchInterval: (query) =>
      analysisRefreshMs(
        settling ||
          (query.state.data?.activities.some((a) => analysisState(a).kind === "pending") ?? false),
      ),
  });
}

function useRefreshWhenSettled(updating: boolean) {
  const [wasUpdating, setWasUpdating] = useState(updating);
  useEffect(() => {
    if (wasUpdating && !updating) {
      void queryClient.invalidateQueries({ queryKey: ["training"] });
      void queryClient.invalidateQueries({ queryKey: recentKey });
    }
    setWasUpdating(updating);
  }, [updating, wasUpdating]);
}

export function TrainingPage({ range, period }: { range: LoadRangeKey; period: BestsPeriodKey }) {
  const navigate = useNavigate({ from: "/training" });
  const settings = useAthleteSettings();
  const today = todayIn(settings.data?.timeZone ?? null);
  const settling = useSettingsChangedRecently();
  const recent = useRecentActivities(settling);
  const pending = recent.data?.activities.filter((a) => analysisState(a).kind === "pending") ?? [];
  const updating = pending.length > 0 || settling;
  useRefreshWhenSettled(updating);
  const from = shiftDay(today, -(HISTORY_DAYS - 1));
  const load = useQuery({
    queryKey: loadQueryKey(from, today),
    queryFn: () => api.training.load({ from, through: today }),
    enabled: !settings.isPending,
    refetchInterval: analysisRefreshMs(updating),
  });

  return (
    <main className="content training">
      <div className="page-head">
        <h1 className="page-title">Training</h1>
      </div>
      <TimeZoneOffer where="training" />
      {updating && (
        <p className="lede analysing-note" role="status">
          {pending.length > 0
            ? `Trainstack is analysing ${pending.length === 1 ? "an activity" : `${pending.length} activities`}, so these numbers may still change in the next minute.`
            : "Your settings changed a moment ago. Trainstack is scoring the activities they touch again, so these numbers may still move for a minute or two."}
        </p>
      )}
      {load.isPending ? (
        <div
          className="skeleton training-skeleton"
          aria-busy="true"
          aria-label="Loading your training"
        >
          <span className="bar tall" style={{ width: "50%" }} />
          <span className="bar" style={{ width: "100%", height: 320 }} />
        </div>
      ) : load.isError ? (
        <div className="state" role="alert">
          <p className="state-title">Your training did not load.</p>
          <p className="lede">Check your connection and try again.</p>
          <button type="button" className="secondary" onClick={() => load.refetch()}>
            Try again
          </button>
        </div>
      ) : (
        <Load
          days={load.data.days}
          today={load.data.today}
          range={range}
          recent={recent.data?.activities}
          onRange={(next) => navigate({ search: (s) => ({ ...s, range: next }), replace: true })}
        />
      )}
      <Bests
        today={today}
        period={period}
        onPeriod={(next) => navigate({ search: (s) => ({ ...s, period: next }), replace: true })}
      />
    </main>
  );
}

function Load({
  days,
  today,
  range,
  recent,
  onRange,
}: {
  days: LoadDay[];
  today: string;
  range: LoadRangeKey;
  recent: Activity[] | undefined;
  onRange: (range: LoadRangeKey) => void;
}) {
  const history = loadHistory(days);
  const unscored = (recent ?? []).filter(
    (a) => analysisState(a).kind === "analysed" && a.statistics.load_tss === undefined,
  );
  const settingsHistory = useSettingsHistory();
  const profile =
    settingsHistory.data &&
    profileOn(datedChanges(settingsHistory.data.entries), localDay(new Date()));
  const prompt = profile
    ? (unscored
        .map((a) => thresholdPrompt(a, settingsScopeOf(profile, a.sport)))
        .find((p) => p !== null) ?? null)
    : null;

  if (history.firstLoaded === null) {
    return <NoLoad recent={recent} prompt={prompt} />;
  }

  const shown = loadRange(range, today);
  const visible = days.filter((d) => d.day >= shown.from && d.day <= shown.through);
  const summary = loadSummary(days, today);
  const building = daysBetween(history.firstLoaded, today) < FITNESS_BUILD_DAYS;

  return (
    <>
      {summary && <Today summary={summary} />}
      {building && (
        <p className="lede building-note">
          Fitness builds over about six weeks of training. Your first scored activity was on{" "}
          {formatDay(history.firstLoaded)}, so fitness reads low until there is more behind it.
        </p>
      )}
      {prompt && (
        <div className="zone-prompt training-prompt">
          <p className="lede">
            {unscored.length === 1
              ? "One of your recent activities has no load, so it is left out of fitness and fatigue."
              : `${unscored.length} of your recent activities have no load, so they are left out of fitness and fatigue.`}{" "}
            {prompt.text}
          </p>
          <Link to="/settings" search={prompt.search} className="secondary link-button compact">
            {prompt.action}
          </Link>
        </div>
      )}
      <section aria-labelledby="load-title">
        <div className="section-head">
          <h2 id="load-title" className="section-title">
            Fitness, fatigue and form
          </h2>
          <PeriodPicker
            label="Show the last"
            options={loadRangeKeys.map((key) => loadRange(key, today))}
            value={range}
            onChange={onRange}
          />
        </div>
        <LoadView key={`${range}-${today}`} days={visible} />
      </section>
    </>
  );
}

function LoadView({ days }: { days: LoadDay[] }) {
  const [selected, setSelected] = useState(days.length - 1);
  const day = days[Math.min(selected, days.length - 1)];
  return (
    <div className="load-view">
      <LoadChart days={days} selected={selected} onSelect={setSelected} />
      {day && <DayReadout day={day} />}
    </div>
  );
}

function Today({ summary }: { summary: NonNullable<ReturnType<typeof loadSummary>> }) {
  const { day, zone, ramp } = summary;
  const rampText =
    ramp === null
      ? ""
      : Math.abs(ramp) < 0.5
        ? " Fitness is level with a week ago."
        : ` Fitness is ${ramp > 0 ? "up" : "down"} ${Math.abs(Math.round(ramp))} on a week ago${ramp > 8 ? ", a steep rise that is hard to keep up for long" : ""}.`;
  return (
    <section aria-labelledby="today-title" className="today">
      <h2 id="today-title" className="visually-hidden">
        Today
      </h2>
      <dl className="today-figures">
        <div>
          <dt>Fitness</dt>
          <dd>{Math.round(day.fitness)}</dd>
        </div>
        <div>
          <dt>Fatigue</dt>
          <dd>{Math.round(day.fatigue)}</dd>
        </div>
        <div className="today-form">
          <dt>Form</dt>
          <dd>
            {signed(day.form)}
            <span className="form-word">{zone.label}</span>
          </dd>
        </div>
      </dl>
      <p className="today-sentence">
        Today your form is {signed(day.form)}, {zone.label.toLowerCase()}: {zone.meaning}.{rampText}
      </p>
    </section>
  );
}

function DayReadout({ day }: { day: LoadDay }) {
  const activities = useQueries({
    queries: day.activities.map(({ id }) => ({
      queryKey: activityKey(id),
      queryFn: () => api.activities.get({ id }),
      staleTime: 60_000,
    })),
  });
  const zone = formZoneOf(day.form);
  return (
    <div className="day-readout" aria-live="polite">
      <p className="day-title">{formatDay(day.day)}</p>
      <dl className="day-figures">
        <div>
          <dt>Fitness</dt>
          <dd>{Math.round(day.fitness)}</dd>
        </div>
        <div>
          <dt>Fatigue</dt>
          <dd>{Math.round(day.fatigue)}</dd>
        </div>
        <div>
          <dt>Form</dt>
          <dd>
            {signed(day.form)} <span className="muted">{zone.label.toLowerCase()}</span>
          </dd>
        </div>
        <div>
          <dt>Load</dt>
          <dd>{formatLoad(day.stress)}</dd>
        </div>
      </dl>
      {day.activities.length === 0 ? (
        <p className="lede">No scored activity on this day.</p>
      ) : (
        <ul className="day-activities">
          {day.activities.map((entry, index) => {
            const detail = activities[index]?.data;
            return (
              <li key={entry.id}>
                <Link to="/activities/$id" params={{ id: entry.id }}>
                  {detail ? activityTitle(detail) : "Activity"}
                </Link>
                <span className="muted">
                  {" "}
                  load {formatLoad(entry.stress)}, from{" "}
                  {sourceWords[entry.source as keyof typeof sourceWords] ?? entry.source}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function NoLoad({
  recent,
  prompt,
}: {
  recent: Activity[] | undefined;
  prompt: ReturnType<typeof thresholdPrompt>;
}) {
  if (recent === undefined) return null;
  if (recent.length === 0) {
    return (
      <div className="state empty">
        <p className="state-title">No activities yet</p>
        <p className="lede">
          Fitness, fatigue and form come from the load of each activity. Upload files or record a
          ride in Ride, and they build up here.
        </p>
        <Link to="/" className="secondary link-button">
          Go to activities
        </Link>
      </div>
    );
  }
  return (
    <div className="state empty">
      <p className="state-title">None of your activities has a load yet</p>
      <p className="lede">
        {prompt
          ? prompt.text
          : "Load comes from power, pace or heart rate against your thresholds. Set them in Settings, and your activities are scored within a minute or two."}
      </p>
      <Link to="/settings" search={prompt?.search ?? {}} className="secondary link-button">
        {prompt?.action ?? "Set thresholds"}
      </Link>
    </div>
  );
}

function Bests({
  today,
  period,
  onPeriod,
}: {
  today: string;
  period: BestsPeriodKey;
  onPeriod: (period: BestsPeriodKey) => void;
}) {
  const shown = bestsPeriod(period, today);
  const refresh = { refetchInterval: analysisRefreshMs(false) };
  const rides = useBests(shown.from, "cycling", refresh);
  const runs = useBests(shown.from, "running", refresh);
  return (
    <section aria-labelledby="bests-title">
      <div className="section-head">
        <h2 id="bests-title" className="section-title">
          Your bests
        </h2>
        <PeriodPicker
          label="Bests from"
          options={bestsPeriodKeys.map((key) => bestsPeriod(key, today))}
          value={period}
          onChange={onPeriod}
        />
      </div>
      <div className="bests-grid">
        <div>
          <h3 className="group-title">Power curve, cycling</h3>
          {rides.isError ? (
            <p className="notice">Your power curve did not load. Reload the page to try again.</p>
          ) : rides.isPending ? (
            <div
              className="traces-loading short"
              aria-busy="true"
              aria-label="Loading power curve"
            />
          ) : rides.data.powerCurve.length === 0 ? (
            <p className="lede">No ride with power {shown.description}.</p>
          ) : (
            <>
              <PowerCurve
                label={`Your best power over each duration, ${shown.description}`}
                series={[
                  {
                    key: "best",
                    label: "Best power",
                    kind: "activity",
                    points: rides.data.powerCurve,
                  },
                ]}
              />
              <PowerBests bests={rides.data.powerCurve} />
            </>
          )}
        </div>
        <div>
          <h3 className="group-title">Best efforts, running</h3>
          {runs.isError ? (
            <p className="notice">Your best efforts did not load. Reload the page to try again.</p>
          ) : runs.isPending ? (
            <div
              className="traces-loading short"
              aria-busy="true"
              aria-label="Loading best efforts"
            />
          ) : runs.data.bestEfforts.length === 0 ? (
            <p className="lede">No run with distance {shown.description}.</p>
          ) : (
            <EffortBests bests={runs.data.bestEfforts} />
          )}
        </div>
      </div>
    </section>
  );
}

function PowerBests({ bests }: { bests: BestPower[] }) {
  return (
    <div className="table-scroll">
      <table className="data-table bests-table">
        <caption className="visually-hidden">Best power over each duration</caption>
        <thead>
          <tr>
            <th scope="col">Duration</th>
            <th scope="col">Power</th>
            <th scope="col">From</th>
          </tr>
        </thead>
        <tbody>
          {bests.map((best) => (
            <tr key={best.durationSeconds}>
              <th scope="row">{durationLabel(best.durationSeconds)}</th>
              <td>{Math.round(best.watts)} W</td>
              <td className="best-from">
                <Link to="/activities/$id" params={{ id: best.activityId }}>
                  {formatDay(best.day)}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EffortBests({ bests }: { bests: BestEffort[] }) {
  return (
    <div className="table-scroll">
      <table className="data-table bests-table">
        <caption className="visually-hidden">Fastest time over each distance</caption>
        <thead>
          <tr>
            <th scope="col">Distance</th>
            <th scope="col">Time</th>
            <th scope="col">Pace</th>
            <th scope="col">From</th>
          </tr>
        </thead>
        <tbody>
          {bests.map((best) => {
            const metres = effortDistances[best.name]?.metres;
            const pace = metres ? formatPace(metres / best.seconds, "pace_km") : null;
            return (
              <tr key={best.name}>
                <th scope="row">{effortLabel(best.name)}</th>
                <td>{formatDuration(best.seconds)}</td>
                <td>{pace ? `${pace.value} ${pace.unit}` : "-"}</td>
                <td className="best-from">
                  <Link to="/activities/$id" params={{ id: best.activityId }}>
                    {formatDay(best.day)}
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
