import type { ReadinessPlanned } from "./inputs.ts";
import { isHardLoad } from "./training.ts";

export const easyIntensityBelow = 0.75;
export const hardIntensityFrom = 0.85;

export type Intensity = "easy" | "moderate" | "hard" | "unknown";

export function intensityFactorOf(planned: Pick<ReadinessPlanned, "seconds" | "load">) {
  if (planned.seconds === null || planned.load === null || planned.seconds <= 0) return null;
  return Math.sqrt(planned.load / (100 * (planned.seconds / 3600)));
}

export function intensityOf(planned: ReadinessPlanned, fitness: number): Intensity {
  const factor = intensityFactorOf(planned);
  if (factor === null || planned.load === null) return "unknown";
  if (factor >= hardIntensityFrom || isHardLoad(planned.load, fitness)) return "hard";
  return factor < easyIntensityBelow ? "easy" : "moderate";
}
