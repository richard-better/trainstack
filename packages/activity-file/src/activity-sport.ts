import type { Sport, SubSport } from "@trainstack/fit";

export interface ActivitySport {
  readonly sport: string | undefined;
  readonly indoor: boolean;
}

const indoorSubSports: ReadonlySet<SubSport> = new Set<SubSport>([
  "treadmill",
  "spin",
  "indoorCycling",
  "indoorRowing",
  "indoorSkiing",
  "indoorWalking",
  "indoorRunning",
  "indoorClimbing",
  "indoorWheelchairWalk",
  "indoorWheelchairRun",
  "indoorHandCycling",
  "eBikeFitness",
  "virtualActivity",
]);

const snakeCase = (name: string) => name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

function sportName(sport: Sport | undefined, subSport: SubSport | undefined) {
  if (typeof sport !== "string" || sport === "generic") return undefined;
  if (sport === "training" && subSport === "strengthTraining") return "strength";
  if (sport === "rockClimbing") return subSport === "bouldering" ? "bouldering" : "climbing";
  return snakeCase(sport);
}

export function activitySport(
  sport: Sport | undefined,
  subSport: SubSport | undefined,
): ActivitySport {
  return {
    sport: sportName(sport, subSport),
    indoor: typeof subSport === "string" && indoorSubSports.has(subSport),
  };
}
