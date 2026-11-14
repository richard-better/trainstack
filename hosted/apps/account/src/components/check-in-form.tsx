import type { BodyArea } from "@trainstack/contract";
import { Link } from "@tanstack/react-router";
import { type FormEvent, type KeyboardEvent, useId, useState } from "react";

import {
  anchorOf,
  bodyAreas,
  type CheckIn,
  type CheckInItem,
  checkInItems,
  type Draft,
  draftOf,
  illnessKinds,
  injuryTrainings,
  isComplete,
  itemQuestions,
  itemTitles,
  MAX_CHECK_IN_NOTE,
  NORMAL,
  sameAnswers,
  sameDraft,
  writeOf,
} from "../lib/check-in";
import { useRemoveCheckIn, useSaveCheckIn } from "./check-in-data";

const toneOf = (value: number | null) =>
  value === null ? "unrated" : value < NORMAL ? "below" : value > NORMAL ? "above" : "normal";

export function CheckInForm({ day, held }: { day: string; held: CheckIn | null }) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(held));
  const [basis, setBasis] = useState(held);
  const [outcome, setOutcome] = useState<"saved" | "overruled" | "removed" | null>(null);
  const save = useSaveCheckIn();
  const remove = useRemoveCheckIn();
  const busy = save.isPending || remove.isPending;

  if (held !== basis) {
    setBasis(held);
    if (sameDraft(draft, draftOf(basis))) setDraft(draftOf(held));
  }

  const change = (next: Partial<Draft>) => {
    setOutcome(null);
    setDraft((current) => ({ ...current, ...next }));
  };

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!isComplete(draft) || busy) return;
    const written = writeOf(draft, day);
    save.mutate(written, {
      onSuccess: ({ checkIn }) => {
        setDraft(draftOf(checkIn));
        setOutcome(sameAnswers(checkIn, written) ? "saved" : "overruled");
      },
    });
  }

  function saveWithShortcut(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit(event);
  }

  return (
    <form className="check-in-form" onSubmit={submit} onKeyDown={saveWithShortcut}>
      <p className="lede check-in-hint">
        {held
          ? "This is what you said. Change anything and save again."
          : "Everything starts at normal for you. Tap what is different, then save."}
      </p>
      <fieldset className="check-in-fields" disabled={busy}>
        <div className="ratings">
          {checkInItems.map((item) => (
            <Rating
              key={item}
              item={item}
              value={draft.ratings[item]}
              onChange={(value) => change({ ratings: { ...draft.ratings, [item]: value } })}
            />
          ))}
        </div>
        <States draft={draft} onChange={change} />
        <NoteField note={draft.note} onChange={(note) => change({ note })} />
      </fieldset>
      <div className="check-in-actions">
        <button type="submit" className="primary" disabled={busy || !isComplete(draft)}>
          {save.isPending ? "Saving…" : held ? "Save changes" : "Save check-in"}
        </button>
        {held && (
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={() =>
              remove.mutate(day, {
                onSuccess: ({ checkIn }) => {
                  setDraft(draftOf(checkIn));
                  setOutcome(checkIn ? "overruled" : "removed");
                },
              })
            }
          >
            {remove.isPending ? "Removing…" : "Remove check-in"}
          </button>
        )}
        <p className="check-in-status" role="status">
          {outcome === "saved" && "Saved."}
          {outcome === "removed" && "Removed. This day has no check-in."}
          {outcome === "overruled" &&
            "Another device saved this day more recently, so its check-in is kept. It is shown here."}
        </p>
      </div>
      {!isComplete(draft) && (
        <p className="lede">
          To save, choose what kind of illness, where the injury is and what it lets you do, or turn
          them off.
        </p>
      )}
      {(save.isError || remove.isError) && (
        <p className="notice" role="alert">
          Your check-in was not {save.isError ? "saved" : "removed"}. Check your connection and try
          again.
        </p>
      )}
      <p className="check-in-privacy">
        Only you can see your check-ins. They are in your account export, and deleting your account
        deletes them. Trainstack keeps what you enter here and draws no conclusions from it.{" "}
        <Link to="/settings">Export or delete your account in Settings</Link>
      </p>
    </form>
  );
}

function Rating({
  item,
  value,
  onChange,
}: {
  item: CheckInItem;
  value: number | null;
  onChange: (value: number) => void;
}) {
  const name = useId();
  const titleId = useId();
  return (
    <div className="rating" data-tone={toneOf(value)}>
      <p className="rating-head">
        <span id={titleId} className="rating-title">
          {itemTitles[item]}
          <span className="visually-hidden">: {itemQuestions[item]}</span>
        </span>
        <span className="rating-word" aria-hidden="true">
          {value === null ? "Not rated" : anchorOf(item, value)}
        </span>
      </p>
      <div className="rating-scale" role="radiogroup" aria-labelledby={titleId}>
        {[1, 2, 3, 4, 5].map((step) => (
          <label key={step} className={`rating-step tone-${step}`}>
            <input
              type="radio"
              name={name}
              value={step}
              checked={value === step}
              onChange={() => onChange(step)}
            />
            <span aria-hidden="true">{step}</span>
            <span className="visually-hidden">{anchorOf(item, step)}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function States({ draft, onChange }: { draft: Draft; onChange: (next: Partial<Draft>) => void }) {
  const illName = useId();
  const trainingName = useId();
  const areaId = useId();
  return (
    <div className="check-in-states">
      <div className="state-toggles">
        <button
          type="button"
          className="state-toggle"
          aria-pressed={draft.illness !== null}
          onClick={() => onChange({ illness: draft.illness ? null : { kind: null } })}
        >
          I am ill
        </button>
        <button
          type="button"
          className="state-toggle"
          aria-pressed={draft.injury !== null}
          onClick={() => onChange({ injury: draft.injury ? null : { area: null, training: null } })}
        >
          I am injured
        </button>
      </div>
      {draft.illness !== null && (
        <fieldset className="state-detail">
          <legend className="group-title">What kind of illness?</legend>
          <div className="chips">
            {illnessKinds.map((kind) => (
              <label key={kind.key} className="chip">
                <input
                  type="radio"
                  name={illName}
                  checked={draft.illness?.kind === kind.key}
                  onChange={() => onChange({ illness: { kind: kind.key } })}
                />
                {kind.label}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {draft.injury !== null && (
        <fieldset className="state-detail">
          <legend className="group-title">Your injury</legend>
          <label className="area-field" htmlFor={areaId}>
            <span>Where</span>
            <select
              id={areaId}
              value={draft.injury.area ?? ""}
              required
              onChange={(event) =>
                onChange({
                  injury: {
                    ...draft.injury!,
                    area: (event.target.value || null) as BodyArea | null,
                  },
                })
              }
            >
              <option value="">Choose where it hurts</option>
              {bodyAreas.map((area) => (
                <option key={area.key} value={area.key}>
                  {area.label}
                </option>
              ))}
            </select>
          </label>
          <div className="chips" role="radiogroup" aria-label="What it lets you do">
            {injuryTrainings.map((training) => (
              <label key={training.key} className="chip">
                <input
                  type="radio"
                  name={trainingName}
                  checked={draft.injury!.training === training.key}
                  onChange={() =>
                    onChange({ injury: { ...draft.injury!, training: training.key } })
                  }
                />
                {training.label}
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}

function NoteField({ note, onChange }: { note: string; onChange: (note: string) => void }) {
  const id = useId();
  return (
    <div className="note-field">
      <label htmlFor={id} className="group-title">
        Note <span className="muted">(optional)</span>
      </label>
      <textarea
        id={id}
        rows={2}
        maxLength={MAX_CHECK_IN_NOTE}
        value={note}
        placeholder="Anything else about today, in your words"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
