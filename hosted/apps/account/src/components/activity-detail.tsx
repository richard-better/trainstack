import { ORPCError } from "@orpc/client";
import { type DecodedActivity, activitySport } from "@trainstack/activity-file";
import { timerPauses } from "@trainstack/analysis";
import {
  type ActivityDetail,
  type ActivitySummaryError,
  activityIdSchema,
} from "@trainstack/contract";
import { profileOn } from "@trainstack/zones";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

import { activityKey, api, queryClient } from "../api";
import { type Reading, downloadName, fileSize, readActivityFile } from "../lib/activity-file";
import {
  analysisRefreshMs,
  analysisErrorText,
  settingsScopeOf,
  analysisState,
  analysisUpdating,
  effortFigures,
  lapsFromEvents,
  loadOf,
  sourceWords,
  speedStyleOf,
  thresholdPrompt,
} from "../lib/analysis";
import { activityDateInFull } from "../lib/dates";
import { datedChanges, localDay } from "../lib/settings";
import { type Axis, type LapRow, type Trace, lapsOf, traceOf } from "../lib/series";
import { type Route, routeOf } from "../lib/route";
import { type MeasureOption, routeMeasures } from "../lib/route-colours";
import type { Elevation } from "../lib/terrain";
import { activityTitle, sportName } from "../lib/sports";
import {
  type Figure,
  type SpeedStyle,
  formatDistance,
  formatDuration,
  formatSpeed,
  statisticsFromFit,
  summaryFigures,
} from "../lib/statistics";
import { deletingSource } from "../lib/workouts";
import { ActivityBests } from "./activity-bests";
import { useSettingsHistory } from "./settings-data";
import { SportIcon } from "./sport-icon";
import { TimeInZones } from "./time-in-zones";
import { Traces } from "./traces";
import { OtherSource, Sources, refreshWorkouts, useWorkout } from "./workout-sources";
import { PeriodPicker } from "./period-picker";
import { RouteSection } from "./route-map";

const refused = (error: Error) => error instanceof ORPCError && error.status < 500;

export function ActivityPage({ id }: { id: string }) {
  const valid = activityIdSchema.safeParse(id).success;
  const detail = useQuery({
    queryKey: activityKey(id),
    queryFn: () => api.activities.get({ id }),
    enabled: valid,
    retry: (failures, error) => !refused(error) && failures < 2,
    refetchInterval: (query) => analysisRefreshMs(query.state.data?.analysisDue ?? false),
  });

  if (
    !valid ||
    (detail.isError && detail.error instanceof ORPCError && detail.error.code === "NOT_FOUND")
  ) {
    return (
      <Shell>
        <div className="state" role="alert">
          <p className="state-title">This activity is not in your account.</p>
          <p className="lede">
            It may have been deleted, or the link belongs to someone else's account.
          </p>
          <Link to="/" className="secondary link-button">
            See your activities
          </Link>
        </div>
      </Shell>
    );
  }
  if (detail.isError) {
    return (
      <Shell>
        <div className="state" role="alert">
          <p className="state-title">This activity did not load.</p>
          <p className="lede">Check your connection and try again.</p>
          <button type="button" className="secondary" onClick={() => detail.refetch()}>
            Try again
          </button>
        </div>
      </Shell>
    );
  }
  if (detail.isPending) {
    return (
      <Shell>
        <div className="detail-head skeleton" aria-busy="true" aria-label="Loading activity">
          <span className="bar" style={{ width: "30%" }} />
          <span className="bar tall" style={{ width: "55%" }} />
        </div>
        <FiguresSkeleton />
      </Shell>
    );
  }
  return <Activity activity={detail.data} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="content detail">
      <Link to="/" className="back">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
          <path
            d="M10 3 5 8l5 5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Activities
      </Link>
      {children}
    </main>
  );
}

function useActivityFile(activity: ActivityDetail) {
  return useQuery({
    queryKey: [...activityKey(activity.id), "file"],
    enabled: activity.file !== null,
    staleTime: Infinity,
    queryFn: async (): Promise<{ file: File; reading: Reading }> => {
      const file = await api.activities.file({ id: activity.id });
      return { file, reading: readActivityFile(new Uint8Array(await file.arrayBuffer())) };
    },
  });
}

function Activity({ activity }: { activity: ActivityDetail }) {
  const activityFile = useActivityFile(activity);
  const decoded =
    activityFile.data?.reading.kind === "decoded" ? activityFile.data.reading.activity : null;
  const fromFile = decoded ? activitySport(decoded.summary.sport, decoded.summary.subSport) : null;
  const sport = activity.sport ?? fromFile?.sport ?? null;
  const indoor = activity.indoor ?? fromFile?.indoor ?? null;
  const startedAt = activity.startedAt ?? decoded?.summary.startTime ?? null;
  const title = activityTitle({
    name: activity.name ?? decoded?.name ?? null,
    sport,
    indoor,
    startedAt,
  });
  const statistics =
    Object.keys(activity.statistics).length > 0
      ? activity.statistics
      : decoded
        ? statisticsFromFit(decoded.summary)
        : {};
  const speed = speedStyleOf(sport);
  const figures = summaryFigures(statistics, speed);
  const { label, family } = sportName(sport, indoor);
  const workout = useWorkout(activity);

  useEffect(() => {
    document.title = `${title} - Trainstack`;
    return () => {
      document.title = "Trainstack";
    };
  }, [title]);

  return (
    <Shell>
      <OtherSource activity={activity} workout={workout} />
      <header className="detail-head">
        <p className="detail-meta">
          <span className="detail-sport">
            <SportIcon family={family} />
            {label}
          </span>
          <time dateTime={(startedAt ?? activity.createdAt).toISOString()}>
            {activityDateInFull(startedAt ?? activity.createdAt)}
          </time>
          {activity.duplicates.length > 0 && (
            <a href="#sources" className="text-link">
              {activity.duplicates.length + 1} sources
            </a>
          )}
        </p>
        <h1 className="detail-title">{title}</h1>
        <Actions
          activity={activity}
          title={title}
          startedAt={startedAt}
          file={activityFile.data?.file}
        />
      </header>

      {figures.length > 0 ? (
        <Figures figures={figures} />
      ) : activityFile.isPending && activity.file ? (
        <FiguresSkeleton />
      ) : null}

      {activity.summaryError &&
        !(activity.file && activityFile.isPending) &&
        activityFile.data?.reading.kind !== "unreadable" && (
          <p className="lede summary-problem" role="status">
            {summaryProblem(activity.summaryError, decoded !== null)}
          </p>
        )}

      <Effort activity={activity} sport={sport} />

      <Analysis
        activity={activity}
        activityFile={activityFile}
        sport={sport}
        indoor={indoor}
        title={title}
        speed={speed}
        day={localDay(startedAt ?? activity.createdAt)}
      />

      <ActivityBests activity={activity} sport={sport} />

      <Sources activity={activity} title={title} />
    </Shell>
  );
}

function summaryProblem(error: ActivitySummaryError, readHere: boolean) {
  const because = {
    too_large: "This file has more than 10,000 laps or sessions, more than Trainstack summarises",
    failed: "Trainstack could not summarise this activity",
    truncated: "Trainstack found this file ends early",
    corrupt: "Trainstack could not read this file",
    no_activity: "Trainstack found no recorded activity in this file",
  }[error];
  return readHere
    ? `${because}, so these numbers are read from the file in your browser and do not show in your activity list.`
    : `${because}, so it has no numbers in your activity list.`;
}

function Figures({
  figures,
  details = {},
}: {
  figures: Figure[];
  details?: Record<string, string>;
}) {
  return (
    <dl className="figures">
      {figures.map((figure) => (
        <div key={figure.name} className="figure">
          <dt>{figure.label}</dt>
          <dd>
            {figure.value}
            {figure.unit && <span className="unit">{figure.unit}</span>}
            {details[figure.name] && <span className="figure-detail">{details[figure.name]}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Effort({ activity, sport }: { activity: ActivityDetail; sport: string | null }) {
  const state = analysisState(activity);
  const scored = { ...activity, sport };
  const figures = effortFigures(activity.statistics, sport);
  const load = loadOf(activity.statistics, sport);
  const history = useSettingsHistory();
  const profile =
    history.data && profileOn(datedChanges(history.data.entries), localDay(new Date()));
  const prompt =
    state.kind === "analysed" && profile
      ? thresholdPrompt(scored, settingsScopeOf(profile, sport))
      : null;
  const noun = sportName(sport).noun;
  if (state.kind === "no_file" && figures.length === 0) return null;
  return (
    <section aria-labelledby="effort">
      <h2 id="effort" className="section-title">
        Effort
      </h2>
      {state.kind === "pending" && (
        <p className="lede analysing-note" role="status">
          Trainstack is analysing this {noun}. Its load, bests and stored zones appear here within a
          minute.
        </p>
      )}
      {analysisUpdating(activity) && (
        <p className="updating-note" role="status">
          Updating. These numbers may change in a moment.
        </p>
      )}
      {state.kind === "failed" && (
        <p className="lede summary-problem" role="status">
          {analysisErrorText(state.error)}
        </p>
      )}
      {figures.length > 0 && (
        <Figures
          figures={figures}
          details={load?.source ? { load_tss: `from ${sourceWords[load.source]}` } : {}}
        />
      )}
      {prompt && (
        <div className="zone-prompt effort-prompt">
          <p className="lede">{prompt.text}</p>
          <Link to="/settings" search={prompt.search} className="secondary link-button compact">
            {prompt.action}
          </Link>
        </div>
      )}
    </section>
  );
}

function FiguresSkeleton() {
  return (
    <div className="figures skeleton" aria-hidden="true">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="figure">
          <span className="bar" style={{ width: "50%" }} />
          <span className="bar tall" style={{ width: "70%" }} />
        </div>
      ))}
    </div>
  );
}

function Analysis({
  activity,
  activityFile,
  sport,
  indoor,
  title,
  speed,
  day,
}: {
  activity: ActivityDetail;
  activityFile: ReturnType<typeof useActivityFile>;
  sport: string | null;
  indoor: boolean | null;
  title: string;
  speed: SpeedStyle;
  day: string;
}) {
  if (!activity.file) {
    return (
      <Note title="No file is stored for this activity.">
        Charts and laps are drawn from an activity's file.
      </Note>
    );
  }
  if (activityFile.isPending) {
    return <div className="traces-loading" aria-busy="true" aria-label="Loading charts" />;
  }
  if (activityFile.isError) {
    return (
      <Note title="The activity's file did not load.">
        <button type="button" className="secondary" onClick={() => activityFile.refetch()}>
          Try again
        </button>
      </Note>
    );
  }
  const { reading } = activityFile.data;
  if (reading.kind === "unreadable") {
    return (
      <Note
        title={`This ${(reading.format ?? activity.file.format).toUpperCase()} file could not be read.`}
      >
        {reading.code === "noActivity"
          ? "It holds no recorded activity, so there is nothing to chart."
          : "It looks damaged or incomplete, so there are no charts or laps."}{" "}
        You can still download the original.
      </Note>
    );
  }
  return (
    <Recorded
      activity={activity}
      decoded={reading.activity}
      sport={sport}
      indoor={indoor}
      title={title}
      speed={speed}
      day={day}
    />
  );
}

function Recorded({
  activity,
  decoded,
  sport,
  indoor,
  title,
  speed,
  day,
}: {
  activity: ActivityDetail;
  decoded: DecodedActivity;
  sport: string | null;
  indoor: boolean | null;
  title: string;
  speed: SpeedStyle;
  day: string;
}) {
  const trace = useMemo(() => traceOf(decoded), [decoded]);
  const route = useMemo(
    () =>
      indoor
        ? null
        : routeOf(decoded.records, timerPauses(decoded.events, decoded.summary.startTime)),
    [decoded, indoor],
  );
  const elevation = indoor ? null : trace.elevation;
  const measures = useMemo(
    () => (route ? routeMeasures(trace, elevation, speed) : []),
    [route, trace, elevation, speed],
  );
  const analysed = analysisState(activity).kind === "analysed";
  const storedLaps =
    analysed && activity.startedAt ? lapsFromEvents(activity.events, activity.startedAt) : [];
  const laps = storedLaps.length > 0 ? storedLaps : lapsOf(decoded);
  return (
    <>
      <Linked
        trace={trace}
        route={route}
        measures={measures}
        elevation={elevation}
        laps={laps}
        title={title}
      />
      <TimeInZones
        activity={decoded}
        sport={sport}
        day={day}
        trace={trace}
        stored={
          analysed && activity.localDay
            ? { statistics: activity.statistics, day: activity.localDay }
            : null
        }
      />
      {laps.length > 0 && <Laps laps={laps} speed={speed} />}
    </>
  );
}

function Linked({
  trace,
  route,
  measures,
  elevation,
  laps,
  title,
}: {
  trace: Trace;
  route: Route | null;
  measures: readonly MeasureOption[];
  elevation: Elevation | null;
  laps: LapRow[];
  title: string;
}) {
  const [cursor, setCursor] = useState<number | null>(null);
  const [axis, setAxis] = useState<Axis>("time");
  const charted = trace.channels.length > 0 || elevation !== null;
  return (
    <>
      {route && (
        <RouteSection
          route={route}
          measures={measures}
          distances={trace.distances}
          cursor={cursor}
          onCursor={setCursor}
          title={title}
        />
      )}
      {charted ? (
        <section aria-labelledby="over-time">
          <div className="section-head">
            <h2 id="over-time" className="section-title">
              {axis === "distance" ? "Over distance" : "Over time"}
            </h2>
            {trace.distances && (
              <PeriodPicker
                label="Chart against"
                options={[
                  { key: "time" as const, label: "Time" },
                  { key: "distance" as const, label: "Distance" },
                ]}
                value={axis}
                onChange={setAxis}
              />
            )}
          </div>
          <Traces
            trace={trace}
            laps={laps}
            elevation={elevation}
            axis={axis}
            cursor={cursor}
            onCursor={setCursor}
          />
        </section>
      ) : (
        <Note title="This file has no power, heart rate, cadence or speed to chart." />
      )}
    </>
  );
}

function Note({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="note" role="status">
      <p className="state-title">{title}</p>
      {children && <p className="lede">{children}</p>}
    </div>
  );
}

function Laps({ laps, speed }: { laps: ReturnType<typeof lapsOf>; speed: SpeedStyle }) {
  const pace = (value: number | undefined) => {
    if (value === undefined) return undefined;
    const shown = formatSpeed(value, speed);
    return `${shown.value} ${shown.unit}`;
  };
  const columns = (
    [
      ["Time", (lap) => (lap.seconds === undefined ? undefined : formatDuration(lap.seconds))],
      [
        "Distance",
        (lap) => {
          if (lap.distanceMetres === undefined) return undefined;
          const { value, unit } = formatDistance(lap.distanceMetres);
          return `${value} ${unit}`;
        },
      ],
      ["Avg power", (lap) => whole(lap.averagePower, "W")],
      ["NP", (lap) => whole(lap.normalizedPower, "W")],
      ["Max power", (lap) => whole(lap.maxPower, "W")],
      ["Work", (lap) => whole(lap.workKilojoules, "kJ")],
      ["Avg HR", (lap) => whole(lap.averageHeartRate, "bpm")],
      ["Cadence", (lap) => whole(lap.averageCadence, speed === "pace_km" ? "spm" : "rpm")],
      [speed === "speed" ? "Speed" : "Pace", (lap) => pace(lap.averageSpeed)],
      ["GAP", (lap) => (speed === "pace_km" ? pace(lap.gradeAdjustedSpeed) : undefined)],
    ] as const satisfies readonly (readonly [
      string,
      (lap: (typeof laps)[number]) => string | undefined,
    ])[]
  ).filter(([, read]) => laps.some((lap) => read(lap) !== undefined));

  return (
    <section aria-labelledby="laps">
      <h2 id="laps" className="section-title">
        Laps
      </h2>
      <div className="table-scroll">
        <table className="laps">
          <thead>
            <tr>
              <th scope="col">Lap</th>
              {columns.map(([heading]) => (
                <th key={heading} scope="col">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {laps.map((lap) => (
              <tr key={lap.number}>
                <th scope="row">{lap.number}</th>
                {columns.map(([heading, read]) => (
                  <td key={heading}>{read(lap) ?? "-"}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const whole = (value: number | undefined, unit: string) =>
  value === undefined ? undefined : `${Math.round(value)} ${unit}`;

function Actions({
  activity,
  title,
  startedAt,
  file,
}: {
  activity: ActivityDetail;
  title: string;
  startedAt: Date | null;
  file: File | undefined;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const navigate = useNavigate();
  const [downloadFailed, setDownloadFailed] = useState(false);

  const download = useMutation({
    mutationFn: async () => file ?? api.activities.file({ id: activity.id }),
    onMutate: () => setDownloadFailed(false),
    onError: () => setDownloadFailed(true),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = downloadName(activity, title, startedAt);
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
  });

  const others = activity.duplicates;
  const remove = useMutation({
    mutationFn: async () => {
      await api.activities.delete({ id: activity.id });
      const remaining = others[0];
      if (!remaining) return null;
      const next = await api.activities.get({ id: remaining.id }).catch(() => null);
      if (!next) return remaining.id;
      return next.primary
        ? next.id
        : (next.duplicates.find(({ primary }) => primary)?.id ?? next.id);
    },
    onSuccess: async (workoutId) => {
      dialog.current?.close();
      queryClient.removeQueries({ queryKey: activityKey(activity.id) });
      await refreshWorkouts();
      await (workoutId
        ? navigate({ to: "/activities/$id", params: { id: workoutId } })
        : navigate({ to: "/" }));
    },
  });

  return (
    <div className="actions">
      {activity.file && (
        <button
          type="button"
          className="secondary"
          onClick={() => download.mutate()}
          disabled={download.isPending}
        >
          <DownloadIcon />
          {download.isPending ? "Downloading…" : `Download .${activity.file.format}`}
          <span className="button-detail">{fileSize(activity.file.size)}</span>
        </button>
      )}
      <button
        type="button"
        className="secondary danger"
        onClick={() => dialog.current?.showModal()}
      >
        Delete
      </button>
      {downloadFailed && (
        <p role="alert" className="notice">
          The file did not download. Try again.
        </p>
      )}
      <dialog
        ref={dialog}
        className="confirm"
        aria-labelledby="confirm-title"
        onClose={() => remove.reset()}
      >
        {others.length === 0 ? (
          <>
            <h2 id="confirm-title">Delete this activity?</h2>
            <p className="lede">
              {title} is removed from your account, along with its file. It will not be added again,
              from Ride or by uploading the same file.
            </p>
          </>
        ) : (
          <>
            <h2 id="confirm-title">Delete this source?</h2>
            <p className="lede">{deletingSource(activity).what}</p>
            <p className="lede">{deletingSource(activity).stays}</p>
          </>
        )}
        {remove.isError && (
          <p role="alert" className="notice">
            The activity was not deleted. Try again.
          </p>
        )}
        <div className="confirm-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => dialog.current?.close()}
            autoFocus
          >
            Cancel
          </button>
          <button
            type="button"
            className="destructive"
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
          >
            {remove.isPending
              ? "Deleting…"
              : others.length === 0
                ? "Delete activity"
                : "Delete this source"}
          </button>
        </div>
      </dialog>
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M8 2.5v8m0 0L4.5 7M8 10.5 11.5 7M3 13.5h10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
