import type { Activity, DuplicateActivity } from "@trainstack/contract";

import type { ApiClient } from "./client.ts";
import { activityDate } from "./dates.ts";
import { activityTitle, sportName } from "./sports.ts";

const sourceNames: Record<string, string> = {
  trainstack: "Ride",
  upload: "Uploaded file",
  apple_health: "Apple Health",
  strava: "Strava",
  coros: "COROS",
  wahoo: "Wahoo",
  suunto: "Suunto",
  polar: "Polar",
  garmin: "Garmin",
};

export function sourceName(source: string) {
  const known = sourceNames[source];
  if (known) return known;
  const words = source.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export type Source = DuplicateActivity & { readonly current: boolean };

type Sourced = Pick<
  Activity,
  "id" | "source" | "sourceId" | "startedAt" | "file" | "primary" | "duplicates"
>;

export function sourcesOf(activity: Sourced): Source[] {
  const own: Source = {
    id: activity.id,
    source: activity.source,
    sourceId: activity.sourceId,
    startedAt: activity.startedAt,
    file: activity.file,
    primary: activity.primary,
    current: true,
  };
  const others = activity.duplicates.map((duplicate) => ({ ...duplicate, current: false }));
  return [own, ...others].sort((a, b) => Number(b.primary) - Number(a.primary));
}

export function primaryIdOf(activity: Sourced) {
  if (activity.primary) return activity.id;
  return activity.duplicates.find((duplicate) => duplicate.primary)?.id ?? activity.id;
}

export function sourceLabel(source: Pick<DuplicateActivity, "source" | "file">) {
  const name = sourceName(source.source);
  return source.source === "upload" && source.file
    ? `Uploaded ${source.file.format.toUpperCase()} file`
    : name;
}

const listed = (names: readonly string[]) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

export function arrivalText(activity: Pick<Activity, "duplicates">, uploaded: boolean) {
  const done = uploaded ? "Uploaded" : "Already in your account";
  if (activity.duplicates.length === 0) return done;
  const others = listed([...new Set(activity.duplicates.map(sourceLabel))]);
  return `${done}, linked to the same workout from ${others}`;
}

export function fileOf(source: Pick<DuplicateActivity, "source" | "file">) {
  if (source.source === "upload") {
    return source.file ? `uploaded ${source.file.format.toUpperCase()} file` : "uploaded file";
  }
  return `file from ${sourceName(source.source)}`;
}

export function deletingSource(activity: Sourced) {
  const others = activity.duplicates;
  const names = listed(others.map(sourceLabel));
  const what = `Only this ${fileOf(activity)} is deleted. It will not be added again, from Ride or by uploading the same file.`;
  if (!activity.primary) {
    const primary = others.find((other) => other.primary);
    return {
      what,
      stays: `The workout stays, with ${primary ? `${sourceLabel(primary)} as its primary source` : "its other sources"}.`,
    };
  }
  return {
    what,
    stays:
      others.length === 1
        ? `The workout stays, with ${names} as its only source.`
        : `The workout stays, with ${names}. One of them becomes its primary source.`,
  };
}

export type WorkoutChange =
  | { readonly kind: "makePrimary"; readonly id: string; readonly previous: string }
  | { readonly kind: "unlink"; readonly id: string; readonly from: string }
  | {
      readonly kind: "link";
      readonly id: string;
      readonly to: string;
      readonly joining: readonly string[];
    }
  | { readonly kind: "separate"; readonly ids: readonly string[]; readonly from: string };

export function undoOf(change: WorkoutChange): WorkoutChange {
  switch (change.kind) {
    case "makePrimary":
      return { kind: "makePrimary", id: change.previous, previous: change.id };
    case "unlink":
      return { kind: "link", id: change.from, to: change.id, joining: [change.id] };
    case "link":
      return { kind: "separate", ids: change.joining, from: change.id };
    case "separate":
      return { kind: "link", id: change.from, to: change.ids[0]!, joining: change.ids };
  }
}

export async function applyChange(api: ApiClient, change: WorkoutChange) {
  switch (change.kind) {
    case "makePrimary":
      await api.activities.makePrimary({ id: change.id });
      return;
    case "unlink":
      await api.activities.unlink({ id: change.id });
      return;
    case "link":
      await api.activities.link({ id: change.id, to: change.to });
      return;
    case "separate": {
      const [first, ...rest] = change.ids;
      if (first === undefined) return;
      await api.activities.unlink({ id: first });
      for (const id of rest) {
        await api.activities.unlink({ id });
        await api.activities.link({ id, to: first });
      }
      return;
    }
  }
}

export const membersOf = (activity: Pick<Activity, "id" | "duplicates">) => [
  activity.id,
  ...activity.duplicates.map((duplicate) => duplicate.id),
];

const occurredAt = (activity: Pick<Activity, "startedAt" | "createdAt">) =>
  activity.startedAt ?? activity.createdAt;

export const NEAR_MS = 24 * 60 * 60 * 1000;

export interface LinkCandidates {
  readonly near: readonly Activity[];
  readonly matches: readonly Activity[] | null;
  readonly reachedNear: boolean;
}

function searchText(activity: Activity) {
  const sport = sportName(activity.sport, activity.indoor);
  return [
    activityTitle(activity),
    sport.label,
    activityDate(occurredAt(activity)),
    sourceLabel(activity),
    ...activity.duplicates.map(sourceLabel),
  ]
    .join(" ")
    .toLowerCase();
}

export function linkCandidates(
  activity: Pick<Activity, "id" | "duplicates" | "startedAt" | "createdAt">,
  loaded: readonly Activity[],
  search: string,
  hasMore: boolean,
): LinkCandidates {
  const own = new Set(membersOf(activity));
  const others = loaded.filter(
    (other) => !own.has(other.id) && !other.duplicates.some(({ id }) => own.has(id)),
  );
  const at = occurredAt(activity).getTime();
  const distance = (other: Activity) => Math.abs(occurredAt(other).getTime() - at);
  const near = others
    .filter((other) => distance(other) <= NEAR_MS)
    .sort((a, b) => distance(a) - distance(b));
  const oldest = loaded.at(-1);
  const reachedNear =
    !hasMore || (oldest !== undefined && occurredAt(oldest).getTime() < at - NEAR_MS);
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const matches =
    words.length === 0
      ? null
      : others.filter((other) => {
          const text = searchText(other);
          return words.every((word) => text.includes(word));
        });
  return { near, matches, reachedNear };
}
