import type { ZoneMetric } from "@trainstack/zones";

import type { ActivityAnalysis } from "./activity.ts";
import { gradeAdjustedSpeedDurations, powerEffortHeartRateDurations } from "./effort-heart-rate.ts";
import { powerCurveDurations } from "./power.ts";
import { bestEffortDistances } from "./running.ts";

export type AnalysisStatisticUnit = "s" | "m/s" | "W" | "kJ" | "ratio" | "tss" | "bpm";

export interface AnalysisStatistic {
  readonly name: string;
  readonly unit: AnalysisStatisticUnit;
  readonly description: string;
}

export const analysisStatistics: readonly AnalysisStatistic[] = [
  { name: "normalized_power_w", unit: "W", description: "Normalized power" },
  { name: "power_intensity_ratio", unit: "ratio", description: "Normalized power over FTP" },
  { name: "power_stress_tss", unit: "tss", description: "Training stress from power" },
  { name: "work_kj", unit: "kJ", description: "Mechanical work" },
  ...powerCurveDurations.map((seconds): AnalysisStatistic => ({
    name: `best_power_${seconds}s_w`,
    unit: "W",
    description: `Best average power over ${seconds} seconds`,
  })),
  {
    name: "average_grade_adjusted_speed_mps",
    unit: "m/s",
    description: "Average grade-adjusted speed",
  },
  {
    name: "normalized_grade_adjusted_speed_mps",
    unit: "m/s",
    description: "Normalized grade-adjusted speed",
  },
  {
    name: "pace_intensity_ratio",
    unit: "ratio",
    description: "Normalized grade-adjusted speed over threshold speed",
  },
  { name: "pace_stress_tss", unit: "tss", description: "Training stress from pace" },
  ...bestEffortDistances.map(({ name, metres }): AnalysisStatistic => ({
    name: `best_time_${name}_s`,
    unit: "s",
    description: `Fastest ${metres} m`,
  })),
  { name: "heart_rate_stress_tss", unit: "tss", description: "Training stress from heart rate" },
  {
    name: "sustained_max_heart_rate_bpm",
    unit: "bpm",
    description: "Highest heart rate held for 5 seconds across two records",
  },
  ...powerEffortHeartRateDurations.map((seconds): AnalysisStatistic => ({
    name: `best_power_${seconds}s_heart_rate_bpm`,
    unit: "bpm",
    description: `Average heart rate over the last two thirds of the best ${seconds} seconds of power`,
  })),
  ...gradeAdjustedSpeedDurations.flatMap((seconds): AnalysisStatistic[] => [
    {
      name: `best_grade_adjusted_speed_${seconds}s_mps`,
      unit: "m/s",
      description: `Best average grade-adjusted speed over ${seconds} seconds`,
    },
    {
      name: `best_grade_adjusted_speed_${seconds}s_heart_rate_bpm`,
      unit: "bpm",
      description: `Average heart rate over the last two thirds of the best ${seconds} seconds of grade-adjusted speed`,
    },
  ]),
  ...bestEffortDistances.map(({ name, metres }): AnalysisStatistic => ({
    name: `best_time_${name}_heart_rate_bpm`,
    unit: "bpm",
    description: `Average heart rate over the last two thirds of the fastest ${metres} m`,
  })),
  { name: "load_tss", unit: "tss", description: "The stress score that counts as the load" },
];

export const zoneTimeStatisticName = (metric: ZoneMetric, label: string) =>
  `time_in_${metric}_zone_${label.toLowerCase()}_s`;

export function statisticsOf(analysis: ActivityAnalysis): Record<string, number> {
  const values: Record<string, number | null> = {
    normalized_power_w: analysis.normalizedPowerWatts,
    power_intensity_ratio: analysis.powerIntensity,
    power_stress_tss: analysis.powerStressScore,
    work_kj: analysis.workKilojoules,
    average_grade_adjusted_speed_mps: analysis.averageGradeAdjustedSpeed,
    normalized_grade_adjusted_speed_mps: analysis.normalizedGradeAdjustedSpeed,
    pace_intensity_ratio: analysis.paceIntensity,
    pace_stress_tss: analysis.paceStressScore,
    heart_rate_stress_tss: analysis.heartRateStressScore,
    sustained_max_heart_rate_bpm: analysis.sustainedMaxHeartRate,
    load_tss: analysis.load?.stressScore ?? null,
  };
  for (const { durationSeconds, watts } of analysis.powerCurve) {
    values[`best_power_${durationSeconds}s_w`] = watts;
  }
  for (const { name, seconds } of analysis.bestEfforts) values[`best_time_${name}_s`] = seconds;
  for (const { durationSeconds, heartRate } of analysis.powerCurveHeartRates) {
    values[`best_power_${durationSeconds}s_heart_rate_bpm`] = heartRate;
  }
  for (const { durationSeconds, speed, heartRate } of analysis.bestGradeAdjustedSpeeds) {
    values[`best_grade_adjusted_speed_${durationSeconds}s_mps`] = speed;
    values[`best_grade_adjusted_speed_${durationSeconds}s_heart_rate_bpm`] = heartRate;
  }
  for (const { name, heartRate } of analysis.bestEffortHeartRates) {
    values[`best_time_${name}_heart_rate_bpm`] = heartRate;
  }
  for (const [metric, shares] of Object.entries(analysis.timeInZones)) {
    for (const { zone, seconds } of shares) {
      values[zoneTimeStatisticName(metric as ZoneMetric, zone.label)] = seconds;
    }
  }
  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, number] => entry[1] !== null),
  );
}
