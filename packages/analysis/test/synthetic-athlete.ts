import { emptyProfile } from "@trainstack/zones";

import {
  type AnalysisRecord,
  analyzeActivity,
  statisticsOf,
  type ThresholdActivity,
} from "../src/index.ts";

export function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Random = ReturnType<typeof seeded>;

export interface Athlete {
  readonly criticalPower: number;
  readonly wPrimeJoules: number;
  readonly hourSpeed: number;
  readonly heartRateAtThreshold: number;
  readonly maxHeartRate: number;
}

export const athlete: Athlete = {
  criticalPower: 268,
  wPrimeJoules: 18_000,
  hourSpeed: 4,
  heartRateAtThreshold: 170,
  maxHeartRate: 190,
};

const longDurationExponent = -0.07;
const riegelSpeedExponent = -0.06 / 1.06;

export const maximalPower = ({ criticalPower, wPrimeJoules }: Athlete, seconds: number) =>
  seconds <= 1200
    ? criticalPower + wPrimeJoules / seconds
    : (criticalPower + wPrimeJoules / 1200) * (seconds / 1200) ** longDurationExponent;

export const trueFtp = (who: Athlete) => maximalPower(who, 3600);

export const maximalSpeed = ({ hourSpeed }: Athlete, seconds: number) =>
  hourSpeed * (seconds / 3600) ** riegelSpeedExponent;

export const raceSeconds = (who: Athlete, metres: number) =>
  (metres / (who.hourSpeed * 3600 ** -riegelSpeedExponent)) ** (1 / (1 + riegelSpeedExponent));

export const steadyHeartRate = (who: Athlete, share: number) =>
  Math.min(who.maxHeartRate, who.heartRateAtThreshold * (0.55 + 0.45 * share));

export const frielHeartRate = (who: Athlete, sport: "cycling" | "running") =>
  steadyHeartRate(
    who,
    sport === "cycling"
      ? maximalPower(who, 1800) / trueFtp(who)
      : maximalSpeed(who, 1800) / who.hourSpeed,
  );

export type Block = { readonly seconds: number; readonly share: number };

export const maximal = (who: Athlete, sport: "cycling" | "running", seconds: number): Block => ({
  seconds,
  share:
    sport === "cycling"
      ? maximalPower(who, seconds) / trueFtp(who)
      : maximalSpeed(who, seconds) / who.hourSpeed,
});

export const easy = (seconds: number, share = 0.65): Block => ({ seconds, share });

const heartRateLagSeconds = 20;

export function recordsOf(
  who: Athlete,
  sport: "cycling" | "running",
  blocks: readonly Block[],
  random: Random,
  { heartRate = true }: { heartRate?: boolean } = {},
): AnalysisRecord[] {
  const records: AnalysisRecord[] = [];
  const ftp = trueFtp(who);
  let pulse = who.heartRateAtThreshold * 0.5;
  let distance = 0;
  let second = 0;
  const follow = 1 - Math.exp(-1 / heartRateLagSeconds);
  for (const { seconds, share } of blocks) {
    for (let index = 0; index < seconds; index++, second++) {
      const noisy = share * (1 + (random() - 0.5) * 0.1);
      pulse += (steadyHeartRate(who, share) - pulse) * follow;
      const record: { -readonly [K in keyof AnalysisRecord]: AnalysisRecord[K] } = {
        elapsedSeconds: second,
      };
      if (heartRate) record.heartRate = Math.round(pulse + (random() - 0.5) * 2);
      if (sport === "cycling") record.power = Math.round(noisy * ftp);
      else {
        const speed = noisy * who.hourSpeed;
        distance += speed;
        record.speedMetresPerSecond = speed;
        record.distanceMetres = distance;
      }
      records.push(record);
    }
  }
  return records;
}

export function activityOf(
  id: string,
  day: string,
  sport: "cycling" | "running",
  records: readonly AnalysisRecord[],
  indoor = false,
): ThresholdActivity {
  const analysis = analyzeActivity(
    {
      summary: {
        startTime: new Date(`${day}T07:00:00Z`),
        sport,
        subSport: indoor ? (sport === "cycling" ? "indoorCycling" : "treadmill") : undefined,
        elapsedSeconds: records.at(-1)?.elapsedSeconds ?? 0,
      },
      records,
    },
    emptyProfile(),
  );
  return { id, day, sport, indoor, statistics: statisticsOf(analysis) };
}

export const dayBefore = (today: string, days: number) =>
  new Date(Date.parse(`${today}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

const pick = <T>(random: Random, options: readonly T[]) =>
  options[Math.floor(random() * options.length)]!;

export function trainingRide(random: Random): Block[] {
  const kind = pick(random, ["endurance", "tempo", "sweetSpot", "vo2"] as const);
  const warmUp = easy(900, 0.55);
  switch (kind) {
    case "endurance":
      return Array.from({ length: 6 }, () =>
        easy(600 + Math.round(random() * 600), 0.58 + random() * 0.14),
      );
    case "tempo":
      return [warmUp, easy(1200, 0.8), easy(300, 0.5), easy(1200, 0.8), easy(900, 0.55)];
    case "sweetSpot":
      return [warmUp, ...Array.from({ length: 3 }, () => [easy(720, 0.9), easy(300, 0.5)]).flat()];
    case "vo2":
      return [warmUp, ...Array.from({ length: 5 }, () => [easy(240, 1.12), easy(240, 0.5)]).flat()];
  }
}

export function trainingRun(random: Random): Block[] {
  const kind = pick(random, ["easy", "long", "intervals"] as const);
  switch (kind) {
    case "easy":
      return [easy(2400 + Math.round(random() * 1200), 0.74 + random() * 0.06)];
    case "long":
      return [easy(4800, 0.72)];
    case "intervals":
      return [
        easy(900, 0.72),
        ...Array.from({ length: 6 }, () => [easy(180, 1.06), easy(120, 0.6)]).flat(),
        easy(600, 0.7),
      ];
  }
}

export interface Season {
  readonly today: string;
  readonly days: number;
  readonly sport: "cycling" | "running";
  readonly seed: number;
  readonly tests?: readonly { readonly daysAgo: number; readonly blocks: readonly Block[] }[];
  readonly training?: (random: Random) => Block[];
  readonly indoor?: boolean;
  readonly heartRate?: boolean;
  readonly who?: Athlete;
}

export function season({
  today,
  days,
  sport,
  seed,
  tests = [],
  training = sport === "cycling" ? trainingRide : trainingRun,
  indoor = false,
  heartRate = true,
  who = athlete,
}: Season): ThresholdActivity[] {
  const random = seeded(seed);
  const activities: ThresholdActivity[] = [];
  for (let daysAgo = days; daysAgo >= 0; daysAgo--) {
    const test = tests.find((entry) => entry.daysAgo === daysAgo);
    if (!test && daysAgo % 2 === 1) continue;
    const blocks = test ? test.blocks : training(random);
    const records = recordsOf(who, sport, blocks, random, { heartRate });
    activities.push(
      activityOf(`${sport}-${daysAgo}`, dayBefore(today, daysAgo), sport, records, indoor),
    );
  }
  return activities;
}

export const cyclingTests = (who: Athlete, daysAgo: number) => [
  { daysAgo, blocks: [easy(900, 0.55), maximal(who, "cycling", 300), easy(900, 0.5)] },
  { daysAgo: daysAgo - 3, blocks: [easy(900, 0.55), maximal(who, "cycling", 600), easy(900, 0.5)] },
  {
    daysAgo: daysAgo - 7,
    blocks: [easy(900, 0.55), maximal(who, "cycling", 1200), easy(900, 0.5)],
  },
  {
    daysAgo: daysAgo - 11,
    blocks: [easy(900, 0.55), maximal(who, "cycling", 1800), easy(900, 0.5)],
  },
];

export const race = (who: Athlete, metres: number): Block[] => {
  const seconds = Math.round(raceSeconds(who, metres));
  return [easy(900, 0.7), maximal(who, "running", seconds), easy(600, 0.65)];
};
