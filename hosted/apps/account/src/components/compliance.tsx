import type { PlannedWorkout } from "@trainstack/contract";

import {
  type ComplianceWords,
  type IntervalStep,
  type Rating,
  complianceWords,
  stepTarget,
} from "../lib/compliance";
import { formatHours } from "../lib/statistics";

function RatingMark({ rating }: { rating: Rating | null }) {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
      <circle
        cx="6"
        cy="6"
        r="4.5"
        fill={rating === "on_target" ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.5"
      />
      {rating === "partly" && <path d="M6 1.5a4.5 4.5 0 0 1 0 9Z" fill="currentColor" />}
    </svg>
  );
}

export function ComplianceBadge({ item, withWhy }: { item: PlannedWorkout; withWhy: boolean }) {
  const words = complianceWords(item);
  if (!words) return null;
  return (
    <span className="compliance-badge" data-rating={words.rating ?? "none"} title={words.why}>
      <span className="compliance-score">
        <RatingMark rating={words.rating} />
        {words.score !== null && <strong>{words.score}</strong>}
        {words.label}
        {words.provisional && <span className="muted"> so far</span>}
      </span>
      {withWhy ? (
        <span className="compliance-why">{words.why}</span>
      ) : (
        <span className="visually-hidden">. {words.why}</span>
      )}
    </span>
  );
}

export function ComplianceDetail({
  item,
  steps,
  sport,
}: {
  item: PlannedWorkout;
  steps: readonly IntervalStep[] | null;
  sport: string | null;
}) {
  const words = complianceWords(item);
  if (!words) return null;
  return (
    <div className="compliance-detail" data-rating={words.rating ?? "none"}>
      <Headline words={words} />
      {words.parts.length > 0 && (
        <table className="data-table compliance-parts">
          <caption className="visually-hidden">How each part compares with the plan</caption>
          <thead>
            <tr>
              <th scope="col">Part</th>
              <th scope="col">Planned</th>
              <th scope="col">Done</th>
              <th scope="col">How close</th>
            </tr>
          </thead>
          <tbody>
            {words.parts.map((part) => (
              <tr key={part.key}>
                <th scope="row">{part.name}</th>
                <td>{part.key === "intervals" ? "-" : part.planned}</td>
                <td>
                  {part.key === "intervals"
                    ? `${part.done} of ${part.planned} in target`
                    : part.done}
                </td>
                <td>
                  {part.verdict}
                  <span className="muted"> ({Math.round(part.score * 100)})</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {words.unscored.length > 0 && (
        <ul className="compliance-unscored">
          {words.unscored.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      {steps && steps.length > 0 && <Steps steps={steps} sport={sport} />}
    </div>
  );
}

function Headline({ words }: { words: ComplianceWords }) {
  return (
    <div className="compliance-headline">
      <p className="compliance-big">
        <RatingMark rating={words.rating} />
        {words.score !== null && <strong>{words.score}</strong>}
        <span>{words.label}</span>
      </p>
      <p className="lede">
        {words.why}
        {words.provisional &&
          " The activity is still being analysed, so the intervals and this score may change."}
      </p>
    </div>
  );
}

function Steps({ steps, sport }: { steps: readonly IntervalStep[]; sport: string | null }) {
  return (
    <details className="compliance-steps">
      <summary>Step by step</summary>
      <div className="table-scroll">
        <table className="data-table">
          <caption className="visually-hidden">Each targeted step against what was done</caption>
          <thead>
            <tr>
              <th scope="col">Step</th>
              <th scope="col">Target</th>
              <th scope="col">Average</th>
              <th scope="col">In target</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((step) => {
              const target = stepTarget(step, sport);
              return (
                <tr key={step.index}>
                  <th scope="row">
                    {step.name ?? `Step ${step.index + 1}`}
                    <span className="muted"> {formatHours(step.seconds)}</span>
                  </th>
                  <td>{target.band}</td>
                  <td>{step.placed ? target.average : "-"}</td>
                  <td>
                    {!step.placed
                      ? "Not found in the activity"
                      : step.secondsWithData === 0
                        ? "No data"
                        : `${Math.round((step.secondsInTarget / step.secondsWithData) * 100)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}
