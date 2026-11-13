import type { Sport, SubSport } from "@trainstack/fit";

export interface SportAndSubSport {
  readonly sport: Sport | undefined;
  readonly subSport: SubSport | undefined;
}

const sportsByName: Readonly<Record<string, readonly [Sport, SubSport?]>> = {
  "1": ["cycling"],
  "9": ["running"],
  biking: ["cycling"],
  bike: ["cycling"],
  cycling: ["cycling"],
  ride: ["cycling"],
  roadbiking: ["cycling", "road"],
  roadcycling: ["cycling", "road"],
  mountainbiking: ["cycling", "mountain"],
  mountainbikeride: ["cycling", "mountain"],
  gravelcycling: ["cycling", "gravelCycling"],
  gravelride: ["cycling", "gravelCycling"],
  indoorcycling: ["cycling", "indoorCycling"],
  virtualride: ["cycling", "virtualActivity"],
  ebikeride: ["eBiking"],
  ebiking: ["eBiking"],
  running: ["running"],
  run: ["running"],
  trailrunning: ["running", "trail"],
  trailrun: ["running", "trail"],
  treadmillrunning: ["running", "treadmill"],
  virtualrun: ["running", "virtualActivity"],
  walking: ["walking"],
  walk: ["walking"],
  hiking: ["hiking"],
  hike: ["hiking"],
  swimming: ["swimming"],
  swim: ["swimming"],
  openwaterswimming: ["swimming", "openWater"],
  lapswimming: ["swimming", "lapSwimming"],
  rowing: ["rowing"],
  rowing_v2: ["rowing"],
  crosscountryskiing: ["crossCountrySkiing"],
  nordicski: ["crossCountrySkiing"],
  alpineskiing: ["alpineSkiing"],
  alpineski: ["alpineSkiing"],
  other: ["generic"],
  generic: ["generic"],
};

export function sportFromName(name: string | undefined): SportAndSubSport {
  const key = name?.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
  const match = key === undefined ? undefined : sportsByName[key];
  return { sport: match?.[0], subSport: match?.[1] };
}
