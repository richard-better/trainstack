import type { BuiltinWorkoutSummary, StoredWorkout, WorkoutSummary } from "@trainstack/contract";
import { type Focus, focusSchema, type Sport, sportSchema } from "@trainstack/workout";
import { Link, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";

import { type DurationBucket, durationBuckets } from "../lib/library";
import { sportName } from "../lib/sports";
import {
  focusNames,
  formatMinutes,
  formatMeters,
  overviewOf,
  type Reference,
  sportNames,
} from "../lib/workout-profile";
import { SportIcon } from "./sport-icon";
import { WorkoutThumb } from "./workout-chart";
import { useBuiltin, useBuiltins, useReference, useWorkoutSearch } from "./workout-data";
import { ImportButton, ImportDropTarget, ImportList, useWorkoutImports } from "./workout-imports";
import { ListsNav } from "./workout-lists";

export type LibrarySearch = {
  readonly in?: "mine" | "builtin" | undefined;
  readonly q?: string | undefined;
  readonly sport?: Sport | undefined;
  readonly focus?: Focus | undefined;
  readonly length?: DurationBucket | undefined;
  readonly sort?: "updated" | "name" | "duration" | "library" | undefined;
};

export function LibraryShell({
  current,
  actions,
  children,
}: {
  current: "mine" | "builtin" | string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="content library">
      <div className="library-layout">
        <nav className="library-nav" aria-label="Workout library">
          <Link
            to="/workouts"
            search={{}}
            className="library-link"
            aria-current={current === "mine" ? "page" : undefined}
          >
            Your workouts
          </Link>
          <Link
            to="/workouts"
            search={{ in: "builtin" }}
            className="library-link"
            aria-current={current === "builtin" ? "page" : undefined}
          >
            Built-in
          </Link>
          <ListsNav current={current} />
        </nav>
        <div className="library-main">
          {actions}
          {children}
        </div>
      </div>
    </main>
  );
}

export function WorkoutLibrary({ search }: { search: LibrarySearch }) {
  const imports = useWorkoutImports();
  const builtin = search.in === "builtin";
  return (
    <LibraryShell current={builtin ? "builtin" : "mine"}>
      <ImportDropTarget imports={imports} />
      <div className="page-head">
        <h1 className="page-title">{builtin ? "Built-in workouts" : "Workouts"}</h1>
        <div className="page-actions">
          <ImportButton imports={imports} />
        </div>
      </div>
      <ImportList imports={imports} />
      <FilterBar search={search} />
      {builtin ? <BuiltinResults search={search} /> : <OwnResults search={search} />}
    </LibraryShell>
  );
}

function useSearchText(initial: string | undefined, apply: (text: string | undefined) => void) {
  const [text, setText] = useState(initial ?? "");
  useEffect(() => setText(initial ?? ""), [initial]);
  useEffect(() => {
    const trimmed = text.trim() || undefined;
    if (trimmed === (initial?.trim() || undefined)) return;
    const timer = setTimeout(() => apply(trimmed), 250);
    return () => clearTimeout(timer);
  }, [text, initial, apply]);
  return [text, setText] as const;
}

function FilterBar({ search }: { search: LibrarySearch }) {
  const navigate = useNavigate({ from: "/workouts/" });
  const builtin = search.in === "builtin";
  const set = (patch: Partial<LibrarySearch>) =>
    void navigate({ search: (previous) => ({ ...previous, ...patch }), replace: true });
  const [text, setText] = useSearchText(search.q, (q) => set({ q }));
  const sorts = builtin
    ? ([
        ["library", "Library order"],
        ["name", "Name"],
        ["duration", "Shortest first"],
      ] as const)
    : ([
        ["updated", "Latest edit"],
        ["name", "Name"],
        ["duration", "Shortest first"],
      ] as const);
  const filtered = Boolean(search.q || search.sport || search.focus || search.length);
  return (
    <div className="filter-bar" role="search">
      <label className="search-field">
        <span className="visually-hidden">Search workouts</span>
        <SearchIcon />
        <input
          type="search"
          value={text}
          placeholder="Search by name, description or tag"
          onChange={(event) => setText(event.currentTarget.value)}
        />
      </label>
      <div className="filters">
        <Choice
          label="Sport"
          value={search.sport}
          any="All sports"
          options={sportSchema.options.map((sport) => [sport, sportNames[sport]])}
          onChange={(sport) => set({ sport: sport as Sport | undefined })}
        />
        <Choice
          label="Focus"
          value={search.focus}
          any="Any focus"
          options={focusSchema.options.map((focus) => [focus, focusNames[focus]])}
          onChange={(focus) => set({ focus: focus as Focus | undefined })}
        />
        <Choice
          label="Duration"
          value={search.length}
          any="Any duration"
          options={Object.entries(durationBuckets).map(([key, bucket]) => [key, bucket.label])}
          onChange={(length) => set({ length: length as DurationBucket | undefined })}
        />
        <Choice
          label="Sort"
          value={search.sort ?? sorts[0][0]}
          options={sorts}
          onChange={(sort) =>
            set({ sort: sort === sorts[0][0] ? undefined : (sort as LibrarySearch["sort"]) })
          }
        />
        {filtered && (
          <button
            type="button"
            className="quiet compact"
            onClick={() => {
              setText("");
              set({ q: undefined, sport: undefined, focus: undefined, length: undefined });
            }}
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}

function Choice({
  label,
  value,
  any,
  options,
  onChange,
}: {
  label: string;
  value: string | undefined;
  any?: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string | undefined) => void;
}) {
  return (
    <label className="choice">
      <span className="visually-hidden">{label}</span>
      <select
        value={value ?? ""}
        data-set={value !== undefined && any !== undefined ? true : undefined}
        onChange={(event) => onChange(event.currentTarget.value || undefined)}
      >
        {any !== undefined && <option value="">{any}</option>}
        {options.map(([key, name]) => (
          <option key={key} value={key}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}

function OwnResults({ search }: { search: LibrarySearch }) {
  const sort = search.sort === "library" ? "updated" : (search.sort ?? "updated");
  const {
    search: results,
    summaries,
    library,
  } = useWorkoutSearch(
    { query: search.q, sport: search.sport, focus: search.focus, length: search.length },
    sort,
  );
  const filtered = Boolean(search.q || search.sport || search.focus || search.length);

  if (results.isPending) return <RowsSkeleton />;
  if (results.isError && !results.data) {
    return (
      <div className="state" role="alert">
        <p className="state-title">Your workouts did not load.</p>
        <p className="lede">Check your connection and try again.</p>
        <button type="button" className="secondary" onClick={() => results.refetch()}>
          Try again
        </button>
      </div>
    );
  }
  if (summaries.length === 0) {
    return filtered ? (
      <div className="state empty">
        <p className="state-title">No workouts match.</p>
        <p className="lede">Try other words, or clear the filters.</p>
      </div>
    ) : (
      <div className="state empty">
        <p className="state-title">No workouts yet</p>
        <p className="lede">
          Import .zwo, .erg or .mrc files, drop them anywhere on this page, or copy one of the
          built-in workouts to make it your own.
        </p>
        <Link to="/workouts" search={{ in: "builtin" }} className="secondary link-button">
          See built-in workouts
        </Link>
      </div>
    );
  }
  return (
    <>
      <ol className="rows workout-rows">
        {summaries.map((summary) => (
          <li key={summary.id}>
            <OwnRow summary={summary} stored={library.data?.workouts[summary.id]} />
          </li>
        ))}
      </ol>
      {results.hasNextPage && (
        <div className="more">
          <button
            type="button"
            className="secondary"
            onClick={() => results.fetchNextPage()}
            disabled={results.isFetchingNextPage}
          >
            {results.isFetchingNextPage ? "Loading…" : "Show more workouts"}
          </button>
          {results.isFetchNextPageError && (
            <p role="alert" className="notice">
              More workouts did not load. Try again.
            </p>
          )}
        </div>
      )}
    </>
  );
}

export function OwnRow({
  summary,
  stored,
}: {
  summary: WorkoutSummary;
  stored: StoredWorkout | undefined;
}) {
  return (
    <Link to="/workouts/$id" params={{ id: summary.id }} className="row workout-row">
      <RowBody summary={summary} workout={stored?.workout} />
    </Link>
  );
}

function BuiltinResults({ search }: { search: LibrarySearch }) {
  const sort = search.sort === "updated" ? "library" : (search.sort ?? "library");
  const builtins = useBuiltins(
    { query: search.q, sport: search.sport, focus: search.focus, length: search.length },
    sort,
  );
  if (builtins.isPending) return <RowsSkeleton />;
  if (builtins.isError) {
    return (
      <div className="state" role="alert">
        <p className="state-title">The built-in workouts did not load.</p>
        <button type="button" className="secondary" onClick={() => builtins.refetch()}>
          Try again
        </button>
      </div>
    );
  }
  if (builtins.data.workouts.length === 0) {
    return (
      <div className="state empty">
        <p className="state-title">No built-in workouts match.</p>
        <p className="lede">Try other words, or clear the filters.</p>
      </div>
    );
  }
  return (
    <ol className="rows workout-rows">
      {builtins.data.workouts.map((summary) => (
        <li key={summary.id}>
          <BuiltinRow summary={summary} />
        </li>
      ))}
    </ol>
  );
}

function BuiltinRow({ summary }: { summary: BuiltinWorkoutSummary }) {
  const full = useBuiltin(summary.id);
  return (
    <Link to="/workouts/builtin/$id" params={{ id: summary.id }} className="row workout-row">
      <RowBody summary={summary} workout={full.data?.workout} />
    </Link>
  );
}

type Summary = Pick<WorkoutSummary, "name" | "sport" | "focus" | "totals" | "author">;

function RowBody({
  summary,
  workout,
}: {
  summary: Summary;
  workout: StoredWorkout["workout"] | undefined;
}) {
  const { reference } = useReference(summary.sport);
  return (
    <>
      <span className="workout-row-profile">
        {workout ? (
          <WorkoutThumb overview={overviewOf(workout, reference)} />
        ) : (
          <span className="thumb-placeholder" />
        )}
      </span>
      <span className="row-main">
        <span className="row-title">{summary.name}</span>
        <span className="row-meta">
          <span className="row-sport">
            <SportIcon family={sportName(summary.sport).family} />
            {sportNames[summary.sport]}
          </span>
          {summary.focus && <span>{focusNames[summary.focus]}</span>}
          {summary.author && <span>{summary.author}</span>}
        </span>
      </span>
      <RowFigures summary={summary} workout={workout} reference={reference} />
    </>
  );
}

function RowFigures({
  summary,
  workout,
  reference,
}: {
  summary: Summary;
  workout: StoredWorkout["workout"] | undefined;
  reference: Reference;
}) {
  const overview = workout ? overviewOf(workout, reference) : null;
  const seconds = overview?.seconds ?? summary.totals.seconds;
  const estimated = overview?.estimated ?? summary.totals.meters > 0;
  return (
    <dl className="row-figures">
      <div>
        <dt>Duration</dt>
        <dd>
          {estimated && "~"}
          {formatMinutes(seconds)}
        </dd>
      </div>
      {summary.totals.meters > 0 ? (
        <div>
          <dt>Distance</dt>
          <dd>{formatMeters(summary.totals.meters)}</dd>
        </div>
      ) : (
        <div>
          <dt>Load</dt>
          <dd>{overview?.load ? overview.load.score : "-"}</dd>
        </div>
      )}
    </dl>
  );
}

export function RowsSkeleton() {
  return (
    <ol className="rows" aria-busy="true" aria-label="Loading workouts">
      {[0, 1, 2, 3].map((index) => (
        <li key={index} className="row workout-row skeleton">
          <span className="thumb-placeholder" />
          <span className="row-main">
            <span className="bar" style={{ width: "40%" }} />
            <span className="bar" style={{ width: "25%" }} />
          </span>
        </li>
      ))}
    </ol>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M7 12.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11Zm4-1.5 3.5 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
