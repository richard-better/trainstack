import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { api } from "../api";
import {
  type DayReadiness,
  confidenceWords,
  gapLines,
  headlineOf,
  levelSteps,
  type ReadinessLevel,
  readinessQueryKey,
  reasonLines,
  unmeasuredLine,
} from "../lib/readiness";

export function useReadiness(from: string, through: string, { enabled = true } = {}) {
  return useQuery({
    queryKey: readinessQueryKey(from, through),
    queryFn: () => api.readiness.range({ from, through }),
    enabled,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    placeholderData: (previous) => previous,
  });
}

const effectGlyphs = { lowers: "↓", raises: "↑", steady: "=" } as const;
const effectNames = { lowers: "Lowers", raises: "Raises", steady: "No change" } as const;

export function ReadinessMeter({
  level,
  size = "large",
}: {
  level: ReadinessLevel | null;
  size?: "large" | "small";
}) {
  const filled = level === null ? 0 : levelSteps[level];
  return (
    <span
      className="readiness-meter"
      data-level={level ?? "none"}
      data-size={size}
      aria-hidden="true"
    >
      {[1, 2, 3, 4].map((step) => (
        <span key={step} className="readiness-step" data-filled={step <= filled || undefined} />
      ))}
    </span>
  );
}

export function ReadinessSummary({ readiness }: { readiness: DayReadiness }) {
  const headline = headlineOf(readiness);
  const lines = reasonLines(readiness);
  const gaps = gapLines(readiness);
  return (
    <section
      className="readiness"
      data-level={readiness.level ?? "none"}
      aria-labelledby="readiness-title"
    >
      <div className="readiness-head">
        <ReadinessMeter level={readiness.level} />
        <div className="readiness-words">
          <h2 id="readiness-title" className="readiness-title">
            <span className="visually-hidden">Readiness: </span>
            {headline.title}
          </h2>
          <p className="readiness-line">{headline.line}</p>
        </div>
      </div>
      {lines.length > 0 && (
        <ul className="readiness-reasons" aria-label="What it read">
          {lines.map((line) => (
            <li key={line.text} className="readiness-reason" data-effect={line.effect}>
              <span
                className="readiness-effect"
                aria-label={effectNames[line.effect]}
                title={effectNames[line.effect]}
              >
                {effectGlyphs[line.effect]}
              </span>
              {line.text}
            </li>
          ))}
        </ul>
      )}
      <div className="readiness-basis">
        {readiness.level !== null && (
          <p className="readiness-confidence">{confidenceWords[readiness.confidence]}</p>
        )}
        {gaps.map((gap) => (
          <p key={gap} className="muted">
            {gap}
          </p>
        ))}
        <p className="muted">{unmeasuredLine}</p>
      </div>
    </section>
  );
}

export function ReadinessStrip({ readiness }: { readiness: DayReadiness }) {
  const headline = headlineOf(readiness);
  const first = reasonLines(readiness).find((line) => line.effect !== "steady");
  return (
    <aside
      className="readiness-strip"
      data-level={readiness.level ?? "none"}
      aria-label="Readiness today"
    >
      <ReadinessMeter level={readiness.level} size="small" />
      <p className="readiness-strip-text">
        <span className="readiness-strip-title">
          <span className="visually-hidden">Readiness today: </span>
          {headline.title}
        </span>
        <span className="muted">{first ? first.text : headline.line}</span>
      </p>
      <Link to="/" className="quiet link-button compact">
        Today
      </Link>
    </aside>
  );
}
