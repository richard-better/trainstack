import {
  metricSettings,
  paceDistanceMetres,
  type Profile,
  type ZoneMetric,
  zonesFor,
} from "@trainstack/zones";

import { heartRateStressScore } from "./heart-rate.ts";
import {
  intensity,
  normalizedAverage,
  normalizedPower,
  powerCurve,
  type PowerCurvePoint,
  stressScore,
  workKilojoules,
} from "./power.ts";
import { type BestEffort, bestEfforts, gradeAdjustedSpeeds } from "./running.ts";
import {
  type AnalysisRecord,
  averageWhileHeld,
  perSecond,
  type Samples,
  samplesOf,
  sliceSamples,
} from "./samples.ts";
import { timeInZones, type ZoneShare } from "./zones.ts";

export interface AnalysisLap {
  readonly startTime: Date | undefined;
  readonly elapsedSeconds: number | undefined;
}

export interface AnalysisActivity {
  readonly summary: {
    readonly startTime: Date;
    readonly sport: string | number | undefined;
    readonly subSport: string | number | undefined;
    readonly elapsedSeconds: number;
  };
  readonly records: readonly AnalysisRecord[];
  readonly laps?: readonly AnalysisLap[];
}

export type LoadSource = "power" | "pace" | "heart_rate";

export interface ActivityLoad {
  readonly stressScore: number;
  readonly source: LoadSource;
}

export interface LapAnalysis {
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly normalizedPowerWatts: number | null;
  readonly workKilojoules: number | null;
  readonly averageGradeAdjustedSpeed: number | null;
}

export interface ActivityAnalysis {
  readonly sport: string | null;
  readonly normalizedPowerWatts: number | null;
  readonly powerIntensity: number | null;
  readonly powerStressScore: number | null;
  readonly workKilojoules: number | null;
  readonly powerCurve: readonly PowerCurvePoint[];
  readonly averageGradeAdjustedSpeed: number | null;
  readonly normalizedGradeAdjustedSpeed: number | null;
  readonly paceIntensity: number | null;
  readonly paceStressScore: number | null;
  readonly bestEfforts: readonly BestEffort[];
  readonly heartRateStressScore: number | null;
  readonly timeInZones: Partial<Record<ZoneMetric, readonly ZoneShare[]>>;
  readonly load: ActivityLoad | null;
  readonly laps: readonly LapAnalysis[];
}

const zoneSports: Readonly<Record<string, string>> = {
  running: "running",
  cycling: "cycling",
  swimming: "swimming",
  rowing: "rowing",
};

export function zoneSport(
  sport: string | number | undefined,
  subSport: string | number | undefined,
): string | null {
  if (sport === "training" && subSport === "strengthTraining") return "strength";
  if (typeof sport !== "string") return null;
  return Object.hasOwn(zoneSports, sport) ? zoneSports[sport]! : sport;
}

function heartRateThresholds(profile: Profile, sport: string | null) {
  const thresholds = metricSettings(profile, "heart_rate", sport)?.thresholds ?? {};
  const resting = thresholds.resting_heart_rate;
  const max = thresholds.max_heart_rate;
  const lactateThreshold = thresholds.lactate_threshold_heart_rate;
  if (resting === undefined || max === undefined || lactateThreshold === undefined) return null;
  return { resting, max, lactateThreshold };
}

function zoneTimes(samples: Samples, profile: Profile, sport: string | null) {
  const result: Partial<Record<ZoneMetric, readonly ZoneShare[]>> = {};
  const paceDistance = sport === null ? undefined : paceDistanceMetres(sport);
  for (const metric of ["heart_rate", "power", "pace"] as const) {
    const zones = zonesFor(profile, metric, sport);
    if (!zones) continue;
    const shares = timeInZones(samples, zones, paceDistance);
    if (shares.length > 0) result[metric] = shares;
  }
  return result;
}

function chooseLoad(
  sport: string | null,
  scores: Record<LoadSource, number | null>,
): ActivityLoad | null {
  const order: readonly LoadSource[] =
    sport === "running" ? ["pace", "power", "heart_rate"] : ["power", "heart_rate"];
  for (const source of order) {
    const stressScore = scores[source];
    if (stressScore !== null) return { stressScore, source };
  }
  return null;
}

function firstAtOrAfter(elapsed: Float64Array, seconds: number) {
  let low = 0;
  let high = elapsed.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (elapsed[middle]! < seconds) low = middle + 1;
    else high = middle;
  }
  return low;
}

function lapRanges(activity: AnalysisActivity) {
  const start = activity.summary.startTime.getTime();
  const laps = (activity.laps ?? []).flatMap((lap) =>
    lap.startTime === undefined
      ? []
      : [{ lap, startSeconds: (lap.startTime.getTime() - start) / 1000 }],
  );
  return laps.map(({ lap, startSeconds }, index) => ({
    startSeconds,
    endSeconds:
      lap.elapsedSeconds === undefined
        ? (laps[index + 1]?.startSeconds ?? activity.summary.elapsedSeconds)
        : startSeconds + lap.elapsedSeconds,
  }));
}

function lapAnalysis(
  activity: AnalysisActivity,
  samples: Samples,
  gradeAdjusted: Float64Array,
): LapAnalysis[] {
  return lapRanges(activity).map(({ startSeconds, endSeconds }) => {
    const first = firstAtOrAfter(samples.elapsed, startSeconds);
    const end = firstAtOrAfter(samples.elapsed, endSeconds);
    const lap = sliceSamples(samples, first, end);
    return {
      startSeconds,
      endSeconds,
      normalizedPowerWatts: normalizedPower(perSecond(lap, lap.power)),
      workKilojoules: workKilojoules(lap),
      averageGradeAdjustedSpeed: averageWhileHeld(lap, gradeAdjusted.subarray(first, end)),
    };
  });
}

export function analyzeActivity(activity: AnalysisActivity, profile: Profile): ActivityAnalysis {
  const sport = zoneSport(activity.summary.sport, activity.summary.subSport);
  const duration = activity.summary.elapsedSeconds;
  const samples = samplesOf(activity.records, sport);

  const powerPerSecond = perSecond(samples, samples.power);
  const normalizedPowerWatts = normalizedPower(powerPerSecond);
  const ftp = metricSettings(profile, "power", sport)?.thresholds.ftp;
  const powerIntensity = intensity(normalizedPowerWatts, ftp);
  const powerStressScore = stressScore(duration, powerIntensity);

  const running = sport === "running";
  const gradeAdjusted = running ? gradeAdjustedSpeeds(samples) : samples.speed.map(() => NaN);
  const averageGradeAdjustedSpeed = running ? averageWhileHeld(samples, gradeAdjusted) : null;
  const normalizedGradeAdjustedSpeed = running
    ? normalizedAverage(perSecond(samples, gradeAdjusted))
    : null;
  const thresholdPace =
    sport === null ? undefined : metricSettings(profile, "pace", sport)?.thresholds.threshold_pace;
  const paceDistance = sport === null ? undefined : paceDistanceMetres(sport);
  const thresholdSpeed =
    running && thresholdPace !== undefined && paceDistance !== undefined
      ? paceDistance / thresholdPace
      : undefined;
  const paceIntensity = intensity(normalizedGradeAdjustedSpeed, thresholdSpeed);
  const paceStressScore = stressScore(duration, paceIntensity);

  const heartRate = heartRateThresholds(profile, sport);
  const heartRateStress = heartRate ? heartRateStressScore(samples, heartRate) : null;

  return {
    sport,
    normalizedPowerWatts,
    powerIntensity,
    powerStressScore,
    workKilojoules: workKilojoules(samples),
    powerCurve: powerCurve(powerPerSecond),
    averageGradeAdjustedSpeed,
    normalizedGradeAdjustedSpeed,
    paceIntensity,
    paceStressScore,
    bestEfforts: running ? bestEfforts(samples) : [],
    heartRateStressScore: heartRateStress,
    timeInZones: zoneTimes(samples, profile, sport),
    load: chooseLoad(sport, {
      power: powerStressScore,
      pace: paceStressScore,
      heart_rate: heartRateStress,
    }),
    laps: lapAnalysis(activity, samples, gradeAdjusted),
  };
}
