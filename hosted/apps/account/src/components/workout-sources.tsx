import type { Activity, ActivityDetail } from "@trainstack/contract";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useDeferredValue, useEffect, useId, useRef, useState } from "react";

import { activitiesQueryKey, activityKey, api, queryClient } from "../api";
import { downloadName, fileSize } from "../lib/activity-file";
import { activityDate } from "../lib/dates";
import { activityTitle, sportName } from "../lib/sports";
import { headlineFigures } from "../lib/statistics";
import {
  type Source,
  type WorkoutChange,
  applyChange,
  linkCandidates,
  membersOf,
  primaryIdOf,
  sourceLabel,
  sourcesOf,
  undoOf,
} from "../lib/workouts";
import { SportIcon } from "./sport-icon";

const LINK_PAGE_SIZE = 200;
const linkCandidatesKey = ["activities", "link-candidates"] as const;

export async function refreshWorkouts() {
  await Promise.all([
    queryClient.invalidateQueries({
      predicate: ({ queryKey }) => queryKey[0] === "activity" && queryKey.length === 2,
    }),
    queryClient.invalidateQueries({ queryKey: activitiesQueryKey }),
  ]);
}

export function useWorkout(activity: ActivityDetail) {
  const primaryId = primaryIdOf(activity);
  const primary = useQuery({
    queryKey: activityKey(primaryId),
    queryFn: () => api.activities.get({ id: primaryId }),
    enabled: !activity.primary,
  });
  return activity.primary ? activity : primary.data;
}

export function OtherSource({
  activity,
  workout,
}: {
  activity: ActivityDetail;
  workout: Activity | undefined;
}) {
  if (activity.primary) return null;
  const primaryId = primaryIdOf(activity);
  const primary = activity.duplicates.find((duplicate) => duplicate.primary);
  return (
    <aside className="belongs" aria-labelledby="belongs-title">
      <p id="belongs-title" className="belongs-title">
        This file is another source of{" "}
        {workout ? <strong>{activityTitle(workout)}</strong> : "a workout"}
      </p>
      <p className="lede">
        {primary
          ? `${sourceLabel(primary)} stands for that workout`
          : "Another source stands for it"}{" "}
        in your activity list. This page shows what this file recorded.
      </p>
      <Link to="/activities/$id" params={{ id: primaryId }} className="secondary link-button">
        Open the workout
      </Link>
    </aside>
  );
}

interface Done {
  readonly message: string;
  readonly undo: WorkoutChange | null;
  readonly open?: string;
}

export function Sources({ activity, title }: { activity: ActivityDetail; title: string }) {
  const sources = sourcesOf(activity);
  const [done, setDone] = useState<Done | null>(null);
  const [linking, setLinking] = useState(false);
  const status = useRef<HTMLDivElement>(null);

  const change = useMutation({
    mutationFn: async ({ change }: { change: WorkoutChange; done: Done }) => {
      await applyChange(api, change);
      await refreshWorkouts();
    },
    onMutate: () => setDone(null),
    onSuccess: (_, { done }) => {
      setDone(done);
      status.current?.focus();
    },
  });

  const run = (next: WorkoutChange, message: string, open?: string) =>
    change.mutate({ change: next, done: { message, undo: undoOf(next), open } });

  const undo = (last: WorkoutChange) =>
    change.mutate({ change: last, done: { message: "Undone.", undo: null } });

  const many = sources.length > 1;
  const primary = sources.find((source) => source.primary);

  return (
    <section aria-labelledby="sources" className="sources">
      <h2 id="sources" className="section-title">
        Sources
      </h2>
      <p className="lede sources-lede">
        {many
          ? "This workout was recorded more than once. The primary source gives it its place and numbers in your activity list. Every source keeps its own file."
          : "This workout has one source. If a watch or another app recorded it too, uploading that file links it here, or you can link one by hand."}
      </p>
      <ol className="source-list">
        {sources.map((source) => (
          <li key={source.id}>
            <SourceRow
              source={source}
              title={title}
              many={many}
              busy={change.isPending}
              onMakePrimary={() =>
                primary &&
                run(
                  { kind: "makePrimary", id: source.id, previous: primary.id },
                  `${sourceLabel(source)} is now the primary source of this workout.`,
                )
              }
              onUnlink={() => {
                const from = sources.find((other) => other.id !== source.id);
                if (!from) return;
                run(
                  { kind: "unlink", id: source.id, from: from.id },
                  source.current
                    ? "This file is now a workout of its own."
                    : `${sourceLabel(source)} is now a workout of its own.`,
                  source.current ? undefined : source.id,
                );
              }}
            />
          </li>
        ))}
      </ol>
      <div className="sources-foot">
        <button
          type="button"
          className="secondary"
          onClick={() => setLinking(true)}
          disabled={change.isPending}
        >
          <LinkIcon />
          Link another activity
        </button>
        <div ref={status} tabIndex={-1} className="sources-status" role="status">
          {change.isPending && <span className="muted">Saving…</span>}
          {change.isError && <span className="notice">That change was not saved. Try again.</span>}
          {done && (
            <>
              <span>{done.message}</span>
              {done.open && (
                <Link to="/activities/$id" params={{ id: done.open }} className="text-link">
                  Open it
                </Link>
              )}
              {done.undo && (
                <button
                  type="button"
                  className="quiet"
                  onClick={() => done.undo && undo(done.undo)}
                  disabled={change.isPending}
                >
                  Undo
                </button>
              )}
            </>
          )}
        </div>
      </div>
      <LinkDialog
        open={linking}
        onClose={() => setLinking(false)}
        activity={activity}
        onLink={(other) =>
          run(
            {
              kind: "link",
              id: activity.id,
              to: other.id,
              joining: membersOf(other),
            },
            `${activityTitle(other)} is now part of this workout.`,
          )
        }
      />
    </section>
  );
}

function SourceRow({
  source,
  title,
  many,
  busy,
  onMakePrimary,
  onUnlink,
}: {
  source: Source;
  title: string;
  many: boolean;
  busy: boolean;
  onMakePrimary: () => void;
  onUnlink: () => void;
}) {
  const label = sourceLabel(source);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const download = useMutation({
    mutationFn: () => api.activities.file({ id: source.id }),
    onMutate: () => setDownloadFailed(false),
    onError: () => setDownloadFailed(true),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = downloadName(source, `${title} ${label}`, source.startedAt);
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
  });

  return (
    <div className="source" aria-current={source.current && many ? "page" : undefined}>
      <div className="source-main">
        <p className="source-name">
          {label}
          {source.primary && many && <span className="badge primary-badge">Primary</span>}
          {source.current && many && <span className="badge">This page</span>}
        </p>
        <p className="source-meta">
          {source.startedAt && (
            <span>
              Started{" "}
              <time dateTime={source.startedAt.toISOString()}>
                {activityDate(source.startedAt)}
              </time>
            </span>
          )}
          {source.file ? (
            <span>
              {source.file.format.toUpperCase()}, {fileSize(source.file.size)}
            </span>
          ) : (
            <span>No file</span>
          )}
        </p>
        {downloadFailed && (
          <p role="alert" className="notice">
            The file did not download. Try again.
          </p>
        )}
      </div>
      <div className="source-actions">
        {!source.current && (
          <Link
            to="/activities/$id"
            params={{ id: source.id }}
            className="secondary link-button compact"
          >
            Open<span className="visually-hidden"> {label}</span>
          </Link>
        )}
        {source.file && (
          <button
            type="button"
            className="secondary compact"
            onClick={() => download.mutate()}
            disabled={download.isPending}
          >
            {download.isPending ? "Downloading…" : `Download .${source.file.format}`}
            <span className="visually-hidden"> from {label}</span>
          </button>
        )}
        {many && !source.primary && (
          <button type="button" className="quiet" onClick={onMakePrimary} disabled={busy}>
            Make primary<span className="visually-hidden"> {label}</span>
          </button>
        )}
        {many && !(source.current && source.primary) && (
          <button type="button" className="quiet" onClick={onUnlink} disabled={busy}>
            Not the same workout<span className="visually-hidden">: separate {label}</span>
          </button>
        )}
      </div>
    </div>
  );
}

function LinkDialog({
  open,
  onClose,
  activity,
  onLink,
}: {
  open: boolean;
  onClose: () => void;
  activity: ActivityDetail;
  onLink: (other: Activity) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search);
  const searchId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (open && element && !element.open) element.showModal();
  }, [open]);

  const pages = useInfiniteQuery({
    queryKey: linkCandidatesKey,
    queryFn: ({ pageParam }) =>
      api.activities.list({ limit: LINK_PAGE_SIZE, cursor: pageParam, onePerWorkout: true }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: open,
    staleTime: 0,
  });

  const loaded = pages.data?.pages.flatMap((page) => page.activities) ?? [];
  const candidates = linkCandidates(activity, loaded, deferredSearch, pages.hasNextPage);

  useEffect(() => {
    if (open && !candidates.reachedNear && pages.hasNextPage && !pages.isFetching) {
      void pages.fetchNextPage();
    }
  }, [open, candidates.reachedNear, pages]);

  const shown = candidates.matches ?? candidates.near;
  const choice = loaded.find((other) => other.id === picked) ?? null;

  const close = () => dialog.current?.close();

  return (
    <dialog
      ref={dialog}
      className="confirm link-dialog"
      aria-labelledby="link-title"
      onClose={() => {
        setSearch("");
        setPicked(null);
        onClose();
      }}
    >
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (!choice) return;
          onLink(choice);
          close();
        }}
      >
        <h2 id="link-title">Link another activity</h2>
        <p className="lede">
          Pick the same workout recorded somewhere else, such as a watch file with a wrong clock.
          They become one workout, and you can separate them again.
        </p>
        <label className="search" htmlFor={searchId}>
          <span className="visually-hidden">Search your activities</span>
          <input
            id={searchId}
            type="search"
            placeholder="Search by name, sport or date"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            autoComplete="off"
          />
        </label>
        <fieldset className="candidates">
          <legend className="month-title">
            {candidates.matches === null
              ? "Near this activity in time"
              : `Activities matching “${deferredSearch.trim()}”`}
          </legend>
          {pages.isError ? (
            <p className="notice">Your activities did not load. Close this and try again.</p>
          ) : shown.length === 0 ? (
            <p className="lede">
              {pages.isPending || (!candidates.reachedNear && candidates.matches === null)
                ? "Looking…"
                : candidates.matches === null
                  ? "Nothing else was recorded within a day of this activity. Search for the one you mean."
                  : "No loaded activity matches."}
            </p>
          ) : (
            <ol className="candidate-list">
              {shown.slice(0, 30).map((other) => (
                <li key={other.id}>
                  <Candidate
                    activity={other}
                    checked={picked === other.id}
                    onPick={() => setPicked(other.id)}
                  />
                </li>
              ))}
            </ol>
          )}
          {pages.hasNextPage && candidates.reachedNear && (
            <button
              type="button"
              className="quiet"
              onClick={() => pages.fetchNextPage()}
              disabled={pages.isFetchingNextPage}
            >
              {pages.isFetchingNextPage ? "Loading…" : "Look further back"}
            </button>
          )}
        </fieldset>
        <p className="lede link-summary" aria-live="polite">
          {choice
            ? `${activityTitle(choice)} becomes part of this workout. The richer recording becomes primary unless you chose one.`
            : "Pick an activity to link."}
        </p>
        <div className="confirm-actions">
          <button type="button" className="secondary" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!choice}>
            Link activities
          </button>
        </div>
      </form>
    </dialog>
  );
}

function Candidate({
  activity,
  checked,
  onPick,
}: {
  activity: Activity;
  checked: boolean;
  onPick: () => void;
}) {
  const sport = sportName(activity.sport, activity.indoor);
  const figures = headlineFigures(activity.statistics).slice(0, 2);
  const at = activity.startedAt ?? activity.createdAt;
  return (
    <label className="candidate">
      <input type="radio" name="link-to" checked={checked} onChange={onPick} />
      <span className="row-icon">
        <SportIcon family={sport.family} />
      </span>
      <span className="row-main">
        <span className="row-title">{activityTitle(activity)}</span>
        <span className="row-meta">
          <span>{sport.label}</span>
          <time dateTime={at.toISOString()}>{activityDate(at)}</time>
          {figures.map((figure) => (
            <span key={figure.name}>
              {figure.value}
              {figure.unit && ` ${figure.unit}`}
            </span>
          ))}
          <span>{sourceLabel(activity)}</span>
        </span>
      </span>
    </label>
  );
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M6.5 9.5 9.5 6.5M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
