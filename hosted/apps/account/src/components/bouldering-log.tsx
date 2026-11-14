import {
  type Circuit,
  fontGrades,
  type FontGrade,
  type Grade,
  type ProblemOutcome,
  problemStyles,
  type ProblemStyle,
  type WallAngle,
} from "@trainstack/logbook";
import { useState } from "react";

import { activityDate } from "../lib/dates";
import {
  type BoulderingDraft,
  gradeChoices,
  gradeText,
  newKey,
  outcomeLabels,
  presetColours,
  type ProblemDraft,
  repeatBouldering,
} from "../lib/logbook";
import { useLatest } from "./logbook-data";

type Scale = "font" | "v" | "circuit";

const outcomes: ProblemOutcome[] = ["flash", "send", "project", "repeat"];
const angles: WallAngle[] = ["slab", "vertical", "overhang", "roof"];

const sameGrade = (a: Grade, b: Grade) => JSON.stringify(a) === JSON.stringify(b);

function scaleOf(draft: BoulderingDraft): Scale {
  const last = draft.problems.at(-1)?.grade.scale;
  if (last) return last;
  return draft.circuit ? "circuit" : "font";
}

export function BoulderingEditor({
  draft,
  onChange,
  editing,
}: {
  draft: BoulderingDraft;
  onChange: (draft: BoulderingDraft) => void;
  editing: boolean;
}) {
  const latest = useLatest("bouldering");
  const last = latest.data;
  const [scale, setScale] = useState<Scale>(() => scaleOf(draft));
  const [grade, setGrade] = useState<Grade | null>(null);
  const [outcome, setOutcome] = useState<ProblemOutcome>("flash");
  const [attempts, setAttempts] = useState(1);
  const [editingCircuit, setEditingCircuit] = useState(false);
  const choices = gradeChoices(scale, draft.circuit);
  const setProblems = (problems: ProblemDraft[]) => onChange({ ...draft, problems });

  function chooseOutcome(next: ProblemOutcome) {
    setOutcome(next);
    if (next === "flash") setAttempts(1);
    else if (attempts === 1 && next !== "repeat") setAttempts(2);
  }

  function add() {
    if (!grade) return;
    setProblems([
      ...draft.problems,
      {
        key: newKey(),
        grade,
        name: null,
        attempts: outcome === "flash" ? 1 : attempts,
        outcome,
        styles: [],
        angle: null,
        notes: null,
        restSeconds: null,
      },
    ]);
    setOutcome("flash");
    setAttempts(1);
  }

  return (
    <>
      <div className="log-toolbar">
        {!editing && draft.problems.length === 0 && last?.session.detail.sport === "bouldering" && (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              const next = repeatBouldering(draft, last);
              onChange(next);
              if (next.circuit) setScale("circuit");
            }}
          >
            Same place as {activityDate(last.session.startedAt)}
            <span className="button-detail">{last.session.detail.venue.name ?? ""}</span>
          </button>
        )}
      </div>
      <div className="log-fields venue">
        <div className="segmented" role="group" aria-label="Where">
          {(["gym", "crag"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              className="segment"
              aria-pressed={draft.venueKind === kind}
              onClick={() => onChange({ ...draft, venueKind: kind })}
            >
              {kind === "gym" ? "Gym" : "Crag"}
            </button>
          ))}
        </div>
        <label className="field log-name">
          <span className="visually-hidden">Place</span>
          <input
            value={draft.venueName}
            placeholder={draft.venueKind === "gym" ? "Gym name" : "Crag or area"}
            maxLength={120}
            onChange={(event) => onChange({ ...draft, venueName: event.target.value })}
          />
        </label>
      </div>

      <section className="problem-entry" aria-label="Add a problem">
        <div className="segmented" role="group" aria-label="Grade scale">
          {(["font", "v", "circuit"] as const).map((option) => (
            <button
              key={option}
              type="button"
              className="segment"
              aria-pressed={scale === option}
              onClick={() => {
                setScale(option);
                setGrade(null);
                if (option === "circuit" && !draft.circuit) setEditingCircuit(true);
              }}
            >
              {option === "font" ? "Font" : option === "v" ? "V" : "Colours"}
            </button>
          ))}
        </div>
        {scale === "circuit" && (editingCircuit || !draft.circuit) ? (
          <CircuitEditor
            circuit={draft.circuit}
            venueName={draft.venueName}
            used={
              new Set(
                draft.problems.flatMap(({ grade }) =>
                  grade.scale === "circuit" ? [grade.colour] : [],
                ),
              )
            }
            onDone={(circuit, renamed) => {
              onChange({
                ...draft,
                circuit,
                problems: draft.problems.map((problem) =>
                  problem.grade.scale === "circuit" && renamed.has(problem.grade.colour)
                    ? {
                        ...problem,
                        grade: { scale: "circuit", colour: renamed.get(problem.grade.colour)! },
                      }
                    : problem,
                ),
              });
              setEditingCircuit(false);
            }}
          />
        ) : (
          <>
            <div className="grade-chips" role="group" aria-label="Grade">
              {choices.map((choice) => (
                <button
                  key={choice.label}
                  type="button"
                  className="chip grade-chip"
                  aria-pressed={grade !== null && sameGrade(grade, choice.grade)}
                  onClick={() => setGrade(choice.grade)}
                >
                  {choice.label}
                </button>
              ))}
              {scale === "circuit" && (
                <button type="button" className="quiet" onClick={() => setEditingCircuit(true)}>
                  Edit colours
                </button>
              )}
            </div>
            <div className="outcome-row">
              <div className="segmented" role="group" aria-label="Outcome">
                {outcomes.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className="segment"
                    aria-pressed={outcome === option}
                    onClick={() => chooseOutcome(option)}
                  >
                    {outcomeLabels[option]}
                  </button>
                ))}
              </div>
              <Stepper
                label="Attempts"
                value={outcome === "flash" ? 1 : attempts}
                disabled={outcome === "flash"}
                onChange={setAttempts}
              />
            </div>
            <button type="button" className="primary add-problem" disabled={!grade} onClick={add}>
              {grade
                ? `Add ${gradeText(grade)} ${outcomeLabels[outcome].toLowerCase()}`
                : "Pick a grade"}
            </button>
          </>
        )}
      </section>

      <ol className="problems">
        {draft.problems.map((problem, index) => (
          <li key={problem.key}>
            <ProblemRow
              problem={problem}
              number={index + 1}
              onChange={(next) =>
                setProblems(
                  draft.problems.map((entry) => (entry.key === problem.key ? next : entry)),
                )
              }
              onRemove={() => setProblems(draft.problems.filter(({ key }) => key !== problem.key))}
            />
          </li>
        ))}
      </ol>
    </>
  );
}

function Stepper({
  label,
  value,
  disabled = false,
  compact = false,
  onChange,
}: {
  label: string;
  value: number;
  disabled?: boolean;
  compact?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className={`stepper${compact ? " compact" : ""}`} role="group" aria-label={label}>
      <button
        type="button"
        className="secondary"
        aria-label={`Fewer ${label.toLowerCase()}`}
        disabled={disabled || value <= 1}
        onClick={() => onChange(value - 1)}
      >
        −
      </button>
      <span className="stepper-value">
        {value}{" "}
        <span className={compact ? "visually-hidden" : "muted"}>
          {value === 1 ? label.toLowerCase().replace(/s$/, "") : label.toLowerCase()}
        </span>
      </span>
      <button
        type="button"
        className="secondary"
        aria-label={`More ${label.toLowerCase()}`}
        disabled={disabled || value >= 999}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </div>
  );
}

function ProblemRow({
  problem,
  number,
  onChange,
  onRemove,
}: {
  problem: ProblemDraft;
  number: number;
  onChange: (problem: ProblemDraft) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const toggleStyle = (style: ProblemStyle) =>
    onChange({
      ...problem,
      styles: problem.styles.includes(style)
        ? problem.styles.filter((entry) => entry !== style)
        : [...problem.styles, style],
    });
  return (
    <article className={`problem outcome-${problem.outcome}`}>
      <div className="problem-line">
        <span className="problem-number">{number}</span>
        <span className="problem-grade">{gradeText(problem.grade)}</span>
        <span className="problem-outcome">{outcomeLabels[problem.outcome]}</span>
        {problem.outcome !== "flash" ? (
          <Stepper
            label="Attempts"
            compact
            value={problem.attempts}
            onChange={(attempts) => onChange({ ...problem, attempts })}
          />
        ) : (
          <span />
        )}
        <button
          type="button"
          className="quiet"
          aria-expanded={open}
          aria-label={open ? "Fewer details" : "More details"}
          onClick={() => setOpen(!open)}
        >
          {open ? "Less" : "⋯"}
        </button>
        <button
          type="button"
          className="quiet danger"
          aria-label={`Remove problem ${number}`}
          onClick={onRemove}
        >
          ✕
        </button>
      </div>
      {open && (
        <div className="problem-more">
          <div className="segmented" role="group" aria-label="Outcome">
            {outcomes.map((option) => (
              <button
                key={option}
                type="button"
                className="segment"
                aria-pressed={problem.outcome === option}
                onClick={() =>
                  onChange({
                    ...problem,
                    outcome: option,
                    attempts: option === "flash" ? 1 : problem.attempts,
                  })
                }
              >
                {outcomeLabels[option]}
              </button>
            ))}
          </div>
          <div className="chips" role="group" aria-label="Angle">
            {angles.map((angle) => (
              <button
                key={angle}
                type="button"
                className="chip"
                aria-pressed={problem.angle === angle}
                onClick={() =>
                  onChange({ ...problem, angle: problem.angle === angle ? null : angle })
                }
              >
                {angle}
              </button>
            ))}
          </div>
          <div className="chips" role="group" aria-label="Style">
            {problemStyles.map((style) => (
              <button
                key={style}
                type="button"
                className="chip"
                aria-pressed={problem.styles.includes(style)}
                onClick={() => toggleStyle(style)}
              >
                {style}
              </button>
            ))}
          </div>
          <div className="log-fields">
            <label className="field log-name">
              Name
              <input
                value={problem.name ?? ""}
                maxLength={120}
                onChange={(event) => onChange({ ...problem, name: event.target.value || null })}
              />
            </label>
            <label className="field">
              Rest after, s
              <input
                inputMode="numeric"
                value={problem.restSeconds ?? ""}
                onChange={(event) => {
                  const digits = event.target.value.replace(/[^0-9]/g, "");
                  onChange({ ...problem, restSeconds: digits === "" ? null : Number(digits) });
                }}
              />
            </label>
          </div>
          <label className="field">
            Notes
            <input
              value={problem.notes ?? ""}
              maxLength={1000}
              onChange={(event) => onChange({ ...problem, notes: event.target.value || null })}
            />
          </label>
        </div>
      )}
    </article>
  );
}

type ColourRow = {
  key: string;
  was: string | null;
  name: string;
  from: FontGrade | "";
  to: FontGrade | "";
};

function CircuitEditor({
  circuit,
  venueName,
  used,
  onDone,
}: {
  circuit: Circuit | null;
  venueName: string;
  used: ReadonlySet<string>;
  onDone: (circuit: Circuit, renamed: ReadonlyMap<string, string>) => void;
}) {
  const [name, setName] = useState(circuit?.name ?? venueName);
  const [rows, setRows] = useState<ColourRow[]>(() =>
    (
      circuit?.colours ??
      presetColours.slice(1, 7).map((colour) => ({ name: colour, from: null, to: null }))
    ).map((colour) => ({
      key: newKey(),
      was: circuit ? colour.name : null,
      name: colour.name,
      from: colour.from ?? "",
      to: colour.to ?? "",
    })),
  );
  const names = rows.map((row) => row.name.trim()).filter(Boolean);
  const valid =
    name.trim() !== "" &&
    names.length > 0 &&
    rows.every((row) => row.was === null || !used.has(row.was) || row.name.trim() !== "") &&
    new Set(names).size === names.length &&
    rows.every(
      (row) =>
        (row.from === "") === (row.to === "") &&
        (row.from === "" ||
          fontGrades.indexOf(row.from) <= fontGrades.indexOf(row.to as FontGrade)),
    );
  const update = (key: string, change: Partial<ColourRow>) =>
    setRows(rows.map((row) => (row.key === key ? { ...row, ...change } : row)));
  return (
    <div className="circuit-editor">
      <p className="lede">
        Your gym's colours, easiest first. Give a colour the Font range the gym posts for it, so it
        counts in your grade pyramid; leave it blank when the gym gives none.
      </p>
      <label className="field">
        Circuit
        <input
          value={name}
          maxLength={80}
          placeholder="Gym name"
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <ol className="colour-rows">
        {rows.map((row) => (
          <li key={row.key} className="colour-row">
            <input
              aria-label="Colour"
              value={row.name}
              maxLength={40}
              onChange={(event) => update(row.key, { name: event.target.value })}
            />
            <select
              aria-label={`${row.name} from`}
              value={row.from}
              onChange={(event) => update(row.key, { from: event.target.value as FontGrade | "" })}
            >
              <option value="">No grade</option>
              {fontGrades.map((grade) => (
                <option key={grade}>{grade}</option>
              ))}
            </select>
            <select
              aria-label={`${row.name} to`}
              value={row.to}
              onChange={(event) => update(row.key, { to: event.target.value as FontGrade | "" })}
            >
              <option value="">No grade</option>
              {fontGrades.map((grade) => (
                <option key={grade}>{grade}</option>
              ))}
            </select>
            {row.was !== null && used.has(row.was) ? (
              <span className="muted colour-used" title="Problems in this session use this colour">
                in use
              </span>
            ) : (
              <button
                type="button"
                className="quiet danger"
                aria-label={`Remove ${row.name}`}
                onClick={() => setRows(rows.filter(({ key }) => key !== row.key))}
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ol>
      <div className="form-actions">
        <button
          type="button"
          className="secondary"
          onClick={() =>
            setRows([...rows, { key: newKey(), was: null, name: "", from: "", to: "" }])
          }
        >
          + Colour
        </button>
        <button
          type="button"
          className="primary"
          disabled={!valid}
          onClick={() =>
            onDone(
              {
                name: name.trim(),
                colours: rows
                  .filter((row) => row.name.trim() !== "")
                  .map((row) => ({
                    name: row.name.trim(),
                    from: row.from === "" ? null : row.from,
                    to: row.to === "" ? null : row.to,
                  })),
              },
              new Map(
                rows.flatMap((row) =>
                  row.was !== null && row.was !== row.name.trim()
                    ? [[row.was, row.name.trim()] as const]
                    : [],
                ),
              ),
            )
          }
        >
          Use these colours
        </button>
      </div>
    </div>
  );
}
