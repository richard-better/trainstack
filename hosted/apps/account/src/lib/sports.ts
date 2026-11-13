export type SportFamily = "ride" | "run" | "swim" | "strength" | "climb" | "other";

interface SportName {
  readonly label: string;
  readonly noun: string;
  readonly family: SportFamily;
}

const sports: Record<string, SportName> = {
  cycling: { label: "Cycling", noun: "ride", family: "ride" },
  running: { label: "Running", noun: "run", family: "run" },
  walking: { label: "Walking", noun: "walk", family: "run" },
  hiking: { label: "Hiking", noun: "hike", family: "run" },
  swimming: { label: "Swimming", noun: "swim", family: "swim" },
  strength: { label: "Strength", noun: "strength session", family: "strength" },
  bouldering: { label: "Bouldering", noun: "bouldering session", family: "climb" },
  climbing: { label: "Climbing", noun: "climb", family: "climb" },
};

const indoorSports: Record<string, Pick<SportName, "label" | "noun">> = {
  cycling: { label: "Indoor cycling", noun: "indoor ride" },
  running: { label: "Treadmill running", noun: "treadmill run" },
  walking: { label: "Treadmill walking", noun: "treadmill walk" },
  swimming: { label: "Pool swimming", noun: "pool swim" },
};

function outdoorName(sport: string): SportName {
  const known = sports[sport];
  if (known) return known;
  const words = sport.replaceAll("_", " ");
  return { label: words.charAt(0).toUpperCase() + words.slice(1), noun: words, family: "other" };
}

export function sportName(sport: string | null, indoor: boolean | null = null): SportName {
  if (!sport) return { label: "Activity", noun: "activity", family: "other" };
  const name = outdoorName(sport);
  if (!indoor) return name;
  return {
    family: name.family,
    ...(indoorSports[sport] ?? {
      label: `Indoor ${name.label.toLowerCase()}`,
      noun: `indoor ${name.noun}`,
    }),
  };
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
  indoor: boolean | null;
  startedAt: Date | null;
}) {
  if (activity.name) return activity.name;
  const { noun } = sportName(activity.sport, activity.indoor);
  return activity.startedAt ? `${partOfDay(activity.startedAt)} ${noun}` : `Untitled ${noun}`;
}
