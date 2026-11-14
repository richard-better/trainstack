import type { PlannedWorkout } from "@trainstack/contract";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { dayInFull, plannedName } from "../lib/calendar";
import { summaryWords } from "../lib/check-in";
import {
  actionWords,
  type DayReadiness,
  easySwapFor,
  intensityWords,
  isAnswered,
  type ReadinessSuggestion,
  restFrom,
  swapForEasy,
} from "../lib/readiness";
import { formatHours, formatLoad } from "../lib/statistics";
import { todayIn } from "../lib/time-zone";
import { calendarWrites, useCalendar } from "./calendar-data";
import { Notices } from "./calendar-page";
import { CheckInForm } from "./check-in-form";
import { useCheckInOn } from "./check-in-data";
import { ReadinessSummary, useReadiness } from "./readiness";
import { useAthleteSettings } from "./time-zone";

export function TodayPage() {
  const settings = useAthleteSettings();
  const today = todayIn(settings.data?.timeZone ?? null);
  const ready = settings.data !== undefined;
  const readiness = useReadiness(today, today, { enabled: ready });
  const day = readiness.data?.days.find((entry) => entry.day === today) ?? null;
  const checkIn = useCheckInOn(today, { enabled: ready });

  return (
    <main className="content today">
      <div className="page-head">
        <h1 className="page-title">Today</h1>
        {ready && <p className="today-date">{dayInFull(today)}</p>}
      </div>
      <Notices />
      <div className="today-grid">
        <div className="today-readiness">
          {settings.isError && !ready ? (
            <div className="state" role="alert">
              <p className="state-title">Your settings did not load, so today is not known.</p>
              <button type="button" className="secondary" onClick={() => settings.refetch()}>
                Try again
              </button>
            </div>
          ) : readiness.isError ? (
            <div className="state" role="alert">
              <p className="state-title">Readiness did not load.</p>
              <button type="button" className="secondary" onClick={() => readiness.refetch()}>
                Try again
              </button>
            </div>
          ) : day ? (
            <ReadinessSummary readiness={day} />
          ) : (
            <div className="skeleton" aria-busy="true" aria-label="Loading readiness">
              <span className="bar" style={{ width: "100%", height: 220 }} />
            </div>
          )}
        </div>
        {ready && <PlannedToday today={today} readiness={day} />}
        {ready && checkIn.isError && checkIn.checkIn === undefined && (
          <section className="today-check-in state" role="alert">
            <p className="state-title">Today's check-in did not load.</p>
            <button type="button" className="secondary" onClick={() => checkIn.refetch()}>
              Try again
            </button>
          </section>
        )}
        {ready && checkIn.checkIn !== undefined && (
          <section className="today-check-in" aria-labelledby="today-check-in-title">
            {checkIn.checkIn === null || !isAnswered(checkIn.checkIn) ? (
              <>
                <h2 id="today-check-in-title" className="today-heading">
                  How do you feel today?
                </h2>
                <p className="lede">Your answers sharpen today's readiness.</p>
                <CheckInForm day={today} held={checkIn.checkIn} />
              </>
            ) : (
              <div className="today-checked-in">
                <h2 id="today-check-in-title" className="today-heading">
                  Checked in
                </h2>
                <p className="muted">{summaryWords(checkIn.checkIn).join(". ")}</p>
                <Link to="/check-in" className="quiet link-button compact">
                  Edit
                </Link>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}

function PlannedToday({ today, readiness }: { today: string; readiness: DayReadiness | null }) {
  const { query, range } = useCalendar({ from: today, through: today });
  const planned = range?.days.find((entry) => entry.day === today)?.planned ?? [];
  const suggestionOf = new Map(
    (readiness?.suggestions ?? []).map((suggestion) => [suggestion.plannedId, suggestion]),
  );
  return (
    <section className="today-plan" aria-labelledby="today-plan-title">
      <h2 id="today-plan-title" className="today-heading">
        Planned today
      </h2>
      {query.isError ? (
        <div className="state" role="alert">
          <p className="state-title">Today's plan did not load.</p>
          <button type="button" className="secondary" onClick={() => query.refetch()}>
            Try again
          </button>
        </div>
      ) : !range ? (
        <div className="skeleton" aria-busy="true" aria-label="Loading today's plan">
          <span className="bar" style={{ width: "100%", height: 120 }} />
        </div>
      ) : planned.length === 0 ? (
        <div className="today-empty">
          <p className="muted">Nothing planned today.</p>
          <Link to="/calendar" search={{ view: "week" }} className="secondary link-button compact">
            Plan in the calendar
          </Link>
        </div>
      ) : (
        <ul className="today-sessions">
          {planned.map((item) => (
            <Session
              key={item.id}
              item={item}
              day={planned}
              today={today}
              readiness={readiness}
              suggestion={suggestionOf.get(item.id) ?? null}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function Session({
  item,
  day,
  today,
  readiness,
  suggestion,
}: {
  item: PlannedWorkout;
  day: readonly PlannedWorkout[];
  today: string;
  readiness: DayReadiness | null;
  suggestion: ReadinessSuggestion | null;
}) {
  const [busy, setBusy] = useState(false);
  const figures = [
    item.planned?.seconds != null ? formatHours(item.planned.seconds) : null,
    item.planned?.load != null ? `${formatLoad(item.planned.load)} load` : null,
    suggestion ? intensityWords[suggestion.intensity] : null,
  ].filter((figure) => figure !== null);
  const state =
    item.state === "skipped"
      ? item.skipped?.reason
        ? `Skipped: ${item.skipped.reason}`
        : "Skipped"
      : item.state === "completed"
        ? "Done"
        : null;
  const pending = calendarWrites.isPending(item.id);

  async function act(write: () => Promise<unknown>) {
    setBusy(true);
    try {
      await write();
    } finally {
      setBusy(false);
    }
  }

  function swap() {
    void act(() => swapForEasy(calendarWrites, item, day, today));
  }

  function rest() {
    if (!readiness) return;
    void act(() => restFrom(calendarWrites, item, readiness));
  }

  const action = suggestion && actionWords[suggestion.action];
  return (
    <li className="today-session" data-state={item.state} data-action={suggestion?.action}>
      <div className="today-session-head">
        <Link to="/calendar/planned/$id" params={{ id: item.id }} className="today-session-name">
          {plannedName(item.content)}
        </Link>
        {figures.length > 0 && <p className="today-session-figures muted">{figures.join(", ")}</p>}
        {state && <p className="today-session-state">{state}</p>}
      </div>
      {action && suggestion && item.state === "planned" && (
        <div className="today-suggestion">
          <p className="today-suggestion-title">
            <span className="visually-hidden">Suggestion: </span>
            {action.title}
          </p>
          <p className="today-suggestion-line">{action.line}</p>
          {suggestion.action !== "as_planned" && (
            <div className="today-suggestion-actions">
              {suggestion.action === "ease" && (
                <Link
                  to="/calendar/planned/$id/edit"
                  params={{ id: item.id }}
                  className="secondary link-button compact"
                >
                  Edit the session
                </Link>
              )}
              {suggestion.action === "swap_easy" && easySwapFor(item) && (
                <button
                  type="button"
                  className="secondary compact"
                  onClick={swap}
                  disabled={busy || pending}
                >
                  Swap for an easy session
                </button>
              )}
              {(suggestion.action === "rest" || suggestion.action === "swap_easy") && (
                <button
                  type="button"
                  className={suggestion.action === "rest" ? "secondary compact" : "quiet compact"}
                  onClick={rest}
                  disabled={busy || pending}
                >
                  Skip it
                </button>
              )}
            </div>
          )}
          {suggestion.action !== "as_planned" && (
            <p className="today-suggestion-note muted">
              A suggestion: nothing changes unless you choose.
            </p>
          )}
        </div>
      )}
      {item.state === "skipped" && (
        <div className="today-suggestion-actions">
          <button
            type="button"
            className="quiet compact"
            onClick={() => void act(() => calendarWrites.skip(item, null))}
            disabled={busy || pending}
          >
            Undo skip
          </button>
        </div>
      )}
    </li>
  );
}
