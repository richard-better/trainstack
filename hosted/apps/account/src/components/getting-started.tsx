import type { SettingEntry } from "@trainstack/contract";
import { type Profile, profileOn } from "@trainstack/zones";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useState } from "react";

import { activitiesQueryKey, api } from "../api";
import { authClient } from "../auth";
import {
  awaitingDetection,
  historySources,
  historySourceStateWords,
  type HistorySource,
  type Onboarding,
  onboardingOf,
  type QuickField,
  quickFields,
  quickWrites,
  isNewAccount,
  showsGettingStarted,
  type StepState,
  type SuggestedThreshold,
} from "../lib/onboarding";
import { ANALYSIS_POLL_MS, ANALYSIS_REFRESH_MS } from "../lib/analysis";
import { datedChanges } from "../lib/settings";
import { todayIn } from "../lib/time-zone";
import { shiftDay } from "../lib/training";
import { useActivityPages } from "./activity-list";
import { useCalendar } from "./calendar-data";
import { HelpLink } from "./help-link";
import { SaveStatus, SettingsWriter, useSettingsHistory, useWriter } from "./settings-data";
import { ThresholdSuggestions, useThresholdSuggestions } from "./threshold-suggestions";
import { useAthleteSettings } from "./time-zone";
import { DropTarget, UploadButton, UploadList } from "./uploads";

const PLANNED_REACH_DAYS = 45;

interface OnboardingView {
  readonly today: string;
  readonly entries: SettingEntry[];
  readonly profile: Profile;
  readonly onboarding: Onboarding;
  readonly awaitingDetection: boolean;
}

interface OnboardingLoad {
  readonly view: OnboardingView | null;
  readonly failed: boolean;
  readonly retry: () => void;
}

function useOnboarding(): OnboardingLoad {
  const settings = useAthleteSettings();
  const today = todayIn(settings.data?.timeZone ?? null);
  const activities = useActivityPages();
  const history = useSettingsHistory();
  const { query: calendar, range } = useCalendar({
    from: shiftDay(today, -PLANNED_REACH_DAYS),
    through: shiftDay(today, PLANNED_REACH_DAYS),
  });
  const first = activities.data?.pages[0];
  const failing = [settings, activities, history, calendar].filter(
    (query) => query.isError && query.data === undefined,
  );
  const failed = failing.length > 0;
  const retry = () => {
    for (const query of failing) void query.refetch();
  };
  if (!settings.data || !first || !history.data || !range) return { view: null, failed, retry };
  const profile = profileOn(datedChanges(history.data.entries), today);
  const view: OnboardingView = {
    today,
    entries: history.data.entries,
    profile,
    awaitingDetection: awaitingDetection(first.activities, new Date()),
    onboarding: onboardingOf({
      activities: first.activities,
      moreActivities: first.nextCursor !== null,
      profile,
      planned: range.days.some((day) => day.planned.length > 0),
    }),
  };
  return { view, failed: false, retry };
}

function useAccountCreatedAt() {
  const { data } = authClient.useSession();
  const createdAt = data?.user.createdAt;
  return createdAt ? new Date(createdAt) : null;
}

const activityCount = ({ count, more }: Onboarding["history"]) =>
  more ? `${count} or more activities` : count === 1 ? "1 activity" : `${count} activities`;

function historyLine(onboarding: Onboarding) {
  return onboarding.history.state === "done"
    ? `${activityCount(onboarding.history)} in.`
    : "Upload files from your watch or bike computer, or sign Ride in. Analysis, load and threshold suggestions all start from them.";
}

function thresholdsLine(onboarding: Onboarding, suggested: number) {
  const { state, unscored } = onboarding.thresholds;
  if (state === "done") return "Set. Zones, load and compliance use them.";
  if (state === "waiting") return "Reading your activities. Suggestions follow in a minute or two.";
  if (onboarding.history.state === "open") {
    return "Trainstack suggests them from your efforts once your history is in, or type them now if you know them.";
  }
  const activities =
    unscored === 1 ? "One recent activity has" : `${unscored} recent activities have`;
  const suggestions =
    suggested === 0
      ? ""
      : suggested === 1
        ? " One is suggested from your efforts."
        : ` ${suggested} are suggested from your efforts.`;
  return `${activities} no load, or a rougher one, until they are set.${suggestions}`;
}

function planLine(onboarding: Onboarding) {
  return onboarding.plan.state === "done"
    ? "Something is on your calendar."
    : "Put a workout on the calendar, your own or a built-in one, and Today shows it on its day.";
}

const stepsDone = (onboarding: Onboarding) =>
  [onboarding.history, onboarding.thresholds, onboarding.plan].filter(
    (step) => step.state === "done",
  ).length;

export function GettingStarted() {
  const createdAt = useAccountCreatedAt();
  const young = isNewAccount(createdAt, new Date());
  const anyActivity = useQuery({
    queryKey: [...activitiesQueryKey, "any"],
    queryFn: () => api.activities.list({ limit: 1 }),
    enabled: !young,
  });
  if (!young && anyActivity.data?.activities.length !== 0) return null;
  return <Checklist createdAt={createdAt} />;
}

function Checklist({ createdAt }: { createdAt: Date | null }) {
  const { view } = useOnboarding();
  const suggestions = useThresholdSuggestions({
    refetchInterval: view?.awaitingDetection ? ANALYSIS_POLL_MS : false,
  });
  if (!view || !showsGettingStarted(view.onboarding, createdAt, new Date())) return null;
  const { onboarding } = view;
  return (
    <section className="getting-started" aria-labelledby="getting-started-title">
      <div className="getting-started-head">
        <h2 id="getting-started-title" className="today-heading">
          Getting started
        </h2>
        <p className="muted">{stepsDone(onboarding)} of 3 done</p>
      </div>
      <ol className="start-checklist">
        <ChecklistStep
          number={1}
          state={onboarding.history.state}
          title="Bring your history in"
          line={historyLine(onboarding)}
          hash="history"
        />
        <ChecklistStep
          number={2}
          state={onboarding.thresholds.state}
          title="Set your thresholds"
          line={thresholdsLine(onboarding, suggestions.data?.suggestions.length ?? 0)}
          hash="thresholds"
        />
        <ChecklistStep
          number={3}
          state={onboarding.plan.state}
          title="Plan a first workout"
          line={planLine(onboarding)}
          hash="plan"
        />
      </ol>
      <p className="muted getting-started-note">
        Each step is optional and can wait. This goes away once they are done.
      </p>
    </section>
  );
}

function StepMark({ number, state }: { number: number; state: StepState }) {
  return (
    <span className="step-mark" data-state={state} aria-hidden="true">
      {state === "done" ? <DoneIcon /> : number}
    </span>
  );
}

const stateWords: Record<StepState, string> = {
  done: "Done",
  open: "To do",
  waiting: "In progress",
};

function ChecklistStep({
  number,
  state,
  title,
  line,
  hash,
}: {
  number: number;
  state: StepState;
  title: string;
  line: string;
  hash: string;
}) {
  return (
    <li className="start-check" data-state={state}>
      <Link to="/start" hash={hash} className="start-check-link">
        <StepMark number={number} state={state} />
        <span className="start-check-text">
          <span className="start-check-title">
            <span className="visually-hidden">{stateWords[state]}: </span>
            {title}
          </span>
          <span className="start-check-line">{line}</span>
        </span>
        <ArrowIcon />
      </Link>
    </li>
  );
}

export function StartPage() {
  const { view, failed, retry } = useOnboarding();
  return (
    <main className="content start">
      <DropTarget />
      <div className="page-head">
        <h1 className="page-title">Getting started</h1>
      </div>
      <p className="lede start-intro">
        {view?.onboarding.done
          ? "All three steps are done. Everything here stays at hand if you want to add more."
          : "Three steps from a new account to one that knows your training. Do them in any order, skip any of them, and come back here from Today whenever you like."}
      </p>
      {view === null && failed ? (
        <div className="state" role="alert">
          <p className="state-title">Getting started did not load.</p>
          <p className="lede">Check your connection and try again.</p>
          <button type="button" className="secondary" onClick={retry}>
            Try again
          </button>
        </div>
      ) : view === null ? (
        <div className="skeleton start-skeleton" aria-busy="true" aria-label="Loading">
          <span className="bar" style={{ width: "50%" }} />
          <span className="bar tall" style={{ width: "80%" }} />
          <span className="bar tall" style={{ width: "70%" }} />
        </div>
      ) : (
        <>
          <HistoryStep onboarding={view.onboarding} />
          <ThresholdsStep view={view} />
          <PlanStep onboarding={view.onboarding} />
        </>
      )}
      <p className="lede start-help">
        <HelpLink topic="getting-started">More about getting started</HelpLink>
      </p>
    </main>
  );
}

function StepSection({
  id,
  number,
  state,
  title,
  children,
}: {
  id: string;
  number: number;
  state: StepState;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="start-step" data-state={state} aria-labelledby={`${id}-title`}>
      <div className="start-step-head">
        <StepMark number={number} state={state} />
        <h2 id={`${id}-title`} className="start-step-title">
          {title}
        </h2>
        <span className="start-step-state">{stateWords[state]}</span>
      </div>
      <div className="start-step-body">{children}</div>
    </section>
  );
}

function HistoryStep({ onboarding }: { onboarding: Onboarding }) {
  const done = onboarding.history.state === "done";
  return (
    <StepSection
      id="history"
      number={1}
      state={onboarding.history.state}
      title="Bring your history in"
    >
      <p className="lede">
        {done ? (
          <>
            {activityCount(onboarding.history)} in.{" "}
            <Link to="/activities" className="text-link">
              See them on Activities
            </Link>
            , and add more here or there whenever you like.
          </>
        ) : (
          "Your past training is what Trainstack learns from: load, fitness, bests and threshold suggestions all come from it. The more of it you bring, the better they are from day one."
        )}
      </p>
      <ul className="history-sources">
        {historySources.map((source) => (
          <SourceRow key={source.id} source={source} />
        ))}
      </ul>
      <UploadList />
      <p className="lede">
        <HelpLink topic="add-activities">Where to find your files, and which ones work</HelpLink>
      </p>
    </StepSection>
  );
}

function SourceRow({ source }: { source: HistorySource }) {
  return (
    <li className="history-source" data-state={source.state}>
      <div className="setting-text">
        <p className="setting-name">
          {source.name}
          <span className="badge">{historySourceStateWords[source.state]}</span>
        </p>
        <p className="setting-help">{source.detail}</p>
      </div>
      {source.action?.kind === "upload" ? (
        <UploadButton />
      ) : source.action?.kind === "link" ? (
        <a className="secondary link-button" href={source.action.href}>
          {source.action.label}
        </a>
      ) : null}
    </li>
  );
}

const losses: readonly { readonly what: string; readonly why: string }[] = [
  {
    what: "Zones",
    why: "time in zones and the targets in your workouts have nothing to be measured against",
  },
  {
    what: "Load",
    why: "rides and runs get no load, or a rougher one from heart rate, so fitness, fatigue and form miss them",
  },
  {
    what: "Compliance",
    why: "a planned workout's targets cannot be checked against what you did",
  },
  {
    what: "Readiness",
    why: "it reads your recent load, so it starts from less",
  },
];

function ThresholdsStep({ view }: { view: OnboardingView }) {
  const { onboarding } = view;
  const stillLooking =
    onboarding.thresholds.state !== "done" && onboarding.history.state === "done";
  const suggestions = useThresholdSuggestions({
    refetchInterval: view.awaitingDetection
      ? ANALYSIS_POLL_MS
      : stillLooking
        ? ANALYSIS_REFRESH_MS
        : false,
  });
  const found = suggestions.data?.suggestions ?? [];
  const { state } = onboarding.thresholds;
  return (
    <StepSection id="thresholds" number={2} state={state} title="Set your thresholds">
      {state === "done" ? (
        <p className="lede">
          Set. Zones, load, compliance and readiness measure your efforts against them.
        </p>
      ) : (
        <>
          <p className="lede">
            Trainstack measures every effort against your thresholds. Without them:
          </p>
          <ul className="start-losses">
            {losses.map(({ what, why }) => (
              <li key={what}>
                <strong>{what}</strong>: {why}.
              </li>
            ))}
          </ul>
        </>
      )}
      {state === "waiting" && (
        <p className="lede" role="status">
          Reading your activities. Suggestions from your hardest efforts follow in a minute or two.
        </p>
      )}
      {found.length > 0 ? (
        <div className="start-suggestions">
          <h3 className="group-title">From your activities</h3>
          <ThresholdSuggestions suggestions={found} />
        </div>
      ) : (
        state === "open" &&
        onboarding.history.state === "done" &&
        suggestions.data &&
        (view.awaitingDetection ? (
          <p className="lede" role="status">
            Looking through your efforts for thresholds to suggest.
          </p>
        ) : (
          <p className="lede">
            None of your activities has an effort hard enough to read a threshold from. Enter the
            ones you know below; after your next hard effort, Trainstack suggests them.
          </p>
        ))
      )}
      <SettingsWriter>
        <QuickThresholds
          entries={view.entries}
          profile={view.profile}
          today={view.today}
          suggested={found}
        />
      </SettingsWriter>
    </StepSection>
  );
}

function QuickThresholds({
  entries,
  profile,
  today,
  suggested,
}: {
  entries: SettingEntry[];
  profile: Profile;
  today: string;
  suggested: readonly SuggestedThreshold[];
}) {
  const { save, saving } = useWriter();
  const fields = quickFields(profile, suggested);
  const [values, setValues] = useState<Partial<Record<QuickField["id"], string>>>({});
  const [problems, setProblems] = useState<Partial<Record<QuickField["id"], string>>>({});
  const [empty, setEmpty] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    const offered = Object.fromEntries(fields.map((field) => [field.id, values[field.id]]));
    const answer = quickWrites(entries, offered, today);
    setEmpty(answer.kind === "empty");
    setProblems(answer.kind === "problems" ? answer.problems : {});
    if (answer.kind === "writes") save(answer.writes, { onSaved: () => setValues({}) });
  }

  if (fields.length === 0) {
    return (
      <>
        <SaveStatus />
        <p className="lede">
          {suggested.length > 0
            ? "The rest of your thresholds and your weight are set."
            : "Your thresholds and weight are set."}{" "}
          <Link to="/settings" className="text-link">
            Change them in Settings
          </Link>
          .
        </p>
      </>
    );
  }

  return (
    <form className="quick-thresholds" onSubmit={submit} noValidate>
      <h3 className="group-title">
        {suggested.length > 0 ? "Know the others?" : "Know your numbers?"}
      </h3>
      <p className="lede">
        Fill in the ones you know and leave the rest. They hold from today, and for everything
        before it until you change them.{" "}
        <Link to="/settings" className="text-link">
          Settings
        </Link>{" "}
        has every threshold and their zones.
      </p>
      <div className="quick-fields">
        {fields.map((field) => (
          <QuickInput
            key={field.id}
            field={field}
            disabled={saving}
            value={values[field.id] ?? ""}
            problem={problems[field.id] ?? null}
            onChange={(text) => setValues((current) => ({ ...current, [field.id]: text }))}
          />
        ))}
      </div>
      <div className="form-actions">
        <button type="submit" className="primary" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      {empty && <p className="lede">Fill in at least one, or leave this step for later.</p>}
      <SaveStatus />
    </form>
  );
}

function QuickInput({
  field,
  disabled,
  value,
  problem,
  onChange,
}: {
  field: QuickField;
  disabled: boolean;
  value: string;
  problem: string | null;
  onChange: (text: string) => void;
}) {
  const id = `quick-${field.id}`;
  return (
    <div className="quick-field">
      <label htmlFor={id} className="setting-name">
        {field.label}
      </label>
      <p className="setting-help" id={`${id}-help`}>
        {field.help}
      </p>
      <span className="input-with-unit">
        <input
          id={id}
          value={value}
          disabled={disabled}
          inputMode={field.inputMode}
          placeholder={field.placeholder}
          autoComplete="off"
          aria-invalid={problem !== null}
          aria-describedby={problem ? `${id}-problem` : `${id}-help`}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
        <span className="muted">{field.unit}</span>
      </span>
      {problem && (
        <p className="notice form-problem" id={`${id}-problem`}>
          {problem}
        </p>
      )}
    </div>
  );
}

function PlanStep({ onboarding }: { onboarding: Onboarding }) {
  const hasHistory = onboarding.history.state === "done";
  return (
    <StepSection id="plan" number={3} state={onboarding.plan.state} title="Plan a first workout">
      <p className="lede">
        {onboarding.plan.state === "done"
          ? "Something is on your calendar. Today shows each day's plan, with a suggestion when you are tired."
          : "Put a workout on a day: one of your own, or one of the built-in ones. Today shows it on its day, Ride plays it on a trainer, and once you have done it the calendar says how close you came."}
      </p>
      <div className="start-actions">
        <Link to="/calendar" search={{ view: "week" }} className="primary link-button">
          Plan in the calendar
        </Link>
        <Link to="/workouts" search={{ in: "builtin" }} className="secondary link-button">
          Browse built-in workouts
        </Link>
        {hasHistory && (
          <Link to="/training" className="secondary link-button">
            See your training
          </Link>
        )}
      </div>
    </StepSection>
  );
}

function DoneIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      <path
        d="M3.5 8.5l3 3 6-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg
      className="start-check-arrow"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M6 3.5l4.5 4.5L6 12.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
