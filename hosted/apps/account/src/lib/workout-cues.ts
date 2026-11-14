import type { Cue } from "@trainstack/workout";

import { formatMeters, formatSpan } from "./workout-profile.ts";

export function cueText(cue: Cue) {
  const offset = cue.at.type === "time" ? cue.at.seconds : cue.at.meters;
  if (offset === 0) return `At the start: ${cue.text}`;
  const at = cue.at.type === "time" ? formatSpan(offset) : formatMeters(offset);
  return `${at} in: ${cue.text}`;
}
