import type { Sport, SubSport } from "@trainstack/activity-file";

export type SportFamily = "ride" | "run" | "swim" | "strength" | "climb" | "other";

interface SportName {
  readonly label: string;
  readonly noun: string;
  readonly family: SportFamily;
}

const sports: Record<string, SportName> = {
  cycling: { label: "Cycling", noun: "ride", family: "ride" },
  indoor_cycling: { label: "Indoor cycling", noun: "indoor ride", family: "ride" },
  running: { label: "Running", noun: "run", family: "run" },
  indoor_running: { label: "Indoor running", noun: "treadmill run", family: "run" },
  walking: { label: "Walking", noun: "walk", family: "run" },
  hiking: { label: "Hiking", noun: "hike", family: "run" },
  swimming: { label: "Swimming", noun: "swim", family: "swim" },
  strength: { label: "Strength", noun: "strength session", family: "strength" },
  bouldering: { label: "Bouldering", noun: "bouldering session", family: "climb" },
};

export function sportName(sport: string | null): SportName {
  if (!sport) return { label: "Activity", noun: "activity", family: "other" };
  const known = sports[sport];
  if (known) return known;
  const words = sport.replaceAll("_", " ");
  return { label: words.charAt(0).toUpperCase() + words.slice(1), noun: words, family: "other" };
}

function partOfDay(date: Date) {
  const hour = date.getHours();
  if (hour < 5) return "Night";
  if (hour < 12) return "Morning";
  if (hour < 17) return "Afternoon";
  if (hour < 21) return "Evening";
  return "Night";
}

export function activityTitle(activity: {
  name: string | null;
  sport: string | null;
  startedAt: Date | null;
}) {
  if (activity.name) return activity.name;
  const { noun } = sportName(activity.sport);
  return activity.startedAt ? `${partOfDay(activity.startedAt)} ${noun}` : `Untitled ${noun}`;
}

export function sportFromFit(sport: Sport | undefined, subSport: SubSport | undefined) {
  if (sport === "cycling") {
    return subSport === "indoorCycling" || subSport === "virtualActivity"
      ? "indoor_cycling"
      : "cycling";
  }
  if (sport === "running") {
    return subSport === "treadmill" || subSport === "indoorRunning" ? "indoor_running" : "running";
  }
  if (sport === "training" && subSport === "strengthTraining") return "strength";
  if (sport === "rockClimbing") return "bouldering";
  if (typeof sport === "string" && sport !== "generic") {
    return sport.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  }
  return null;
}
