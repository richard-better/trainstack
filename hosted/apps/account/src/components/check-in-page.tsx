import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { api } from "../api";
import {
  dayHeading,
  type HistoryRangeKey,
  historyDays,
  historyRangeDays,
  historyRangeKeys,
  historyRangeLabels,
  summaryWords,
} from "../lib/check-in";
import { formatDay } from "../lib/settings";
import { todayIn } from "../lib/time-zone";
import { loadQueryKey, shiftDay } from "../lib/training";
import { CheckInForm } from "./check-in-form";
import { useCheckInOn, useCheckIns } from "./check-in-data";
import { CheckInHistory } from "./check-in-history";
import { PeriodPicker } from "./period-picker";
import { useAthleteSettings } from "./time-zone";

const LIST_SHOWN = 14;

export function CheckInPage({ day, range }: { day?: string; range: HistoryRangeKey }) {
  const settings = useAthleteSettings();
  const today = todayIn(settings.data?.timeZone ?? null);
  const shown = day && day < today ? day : today;
  const ready = !settings.isPending;

  return (
    <main className="content check-in-page">
      <div className="page-head">
        <h1 className="page-title">Check-in</h1>
      </div>
      {ready && <DayCheckIn day={shown} today={today} />}
      {ready && <History today={today} range={range} />}
    </main>
  );
}

function DayCheckIn({ day, today }: { day: string; today: string }) {
  const held = useCheckInOn(day);
  const heading = dayHeading(day, today);
  return (
    <section aria-labelledby="check-in-day" className="check-in-day">
      <div className="day-bar">
        <Link
          from="/check-in"
          to="/check-in"
          search={(search) => ({ ...search, day: shiftDay(day, -1) })}
          className="quiet link-button day-step"
          aria-label="The day before"
          replace
        >
          ‹
        </Link>
        <h2 id="check-in-day" className="day-heading">
          {heading.title}
          {heading.date && <span className="day-date">{heading.date}</span>}
        </h2>
        {day < today ? (
          <Link
            from="/check-in"
            to="/check-in"
            search={(search) => ({
              ...search,
              day: shiftDay(day, 1) === today ? undefined : shiftDay(day, 1),
            })}
            className="quiet link-button day-step"
            aria-label="The day after"
            replace
          >
            ›
          </Link>
        ) : (
          <span className="day-step" aria-hidden="true" />
        )}
      </div>
      {day !== today && (
        <p className="lede back-to-today">
          <Link
            from="/check-in"
            to="/check-in"
            search={(search) => ({ ...search, day: undefined })}
          >
            Back to today
          </Link>
        </p>
      )}
      {held.isError ? (
        <div className="state" role="alert">
          <p className="state-title">This day's check-in did not load.</p>
          <button type="button" className="secondary" onClick={() => held.refetch()}>
            Try again
          </button>
        </div>
      ) : held.checkIn === undefined ? (
        <div className="skeleton" aria-busy="true" aria-label="Loading the check-in">
          <span className="bar" style={{ width: "100%", height: 320 }} />
        </div>
      ) : (
        <CheckInForm key={day} day={day} held={held.checkIn} />
      )}
    </section>
  );
}

function History({ today, range }: { today: string; range: HistoryRangeKey }) {
  const navigate = useNavigate({ from: "/check-in" });
  const from = shiftDay(today, -(historyRangeDays[range] - 1));
  const checkIns = useCheckIns(from, today);
  const loadFrom = shiftDay(today, -(3 * 365 - 1));
  const load = useQuery({
    queryKey: loadQueryKey(loadFrom, today),
    queryFn: () => api.training.load({ from: loadFrom, through: today }),
  });
  const fatigueByDay = new Map((load.data?.days ?? []).map((entry) => [entry.day, entry.fatigue]));

  return (
    <section aria-labelledby="history-title" className="check-in-history-section">
      <div className="section-head">
        <h2 id="history-title" className="section-title">
          How you felt, beside your training
        </h2>
        <PeriodPicker
          label="Show the last"
          options={historyRangeKeys.map((key) => ({ key, label: historyRangeLabels[key] }))}
          value={range}
          onChange={(next) => navigate({ search: (s) => ({ ...s, range: next }), replace: true })}
        />
      </div>
      {checkIns.isError || load.isError ? (
        <div className="state" role="alert">
          <p className="state-title">Your history did not load.</p>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              void checkIns.refetch();
              void load.refetch();
            }}
          >
            Try again
          </button>
        </div>
      ) : checkIns.data === undefined || load.data === undefined ? (
        <div className="skeleton" aria-busy="true" aria-label="Loading your history">
          <span className="bar" style={{ width: "100%", height: 260 }} />
        </div>
      ) : checkIns.data.checkIns.length === 0 ? (
        <p className="lede history-empty">
          No check-ins in the last {historyRangeLabels[range]}. Each day you check in shows here,
          beside the fatigue from your training.
        </p>
      ) : (
        <>
          <CheckInHistory
            key={`${range} ${today}`}
            days={historyDays(from, today, fatigueByDay, checkIns.data.checkIns)}
          />
          <CheckInList checkIns={checkIns.data.checkIns} today={today} />
        </>
      )}
    </section>
  );
}

function CheckInList({
  checkIns,
  today,
}: {
  checkIns: NonNullable<ReturnType<typeof useCheckIns>["data"]>["checkIns"];
  today: string;
}) {
  const [all, setAll] = useState(false);
  const newest = checkIns.toReversed();
  const listed = all ? newest : newest.slice(0, LIST_SHOWN);
  return (
    <>
      <h3 className="group-title check-in-list-title">Your check-ins</h3>
      <ul className="check-in-list">
        {listed.map((checkIn) => (
          <li key={checkIn.day}>
            <Link
              from="/check-in"
              to="/check-in"
              search={(search) => ({
                ...search,
                day: checkIn.day === today ? undefined : checkIn.day,
              })}
              className="check-in-row"
            >
              <span className="check-in-row-day">{formatDay(checkIn.day)}</span>
              <span className="check-in-row-words">{summaryWords(checkIn).join(". ")}</span>
              {checkIn.note && <span className="check-in-row-note">{checkIn.note}</span>}
            </Link>
          </li>
        ))}
      </ul>
      {!all && newest.length > LIST_SHOWN && (
        <button type="button" className="secondary" onClick={() => setAll(true)}>
          Show all {newest.length}
        </button>
      )}
    </>
  );
}
