import type { CalendarActivity, PlannedWorkout } from "@trainstack/contract";
import type { Block, Duration, Level, Sport, Step, Target, Workout } from "@trainstack/workout";

import { type Component, date, type Property, text, utcDateTime } from "./ics";

export const MAX_STEP_LINES = 40;
const MAX_TEXT_LENGTH = 1000;
const UID_DOMAIN = "trainstackhq.com";

export type Links = { webOrigin: string };

const workoutSportNames: Record<Sport, string> = {
  cycling: "Ride",
  running: "Run",
  swimming: "Swim",
};

const activitySportNames: Record<string, string> = {
  ...workoutSportNames,
  walking: "Walk",
  hiking: "Hike",
};

const indoorNames: Record<string, string> = { cycling: "Indoor ride", running: "Indoor run" };

export function activitySportName(sport: string | null, indoor: boolean | null) {
  if (sport === null) return "Activity";
  if (indoor && indoorNames[sport]) return indoorNames[sport];
  const name = activitySportNames[sport] ?? sport.replaceAll("_", " ");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function spanText(seconds: number) {
  const total = Math.round(seconds);
  if (total < 60) return `${total} s`;
  const minutes = Math.round(total / 60);
  const hours = Math.floor(minutes / 60);
  if (hours === 0) return `${minutes} min`;
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, "0")}`;
}

function exactSpanText(seconds: number) {
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return [hours > 0 && `${hours} h`, minutes > 0 && `${minutes} min`, rest > 0 && `${rest} s`]
    .filter(Boolean)
    .join(" ");
}

export function distanceText(meters: number) {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${Number((meters / 1000).toFixed(meters < 100_000 ? 1 : 0))} km`;
}

const loadText = (load: number) => `load ${Math.round(load)}`;

function numbersOf(values: { seconds: number | null; meters: number | null; load: number | null }) {
  return [
    values.seconds !== null && values.seconds > 0 ? spanText(values.seconds) : null,
    values.meters !== null && values.meters > 0 ? distanceText(values.meters) : null,
    values.load !== null ? loadText(values.load) : null,
  ].filter((value) => value !== null);
}

const clipped = (value: string) =>
  value.length > MAX_TEXT_LENGTH ? `${value.slice(0, MAX_TEXT_LENGTH - 1)}…` : value;

const lengthText = (duration: Exclude<Duration, { type: "open" }>) =>
  duration.type === "time" ? exactSpanText(duration.seconds) : distanceText(duration.meters);

function durationText(duration: Duration) {
  if (duration.type !== "open") return lengthText(duration);
  return duration.expected ? `until lap (about ${lengthText(duration.expected)})` : "until lap";
}

function levelText(level: Level, show: (value: number) => string, unit: string) {
  switch (level.kind) {
    case "constant":
      return `${show(level.value)}${unit}`;
    case "range":
      return `${show(level.low)}-${show(level.high)}${unit}`;
    case "ramp":
      return `${show(level.from)}${unit} rising to ${show(level.to)}${unit}`;
  }
}

const percent = (value: number) => String(Math.round(value * 100));
const whole = (value: number) => String(Math.round(value));

function paceOf(sport: Sport) {
  if (sport === "cycling") {
    return { show: (speed: number) => (speed * 3.6).toFixed(1), unit: " km/h" };
  }
  const distance = sport === "swimming" ? 100 : 1000;
  return {
    show: (speed: number) => {
      if (!(speed > 0)) return "-";
      const total = Math.round(distance / speed);
      return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
    },
    unit: sport === "swimming" ? " /100 m" : " /km",
  };
}

function targetText(target: Target, sport: Sport) {
  switch (target.type) {
    case "maxEffort":
      return "all out";
    case "power":
      return target.unit === "ftp"
        ? levelText(target.level, percent, "% FTP")
        : levelText(target.level, whole, " W");
    case "heartRate":
      return target.unit === "threshold"
        ? levelText(target.level, percent, "% threshold HR")
        : levelText(target.level, whole, " bpm");
    case "pace": {
      if (target.unit === "threshold") {
        return levelText(target.level, percent, "% threshold pace");
      }
      const { show, unit } = paceOf(sport);
      return levelText(target.level, show, unit);
    }
  }
}

const intensityNames: Record<NonNullable<Step["intensity"]>, string | null> = {
  warmUp: "Warm-up",
  active: null,
  recovery: "Recovery",
  rest: "Rest",
  coolDown: "Cool-down",
};

function stepText(step: Step, sport: Sport) {
  const label = step.name ?? (step.intensity ? intensityNames[step.intensity] : null);
  const parts = [
    durationText(step.duration),
    step.target ? `at ${targetText(step.target, sport)}` : null,
    step.cadence ? `${levelText(step.cadence, whole, " rpm")}` : null,
  ].filter((part) => part !== null);
  return `${label ? `${label}: ` : ""}${parts.join(" ")}`;
}

function stepLines(blocks: readonly Block[], sport: Sport, depth = 0): string[] {
  const indent = "  ".repeat(depth);
  return blocks.flatMap((block) =>
    block.type === "step"
      ? [`${indent}${stepText(block, sport)}`]
      : [
          `${indent}${block.name ? `${block.name}: ` : ""}${block.count} times`,
          ...stepLines(block.steps, sport, depth + 1),
        ],
  );
}

export function stepsText(workout: Workout) {
  const lines = stepLines(workout.steps, workout.sport);
  if (lines.length <= MAX_STEP_LINES) return lines.join("\n");
  return [
    ...lines.slice(0, MAX_STEP_LINES),
    `…and ${lines.length - MAX_STEP_LINES} more steps in Trainstack`,
  ].join("\n");
}

const stateMarks: Record<PlannedWorkout["state"], string> = {
  planned: "",
  completed: "✓ ",
  skipped: "Skipped · ",
  missed: "Missed · ",
};

const stateLines: Record<PlannedWorkout["state"], string | null> = {
  planned: null,
  completed: "Done.",
  skipped: "Skipped.",
  missed: "Missed.",
};

export function plannedTitle(planned: PlannedWorkout) {
  const { content } = planned;
  if (content.kind === "note") return content.title;
  if (content.kind === "rest") return "Rest day";
  const numbers = planned.planned ? numbersOf(planned.planned) : [];
  const name = `${workoutSportNames[content.workout.sport]}: ${content.workout.name}`;
  return `${stateMarks[planned.state]}${[name, ...numbers].join(", ")}`;
}

function plannedDescription(planned: PlannedWorkout, link: string) {
  const { content } = planned;
  const notes = content.notes ? clipped(content.notes) : null;
  if (content.kind !== "workout") return [notes, link].filter(Boolean).join("\n\n");
  const numbers = planned.planned ? numbersOf(planned.planned) : [];
  const summary = [numbers.length > 0 ? numbers.join(" · ") : null, stateLines[planned.state]]
    .filter(Boolean)
    .join("\n");
  return [
    summary,
    stepsText(content.workout),
    notes && `Notes: ${notes}`,
    content.workout.description ? clipped(content.workout.description) : null,
    link,
  ]
    .filter(Boolean)
    .join("\n\n");
}

const nextDay = (day: string) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

function revisedAt(planned: PlannedWorkout, paired: CalendarActivity | undefined) {
  const moments = [planned.updatedAt.getTime()];
  if (planned.state === "missed") moments.push(Date.parse(`${nextDay(planned.day)}T00:00:00Z`));
  if (planned.state === "completed" && paired?.startedAt) {
    moments.push(paired.startedAt.getTime() + (paired.seconds ?? 0) * 1000);
  }
  return new Date(Math.max(...moments));
}

const allDay = (day: string): Property[] => [
  { name: "DTSTART", parameters: "VALUE=DATE", value: date(day) },
  { name: "DTEND", parameters: "VALUE=DATE", value: date(nextDay(day)) },
];

export function plannedEvent(
  planned: PlannedWorkout,
  paired: CalendarActivity | undefined,
  { webOrigin }: Links,
): Component {
  const link = `${webOrigin}/calendar/planned/${planned.id}`;
  const revised = utcDateTime(revisedAt(planned, paired));
  return {
    name: "VEVENT",
    properties: [
      { name: "UID", value: `planned-${planned.id}@${UID_DOMAIN}` },
      { name: "DTSTAMP", value: revised },
      { name: "LAST-MODIFIED", value: revised },
      ...allDay(planned.day),
      { name: "SUMMARY", value: text(plannedTitle(planned)) },
      { name: "DESCRIPTION", value: text(plannedDescription(planned, link)) },
      { name: "URL", parameters: "VALUE=URI", value: link },
      { name: "TRANSP", value: "TRANSPARENT" },
      {
        name: "CATEGORIES",
        value: text(
          planned.content.kind === "workout"
            ? "Workout"
            : planned.content.kind === "note"
              ? "Note"
              : "Rest day",
        ),
      },
    ],
  };
}

export function activityTitle(activity: CalendarActivity) {
  const sport = activitySportName(activity.sport, activity.indoor);
  const name = activity.name ? `${sport}: ${activity.name}` : sport;
  return [name, ...numbersOf({ ...activity, seconds: null })].join(", ");
}

export function activityEvent(
  activity: CalendarActivity,
  day: string,
  { webOrigin }: Links,
): Component {
  const link = `${webOrigin}/activities/${activity.id}`;
  const numbers = numbersOf(activity);
  const start = activity.startedAt;
  const end = start && new Date(start.getTime() + Math.max(activity.seconds ?? 0, 60) * 1000);
  const stamp = utcDateTime(end ?? new Date(`${nextDay(day)}T00:00:00Z`));
  return {
    name: "VEVENT",
    properties: [
      { name: "UID", value: `activity-${activity.id}@${UID_DOMAIN}` },
      { name: "DTSTAMP", value: stamp },
      ...(start && end
        ? [
            { name: "DTSTART", value: utcDateTime(start) },
            { name: "DTEND", value: utcDateTime(end) },
          ]
        : allDay(day)),
      { name: "SUMMARY", value: text(activityTitle(activity)) },
      {
        name: "DESCRIPTION",
        value: text([numbers.join(" · "), link].filter(Boolean).join("\n\n")),
      },
      { name: "URL", parameters: "VALUE=URI", value: link },
      { name: "TRANSP", value: "OPAQUE" },
      { name: "CATEGORIES", value: "Activity" },
    ],
  };
}
