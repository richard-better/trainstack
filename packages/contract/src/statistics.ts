export type ActivityStatisticUnit = "s" | "m" | "kcal" | "m/s" | "bpm" | "rpm" | "W";

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
] as const satisfies readonly {
  name: string;
  unit: ActivityStatisticUnit;
  description: string;
}[];

export type ActivityStatisticName = (typeof activityStatistics)[number]["name"];
