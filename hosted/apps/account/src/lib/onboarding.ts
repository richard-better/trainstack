import type { Activity, SettingEntry, SettingWrite } from "@trainstack/contract";
import {
  isValidThresholdValue,
  type Profile,
  type ThresholdName,
  thresholds,
  type ZoneMetric,
} from "@trainstack/zones";

import { settingsScopeOf, thresholdPrompt } from "./analysis.ts";
import {
  parseValue,
  parseWeight,
  put,
  scopeLabel,
  scopeSetUpOn,
  thresholdHelp,
  thresholdRange,
  thresholdTitle,
  unitOf,
} from "./settings.ts";

export const NEW_ACCOUNT_DAYS = 30;

const DAY_MS = 86_400_000;

export type HistorySourceState = "available" | "coming" | "not_yet";

export type HistorySourceAction =
  | { readonly kind: "upload" }
  | { readonly kind: "link"; readonly href: string; readonly label: string };

export interface HistorySource {
  readonly id: string;
  readonly name: string;
  readonly state: HistorySourceState;
  readonly detail: string;
  readonly action?: HistorySourceAction;
}

export const historySources: readonly HistorySource[] = [
  {
    id: "files",
    name: "Files from a watch, bike computer or app",
    state: "available",
    detail:
      "FIT, GPX and TCX files, as many at once as you like. Garmin, Wahoo, COROS, Suunto, Polar and Zwift all write them. A file already in your account is skipped.",
    action: { kind: "upload" },
  },
  {
    id: "ride",
    name: "Ride",
    state: "available",
    detail:
      "Sign Ride in with the same Apple ID, and it sends every ride it has recorded, the older ones too.",
    action: { kind: "link", href: "https://trainstackhq.com/ride", label: "Get Ride" },
  },
  {
    id: "apple-health",
    name: "Apple Health",
    state: "coming",
    detail:
      "Ride is learning to bring in your workouts from Apple Health. Until it can, upload the files from the app that recorded them.",
  },
  {
    id: "strava",
    name: "Strava",
    state: "not_yet",
    detail:
      "There is no Strava import. Strava lets you download your whole history from its account settings: unpack it and upload the files from its activities folder.",
  },
  {
    id: "watch-accounts",
    name: "Garmin, COROS, Wahoo, Suunto and Polar accounts",
    state: "not_yet",
    detail:
      "Trainstack cannot connect to them yet. Copy the files off the device, or export them from the app.",
  },
];

export const historySourceStateWords: Record<HistorySourceState, string> = {
  available: "Works now",
  coming: "Coming",
  not_yet: "Not yet",
};

export type StepState = "done" | "open" | "waiting";

export type StepId = "history" | "thresholds" | "plan";

export interface OnboardingFacts {
  readonly activities: readonly Pick<
    Activity,
    "sport" | "missingThresholds" | "statistics" | "localDay" | "analysisDue"
  >[];
  readonly moreActivities: boolean;
  readonly profile: Profile;
  readonly planned: boolean;
}

export interface Onboarding {
  readonly history: { readonly state: StepState; readonly count: number; readonly more: boolean };
  readonly thresholds: { readonly state: StepState; readonly unscored: number };
  readonly plan: { readonly state: StepState };
  readonly done: boolean;
}

export const hasAnyThreshold = (profile: Profile) =>
  [profile.defaults, ...Object.values(profile.sports)].some((metrics) =>
    Object.values(metrics).some((zones) => zones && Object.keys(zones.thresholds).length > 0),
  );

export function onboardingOf({
  activities,
  moreActivities,
  profile,
  planned,
}: OnboardingFacts): Onboarding {
  const analysed = activities.filter((activity) => !activity.analysisDue);
  const unscored = analysed.filter(
    (activity) => thresholdPrompt(activity, settingsScopeOf(profile, activity.sport)) !== null,
  );
  const thresholdsState: StepState =
    unscored.length > 0
      ? "open"
      : activities.length === 0
        ? hasAnyThreshold(profile)
          ? "done"
          : "open"
        : analysed.length < activities.length
          ? "waiting"
          : "done";
  const history: Onboarding["history"] = {
    state: activities.length > 0 ? "done" : "open",
    count: activities.length,
    more: moreActivities,
  };
  const plan = { state: planned ? ("done" as const) : ("open" as const) };
  return {
    history,
    thresholds: { state: thresholdsState, unscored: unscored.length },
    plan,
    done: history.state === "done" && thresholdsState === "done" && plan.state === "done",
  };
}

export function showsGettingStarted(
  onboarding: Onboarding,
  accountCreatedAt: Date | null,
  now: Date,
) {
  if (onboarding.done) return false;
  if (onboarding.history.count === 0) return true;
  return (
    accountCreatedAt !== null &&
    now.getTime() - accountCreatedAt.getTime() < NEW_ACCOUNT_DAYS * DAY_MS
  );
}

type QuickThreshold = "ftp" | "max_heart_rate" | "lactate_threshold_heart_rate" | "threshold_pace";

export interface QuickField {
  readonly id: QuickThreshold | "weight";
  readonly label: string;
  readonly help: string;
  readonly unit: string;
  readonly placeholder: string;
  readonly inputMode: "numeric" | "decimal" | "text";
}

const quickThresholds: readonly {
  readonly threshold: QuickThreshold;
  readonly sport: string | null;
  readonly placeholder: string;
}[] = [
  { threshold: "ftp", sport: null, placeholder: "250" },
  { threshold: "max_heart_rate", sport: null, placeholder: "188" },
  { threshold: "lactate_threshold_heart_rate", sport: null, placeholder: "170" },
  { threshold: "threshold_pace", sport: "running", placeholder: "4:30" },
];

const metricOf = (threshold: ThresholdName): ZoneMetric => thresholds[threshold].metric;

function currentThreshold(profile: Profile, threshold: ThresholdName, sport: string | null) {
  const metric = metricOf(threshold);
  const zones = sport === null ? profile.defaults[metric] : profile.sports[sport]?.[metric];
  return zones?.thresholds[threshold] ?? null;
}

export interface SuggestedThreshold {
  readonly threshold: string;
  readonly sport: string | null;
}

export function quickFields(
  profile: Profile,
  suggested: readonly SuggestedThreshold[] = [],
): QuickField[] {
  const fields: QuickField[] = quickThresholds
    .filter(({ threshold, sport }) => currentThreshold(profile, threshold, sport) === null)
    .filter(
      ({ threshold, sport }) =>
        !suggested.some((each) => each.threshold === threshold && each.sport === sport),
    )
    .map(({ threshold, sport, placeholder }) => ({
      id: threshold,
      label:
        sport === null
          ? thresholdTitle(threshold, sport)
          : `${scopeLabel(sport)} ${thresholdTitle(threshold, sport).toLowerCase()}`,
      help: thresholdHelp(threshold, sport),
      unit: unitOf(metricOf(threshold), sport),
      placeholder,
      inputMode: metricOf(threshold) === "pace" ? "text" : "numeric",
    }));
  if (profile.weightKg === null) {
    fields.push({
      id: "weight",
      label: "Weight",
      help: "Used for power to weight",
      unit: "kg",
      placeholder: "72.5",
      inputMode: "decimal",
    });
  }
  return fields;
}

export type QuickAnswer =
  | { readonly kind: "writes"; readonly writes: SettingWrite[] }
  | { readonly kind: "problems"; readonly problems: Partial<Record<QuickField["id"], string>> }
  | { readonly kind: "empty" };

export function quickWrites(
  entries: readonly SettingEntry[],
  values: Partial<Record<QuickField["id"], string>>,
  day: string,
  now = new Date(),
): QuickAnswer {
  const writes: SettingWrite[] = [];
  const problems: Partial<Record<QuickField["id"], string>> = {};
  for (const { threshold, sport } of quickThresholds) {
    const text = values[threshold]?.trim();
    if (!text) continue;
    const metric = metricOf(threshold);
    const value = parseValue(metric, text);
    if (value === null || !isValidThresholdValue(threshold, value)) {
      problems[threshold] =
        `Enter ${metric === "pace" ? "a pace as minutes:seconds" : "a whole number"} from ${thresholdRange(threshold, sport)}.`;
      continue;
    }
    writes.push(
      ...scopeSetUpOn(entries, day, sport, metric, now),
      put(day, { kind: "threshold", sport, threshold, value }, now),
    );
  }
  const weightText = values.weight?.trim();
  if (weightText) {
    const kg = parseWeight(weightText);
    if (kg === null) problems.weight = "Enter your weight in kilograms, from 30 to 200, like 72.5.";
    else writes.push(put(day, { kind: "weight", kg }, now));
  }
  if (Object.keys(problems).length > 0) return { kind: "problems", problems };
  return writes.length > 0 ? { kind: "writes", writes } : { kind: "empty" };
}
