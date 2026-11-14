export type ActivityStatisticUnit =
  | "s"
  | "m"
  | "kcal"
  | "m/s"
  | "bpm"
  | "rpm"
  | "W"
  | "kJ"
  | "ratio"
  | "tss";

type Statistic = { name: string; unit: ActivityStatisticUnit; description: string };

const bestPower = (seconds: number, label: string) =>
  ({
    name: `best_power_${seconds}s_w`,
    unit: "W",
    description: `Best average power over ${label}`,
  }) as const;

const bestTime = (name: string, label: string) =>
  ({ name: `best_time_${name}_s`, unit: "s", description: `Fastest ${label}` }) as const;

export const activityStatistics = [
  { name: "elapsed_s", unit: "s", description: "Time from start to finish, pauses included" },
  { name: "timer_s", unit: "s", description: "Time moving or recording, pauses left out" },
  { name: "distance_m", unit: "m", description: "Distance covered" },
  { name: "calories_kcal", unit: "kcal", description: "Energy spent" },
  { name: "average_speed_mps", unit: "m/s", description: "Average speed" },
  { name: "max_speed_mps", unit: "m/s", description: "Highest speed" },
  { name: "average_heart_rate_bpm", unit: "bpm", description: "Average heart rate" },
  { name: "max_heart_rate_bpm", unit: "bpm", description: "Highest heart rate" },
  { name: "average_cadence_rpm", unit: "rpm", description: "Average cadence" },
  { name: "max_cadence_rpm", unit: "rpm", description: "Highest cadence" },
  { name: "average_power_w", unit: "W", description: "Average power" },
  { name: "max_power_w", unit: "W", description: "Highest power" },
  { name: "ascent_m", unit: "m", description: "Total climbing" },
  { name: "descent_m", unit: "m", description: "Total descending" },
] as const satisfies readonly Statistic[];

export const analysisStatistics = [
  { name: "normalized_power_w", unit: "W", description: "Normalized power" },
  { name: "power_intensity_ratio", unit: "ratio", description: "Normalized power over FTP" },
  { name: "power_stress_tss", unit: "tss", description: "Training stress from power" },
  { name: "work_kj", unit: "kJ", description: "Mechanical work" },
  bestPower(5, "5 seconds"),
  bestPower(15, "15 seconds"),
  bestPower(30, "30 seconds"),
  bestPower(60, "1 minute"),
  bestPower(300, "5 minutes"),
  bestPower(600, "10 minutes"),
  bestPower(1200, "20 minutes"),
  bestPower(1800, "30 minutes"),
  bestPower(3600, "60 minutes"),
  {
    name: "average_grade_adjusted_speed_mps",
    unit: "m/s",
    description: "Average grade-adjusted speed, for running",
  },
  {
    name: "normalized_grade_adjusted_speed_mps",
    unit: "m/s",
    description: "Normalized grade-adjusted speed, for running",
  },
  {
    name: "pace_intensity_ratio",
    unit: "ratio",
    description: "Normalized grade-adjusted speed over threshold speed",
  },
  { name: "pace_stress_tss", unit: "tss", description: "Training stress from pace" },
  bestTime("400m", "400 m"),
  bestTime("1km", "1 km"),
  bestTime("mile", "mile"),
  bestTime("5km", "5 km"),
  bestTime("10km", "10 km"),
  bestTime("half_marathon", "half marathon"),
  bestTime("marathon", "marathon"),
  { name: "heart_rate_stress_tss", unit: "tss", description: "Training stress from heart rate" },
  {
    name: "load_tss",
    unit: "tss",
    description:
      "The stress score that counts toward fitness and fatigue: for running pace, then power, then heart rate; for any other sport power, then heart rate",
  },
] as const satisfies readonly Statistic[];

export type ActivityStatisticName = (typeof activityStatistics)[number]["name"];
export type AnalysisStatisticName = (typeof analysisStatistics)[number]["name"];

export const zoneTimeStatisticPattern = /^time_in_(heart_rate|power|pace)_zone_[a-z0-9]+_s$/;

export const zoneTimeStatisticDescription =
  "time_in_<metric>_zone_<label>_s: seconds in each heart_rate, power or pace zone of the activity's day, such as time_in_power_zone_3_s or time_in_heart_rate_zone_5a_s";
