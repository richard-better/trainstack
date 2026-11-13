import type { Activity } from "@trainstack/contract";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { api } from "../api";
import { ACTIVITIES_PER_PAGE } from "../lib/client";
import { activityDate, monthOf } from "../lib/dates";
import { activityTitle, sportName } from "../lib/sports";
import { headlineFigures } from "../lib/statistics";
import { SportIcon } from "./sport-icon";

export const activitiesQueryKey = ["activities"] as const;

export function ActivityList() {
  const activities = useInfiniteQuery({
    queryKey: activitiesQueryKey,
    queryFn: ({ pageParam }) =>
      api.activities.list({ limit: ACTIVITIES_PER_PAGE, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

  return (
    <main className="content">
      <h1 className="page-title">Activities</h1>
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
          <Months activities={activities.data.pages.flatMap((page) => page.activities)} />
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

function Months({ activities }: { activities: Activity[] }) {
  const months: { label: string; activities: Activity[] }[] = [];
  for (const activity of activities) {
    const label = monthOf(activity.startedAt ?? activity.createdAt);
    const last = months.at(-1);
    if (last?.label === label) last.activities.push(activity);
    else months.push({ label, activities: [activity] });
  }
  return months.map((month) => (
    <section key={month.label} className="month" aria-labelledby={`month-${month.label}`}>
      <h2 id={`month-${month.label}`} className="month-title">
        {month.label}
      </h2>
      <ol className="rows">
        {month.activities.map((activity) => (
          <li key={activity.id}>
            <ActivityRow activity={activity} />
          </li>
        ))}
      </ol>
    </section>
  ));
}

function ActivityRow({ activity }: { activity: Activity }) {
  const sport = sportName(activity.sport);
  const figures = headlineFigures(activity.statistics);
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
        </span>
      </span>
      {figures.length > 0 && (
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
        </dl>
      )}
    </Link>
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
        Rides you record in Ride show up here when Ride is signed in with the same Apple ID.
      </p>
      <a className="secondary link-button" href="https://trainstackhq.com/ride">
        Get Ride
      </a>
    </div>
  );
}
