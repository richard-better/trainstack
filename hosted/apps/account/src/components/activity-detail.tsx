import { ORPCError } from "@orpc/client";
import { activitySport } from "@trainstack/activity-file";
import {
  type ActivityDetail,
  type ActivitySummaryError,
  activityIdSchema,
} from "@trainstack/contract";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { activityKey, api, queryClient } from "../api";
import { type Reading, downloadName, fileSize, readActivityFile } from "../lib/activity-file";
import { activityDateInFull } from "../lib/dates";
import { localDay } from "../lib/settings";
import { lapsOf, traceOf } from "../lib/series";
import { activityTitle, sportName } from "../lib/sports";
import {
  type Figure,
  formatDistance,
  formatDuration,
  statisticsFromFit,
  summaryFigures,
} from "../lib/statistics";
import { deletingSource } from "../lib/workouts";
import { SportIcon } from "./sport-icon";
import { TimeInZones } from "./time-in-zones";
import { Traces } from "./traces";
import { OtherSource, Sources, refreshWorkouts, useWorkout } from "./workout-sources";

const refused = (error: Error) => error instanceof ORPCError && error.status < 500;

export function ActivityPage({ id }: { id: string }) {
  const valid = activityIdSchema.safeParse(id).success;
  const detail = useQuery({
    queryKey: activityKey(id),
    queryFn: () => api.activities.get({ id }),
    enabled: valid,
    retry: (failures, error) => !refused(error) && failures < 2,
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
  const figures = summaryFigures(statistics);
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

      <Analysis
        activity={activity}
        activityFile={activityFile}
        sport={sport}
        day={localDay(startedAt ?? activity.createdAt)}
      />

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

function Figures({ figures }: { figures: Figure[] }) {
  return (
    <dl className="figures">
      {figures.map((figure) => (
        <div key={figure.name} className="figure">
          <dt>{figure.label}</dt>
          <dd>
            {figure.value}
            {figure.unit && <span className="unit">{figure.unit}</span>}
          </dd>
        </div>
      ))}
    </dl>
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
  day,
}: {
  activity: ActivityDetail;
  activityFile: ReturnType<typeof useActivityFile>;
  sport: string | null;
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
  const trace = traceOf(reading.activity);
  const laps = lapsOf(reading.activity);
  return (
    <>
      {trace.channels.length > 0 ? (
        <section aria-labelledby="over-time">
          <h2 id="over-time" className="section-title">
            Over time
          </h2>
          <Traces trace={trace} laps={laps} />
        </section>
      ) : (
        <Note title="This file has no power, heart rate, cadence or speed to chart." />
      )}
      <TimeInZones activity={reading.activity} sport={sport} day={day} trace={trace} />
      {laps.length > 0 && <Laps laps={laps} />}
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

function Laps({ laps }: { laps: ReturnType<typeof lapsOf> }) {
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
      ["Max power", (lap) => whole(lap.maxPower, "W")],
      ["Avg HR", (lap) => whole(lap.averageHeartRate, "bpm")],
      ["Cadence", (lap) => whole(lap.averageCadence, "rpm")],
      [
        "Speed",
        (lap) =>
          lap.averageSpeedKmh === undefined ? undefined : `${lap.averageSpeedKmh.toFixed(1)} km/h`,
      ],
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
