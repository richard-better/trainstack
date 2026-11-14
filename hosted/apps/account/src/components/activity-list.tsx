import type { Activity } from "@trainstack/contract";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { activitiesQueryKey, api } from "../api";
import { ACTIVITIES_PER_PAGE } from "../lib/client";
import {
  analysisRefreshMs,
  analysisState,
  analysisUpdating,
  anyAnalysisDue,
} from "../lib/analysis";
import { activityWeeks, type WeekTotals } from "../lib/activity-weeks";
import { activityDate, weekLabel } from "../lib/dates";
import { localDay } from "../lib/settings";
import { activityTitle, sportName } from "../lib/sports";
import { formatDistance, formatHours, formatLoad, headlineFigures } from "../lib/statistics";
import { SportIcon } from "./sport-icon";
import { DropTarget, UploadButton, UploadList } from "./uploads";

export function ActivityList() {
  const activities = useInfiniteQuery({
    queryKey: activitiesQueryKey,
    queryFn: ({ pageParam }) =>
      api.activities.list({ limit: ACTIVITIES_PER_PAGE, cursor: pageParam, onePerWorkout: true }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: (query) =>
      analysisRefreshMs(
        query.state.data?.pages.some((page) => anyAnalysisDue(page.activities)) ?? false,
      ),
  });

  return (
    <main className="content">
      <DropTarget />
      <div className="page-head">
        <h1 className="page-title">Activities</h1>
        <UploadButton />
      </div>
      <UploadList />
      {activities.isPending ? (
        <ListSkeleton />
      ) : activities.data === undefined ? (
        <div className="state" role="alert">
          <p className="state-title">Your activities did not load.</p>
          <p className="lede">Check your connection and try again.</p>
          <button type="button" className="secondary" onClick={() => activities.refetch()}>
            Try again
          </button>
        </div>
      ) : activities.data.pages[0]?.activities.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <Weeks
            activities={activities.data.pages.flatMap((page) => page.activities)}
            hasMore={activities.hasNextPage}
          />
          {activities.hasNextPage && (
            <div className="more">
              <button
                type="button"
                className="secondary"
                onClick={() => activities.fetchNextPage()}
                disabled={activities.isFetchingNextPage}
              >
                {activities.isFetchingNextPage ? "Loading…" : "Show older activities"}
              </button>
              {activities.isFetchNextPageError && (
                <p role="alert" className="notice">
                  Older activities did not load. Try again.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </main>
  );
}

function Weeks({ activities, hasMore }: { activities: Activity[]; hasMore: boolean }) {
  const today = localDay(new Date());
  return activityWeeks(activities, hasMore).map((week) => (
    <section key={week.id} className="week" aria-labelledby={`week-${week.id}`}>
      <div className="week-head">
        <h2 id={`week-${week.id}`} className="month-title">
          {weekLabel(week.id, today)}
        </h2>
        {week.complete && <Totals totals={week.totals} />}
      </div>
      <ol className="rows">
        {week.items.map((activity) => (
          <li key={activity.id}>
            <ActivityRow activity={activity} />
          </li>
        ))}
      </ol>
    </section>
  ));
}

function Totals({ totals }: { totals: WeekTotals }) {
  const distance = formatDistance(totals.metres);
  return (
    <dl className="week-totals" aria-label="Week totals">
      <div>
        <dt>Time</dt>
        <dd>{formatHours(totals.seconds)}</dd>
      </div>
      {totals.metres > 0 && (
        <div>
          <dt>Distance</dt>
          <dd>
            {distance.value} <span className="unit">{distance.unit}</span>
          </dd>
        </div>
      )}
      {(totals.scored > 0 || totals.pending > 0) && (
        <div>
          <dt>Load</dt>
          <dd title={totals.pending > 0 ? "Some activities are still being analysed" : undefined}>
            {formatLoad(totals.load)}
            {totals.pending > 0 && <span className="unit"> so far</span>}
          </dd>
        </div>
      )}
    </dl>
  );
}

function ActivityRow({ activity }: { activity: Activity }) {
  const sport = sportName(activity.sport, activity.indoor);
  const figures = headlineFigures(activity.statistics);
  const load = activity.statistics.load_tss;
  const analysing = analysisState(activity).kind === "pending";
  const updating = analysisUpdating(activity);
  return (
    <Link to="/activities/$id" params={{ id: activity.id }} className="row">
      <span className="row-icon" title={sport.label}>
        <SportIcon family={sport.family} />
      </span>
      <span className="row-main">
        <span className="row-title">{activityTitle(activity)}</span>
        <span className="row-meta">
          <span>{sport.label}</span>
          <time dateTime={(activity.startedAt ?? activity.createdAt).toISOString()}>
            {activityDate(activity.startedAt ?? activity.createdAt)}
          </time>
          {activity.duplicates.length > 0 && (
            <span className="row-sources">
              <SourcesIcon />
              {activity.duplicates.length + 1} sources
            </span>
          )}
        </span>
      </span>
      {(figures.length > 0 || load !== undefined || analysing || updating) && (
        <dl className="row-figures">
          {figures.map((figure) => (
            <div key={figure.name}>
              <dt>{figure.label}</dt>
              <dd>
                {figure.value}
                {figure.unit && <span className="unit"> {figure.unit}</span>}
              </dd>
            </div>
          ))}
          {load !== undefined ? (
            <div>
              <dt>Load</dt>
              <dd>
                {formatLoad(load)}
                {updating && <span className="unit"> updating</span>}
              </dd>
            </div>
          ) : (
            (analysing || updating) && (
              <div>
                <dt>Load</dt>
                <dd className="analysing">{analysing ? "Analysing" : "Updating"}</dd>
              </div>
            )
          )}
        </dl>
      )}
    </Link>
  );
}

function SourcesIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3.5 5.5h7v7h-7Z M6 3.5h6.5V10" />
    </svg>
  );
}

function ListSkeleton() {
  return (
    <ol className="rows" aria-busy="true" aria-label="Loading activities">
      {[0, 1, 2, 3].map((index) => (
        <li key={index} className="row skeleton">
          <span className="row-icon" />
          <span className="row-main">
            <span className="bar" style={{ width: "40%" }} />
            <span className="bar" style={{ width: "25%" }} />
          </span>
        </li>
      ))}
    </ol>
  );
}

function EmptyState() {
  return (
    <div className="state empty">
      <p className="state-title">No activities yet</p>
      <p className="lede">
        Upload FIT, GPX or TCX files from your watch, bike computer or another app, or drop them
        anywhere on this page. Rides you record in Ride show up here when Ride is signed in with the
        same Apple ID.
      </p>
      <a className="secondary link-button" href="https://trainstackhq.com/ride">
        Get Ride
      </a>
    </div>
  );
}
