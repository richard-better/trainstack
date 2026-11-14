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
  | "tss"
  | "au";

type Statistic = { name: string; unit: ActivityStatisticUnit; description: string };

const bestPower = <const Seconds extends number>(seconds: Seconds, label: string) =>
  ({
    name: `best_power_${seconds}s_w` as const,
    unit: "W",
    description: `Best average power over ${label}`,
  }) as const;

const bestTime = <const Name extends string>(name: Name, label: string) =>
  ({ name: `best_time_${name}_s` as const, unit: "s", description: `Fastest ${label}` }) as const;

const effortHeartRate = <const Effort extends string>(effort: Effort, label: string) =>
  ({
    name: `${effort}_heart_rate_bpm` as const,
    unit: "bpm",
    description: `Average heart rate over the last two thirds of ${label}`,
  }) as const;

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
    name: "sustained_max_heart_rate_bpm",
    unit: "bpm",
    description:
      "Highest heart rate held for 5 seconds across two records, so one bad record does not count",
  },
  effortHeartRate("best_power_1200s", "the best 20 minutes of power"),
  effortHeartRate("best_power_1800s", "the best 30 minutes of power"),
  {
    name: "best_grade_adjusted_speed_1800s_mps",
    unit: "m/s",
    description: "Best average grade-adjusted speed over 30 minutes, for running",
  },
  effortHeartRate("best_grade_adjusted_speed_1800s", "the best 30 minutes of grade-adjusted speed"),
  effortHeartRate("best_time_400m", "the fastest 400 m"),
  effortHeartRate("best_time_1km", "the fastest 1 km"),
  effortHeartRate("best_time_mile", "the fastest mile"),
  effortHeartRate("best_time_5km", "the fastest 5 km"),
  effortHeartRate("best_time_10km", "the fastest 10 km"),
  effortHeartRate("best_time_half_marathon", "the fastest half marathon"),
  effortHeartRate("best_time_marathon", "the fastest marathon"),
  {
    name: "load_tss",
    unit: "tss",
    description:
      "The stress score that counts toward fitness and fatigue: for running pace, then power, then heart rate; for any other sport power, then heart rate",
  },
] as const satisfies readonly Statistic[];

export const loggedStatistics = [
  {
    name: "session_rpe_load_au",
    unit: "au",
    description: "Foster's session RPE load of a logged session: its RPE times its minutes",
  },
  {
    name: "rpe_stress_tss",
    unit: "tss",
    description:
      "Training stress estimated from a logged session's RPE: Friel's TSS per hour for the RPE times hours. It is the load_tss of a logged session",
  },
] as const satisfies readonly Statistic[];

export type ActivityStatisticName = (typeof activityStatistics)[number]["name"];
export type AnalysisStatisticName = (typeof analysisStatistics)[number]["name"];

export const zoneTimeStatisticPattern = /^time_in_(heart_rate|power|pace)_zone_[a-z0-9]+_s$/;

export const zoneTimeStatisticDescription =
  "time_in_<metric>_zone_<label>_s: seconds in each heart_rate, power or pace zone of the activity's day, such as time_in_power_zone_3_s or time_in_heart_rate_zone_5a_s";
