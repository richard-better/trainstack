import { readFileSync } from "node:fs";

import { type ZoneModelName, type ZoneSet, zonesOf } from "@trainstack/zones";

import type { AnalysisRecord } from "../src/index.ts";

export interface ReferenceResults {
  duration: number;
  normalizedPower?: number;
  intensityFactor?: number;
  trainingStressScore?: number;
  workKilojoules?: number;
  powerCurve: { duration: number; power: number }[];
  timeInZones: { power: number[]; heartRate: number[]; pace: number[] };
}

export interface Reference {
  thresholds: { ftp: number; maxHeartRate: number; thresholdPace: number };
  rides: { file: string; samples: number; results: ReferenceResults }[];
  synthetic: {
    name: string;
    seed: number;
    count: number;
    steps: number[];
    results: ReferenceResults;
  }[];
  trainingLoad: {
    stress: Record<string, number>;
    from: number;
    through: number;
    days: { day: number; stress: number; fitness: number; fatigue: number; form: number }[];
  };
}

export const reference = JSON.parse(
  readFileSync(new URL("fixtures/ride-reference.json", import.meta.url), "utf8"),
) as Reference;

export function zones(model: ZoneModelName, thresholds: Record<string, number>): ZoneSet {
  const set = zonesOf({ thresholds, model, customLimits: null });
  if (!set) throw new Error(`No zones for ${model}`);
  return set;
}

class Random {
  private state: bigint;
  constructor(seed: number) {
    this.state = BigInt(seed);
  }
  next(bound: number): number {
    this.state =
      (this.state * 6_364_136_223_846_793_005n + 1_442_695_040_888_963_407n) &
      0xffff_ffff_ffff_ffffn;
    return Number((this.state >> 33n) % BigInt(bound));
  }
}

export function syntheticRecords(seed: number, count: number, steps: number[]): AnalysisRecord[] {
  const random = new Random(seed);
  const records: AnalysisRecord[] = [];
  let elapsed = 0;
  for (let index = 0; index < count; index++) {
    const power = random.next(10) === 0 ? undefined : 80 + random.next(400);
    const heartRate = random.next(12) === 0 ? undefined : 90 + random.next(100);
    const speed = random.next(15) === 0 ? undefined : 5.5 + random.next(4500) / 1000;
    records.push({ elapsedSeconds: elapsed, power, heartRate, speedMetresPerSecond: speed });
    elapsed += steps[random.next(steps.length)]!;
  }
  return records;
}
