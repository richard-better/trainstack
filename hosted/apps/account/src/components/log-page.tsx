import { ORPCError } from "@orpc/client";
import type { StoredSession } from "@trainstack/contract";
import { Link, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";

import {
  blankBouldering,
  blankStrength,
  type BoulderingDraft,
  type Draft,
  draftKey,
  draftOf,
  durationOf,
  problemsWith,
  type StrengthDraft,
  type Timing,
} from "../lib/logbook";
import { saveSession, usePreferredUnit, useStoredSession } from "./logbook-data";
import { BoulderingEditor } from "./bouldering-log";
import { StrengthEditor } from "./strength-log";

type Stash = { draft: Draft; base: string | null };

function readStash(sport: Draft["sport"], id: string): Stash | null {
  try {
    const text = localStorage.getItem(draftKey(sport, id));
    return text ? (JSON.parse(text) as Stash) : null;
  } catch {
    return null;
  }
}

function writeStash(sport: Draft["sport"], id: string, stash: Stash | null) {
  try {
    if (stash) localStorage.setItem(draftKey(sport, id), JSON.stringify(stash));
    else localStorage.removeItem(draftKey(sport, id));
  } catch {
    return;
  }
}

export function LogPage({ sport, id }: { sport: Draft["sport"]; id: string }) {
  const stored = useStoredSession(id);
  const [unit] = usePreferredUnit();
  const absent =
    stored.isError &&
    stored.error instanceof ORPCError &&
    (stored.error.code === "NOT_FOUND" || stored.error.code === "SESSION_DELETED");
  if (stored.isError && !absent) {
    return (
      <LogShell>
        <div className="state" role="alert">
          <p className="state-title">This session did not load.</p>
          <p className="lede">Your unsaved changes are kept on this device.</p>
          <button type="button" className="secondary" onClick={() => stored.refetch()}>
            Try again
          </button>
        </div>
      </LogShell>
    );
  }
  if (stored.isPending && !absent) {
    return (
      <LogShell>
        <div className="detail-head skeleton" aria-busy="true" aria-label="Loading session">
          <span className="bar" style={{ width: "40%" }} />
        </div>
      </LogShell>
    );
  }
  const existing = stored.data ?? null;
  if (existing && existing.session.detail.sport !== sport) {
    return (
      <LogShell>
        <p className="lede">This session is a {existing.session.detail.sport} session.</p>
      </LogShell>
    );
  }
  const stash = readStash(sport, id);
  const base = existing?.editedAt.toISOString() ?? null;
  const initial =
    stash && stash.base === base
      ? stash.draft
      : existing
        ? draftOf(existing, unit)
        : sport === "strength"
          ? blankStrength(unit)
          : blankBouldering();
  return <LogForm key={id} id={id} initial={initial} base={base} existing={existing} />;
}

function LogShell({ children }: { children: ReactNode }) {
  return (
    <main className="content log">
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

function LogForm({
  id,
  initial,
  base,
  existing,
}: {
  id: string;
  initial: Draft;
  base: string | null;
  existing: StoredSession | null;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [startedFrom] = useState(base);
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    writeStash(draft.sport, id, { draft, base: startedFrom });
  }, [draft, id, startedFrom]);

  const checked = problemsWith(draft);
  const empty =
    draft.sport === "strength" ? draft.exercises.length === 0 : draft.problems.length === 0;

  async function save() {
    setTried(true);
    const { session } = problemsWith(draft);
    if (!session) return;
    setSaving(true);
    setRefusal(null);
    const outcome = await saveSession(id, session);
    setSaving(false);
    if (outcome.kind === "saved") {
      writeStash(draft.sport, id, null);
      await navigate({ to: "/activities/$id", params: { id: outcome.stored.activityId } });
    } else if (outcome.kind === "deleted") {
      writeStash(draft.sport, id, null);
      setRefusal("This session was deleted on another device, so it cannot be saved again.");
    } else {
      setRefusal(outcome.reason);
    }
  }

  const title = draft.sport === "strength" ? "Strength" : "Bouldering";
  return (
    <LogShell>
      <div className="page-head log-head">
        <h1 className="page-title">{existing ? `Edit ${title.toLowerCase()}` : title}</h1>
      </div>
      <fieldset className="log-form" disabled={saving}>
        {draft.sport === "strength" ? (
          <StrengthEditor
            draft={draft}
            onChange={(next: StrengthDraft) => setDraft(next)}
            updateDraft={(change) =>
              setDraft((current) => (current.sport === "strength" ? change(current) : current))
            }
            editing={existing !== null}
          />
        ) : (
          <BoulderingEditor
            draft={draft}
            onChange={(next: BoulderingDraft) => setDraft(next)}
            editing={existing !== null}
          />
        )}
        <SessionFields timing={draft} onChange={(timing) => setDraft({ ...draft, ...timing })} />
      </fieldset>
      <div className="log-save">
        {(refusal || (tried && checked.problem)) && (
          <p role="alert" className="notice">
            {refusal ?? checked.problem}
          </p>
        )}
        <button type="button" className="primary" onClick={save} disabled={saving || empty}>
          {saving ? "Saving…" : existing ? "Save changes" : "Save session"}
        </button>
      </div>
    </LogShell>
  );
}

const rpeWords: Record<number, string> = {
  0: "Rest",
  1: "Very easy",
  2: "Easy",
  3: "Moderate",
  4: "Somewhat hard",
  5: "Hard",
  7: "Very hard",
  10: "Maximal",
};

function rpeWordOf(rpe: number) {
  const floor = Math.max(
    ...Object.keys(rpeWords)
      .map(Number)
      .filter((value) => value <= rpe),
  );
  return rpeWords[floor]!;
}

function SessionFields({
  timing,
  onChange,
}: {
  timing: Timing;
  onChange: (timing: Partial<Timing>) => void;
}) {
  const sinceStart = Math.round(durationOf({ ...timing, minutes: "" }) / 60);
  return (
    <section className="log-session" aria-labelledby="log-session">
      <h2 id="log-session" className="section-title">
        Session
      </h2>
      <div className="log-fields">
        <label className="field">
          Day
          <input
            type="date"
            value={timing.day}
            onChange={(event) => event.target.value && onChange({ day: event.target.value })}
          />
        </label>
        <label className="field">
          Started
          <input
            type="time"
            value={timing.time}
            onChange={(event) => event.target.value && onChange({ time: event.target.value })}
          />
        </label>
        <label className="field">
          Minutes
          <input
            inputMode="numeric"
            value={timing.minutes}
            placeholder={`${sinceStart} so far`}
            onChange={(event) => onChange({ minutes: event.target.value.replace(/[^0-9]/g, "") })}
          />
        </label>
        <label className="field log-name">
          Name
          <input
            value={timing.name}
            placeholder="Optional"
            maxLength={200}
            onChange={(event) => onChange({ name: event.target.value })}
          />
        </label>
      </div>
      <fieldset className="rpe">
        <legend>
          How hard was the session?{" "}
          <span className="muted">
            {timing.rpe === null
              ? "Rate it once it is over, so it counts toward your load"
              : `${timing.rpe} · ${rpeWordOf(timing.rpe)}`}
          </span>
        </legend>
        <div className="rpe-scale">
          {Array.from({ length: 11 }, (_, value) => (
            <button
              key={value}
              type="button"
              className="chip"
              aria-pressed={timing.rpe === value}
              onClick={() => onChange({ rpe: timing.rpe === value ? null : value })}
            >
              {value}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="field log-notes">
        Notes
        <textarea
          value={timing.notes}
          rows={2}
          maxLength={4000}
          onChange={(event) => onChange({ notes: event.target.value })}
        />
      </label>
    </section>
  );
}
