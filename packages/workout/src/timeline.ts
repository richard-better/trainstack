import type { Block, Cue, Repeat, Step } from "./model";

export class CuePlacementError extends RangeError {
  override readonly name = "CuePlacementError";
}

function offsetAmount(cue: Cue): number {
  return cue.at.type === "time" ? cue.at.seconds : cue.at.meters;
}

function stepAmount(step: Step, type: Cue["at"]["type"]): number | undefined {
  if (type === "time") return step.duration.type === "time" ? step.duration.seconds : undefined;
  return step.duration.type === "distance" ? step.duration.meters : undefined;
}

function withCue(step: Step, cue: Cue): Step {
  const cues = [...(step.cues ?? []), cue].sort((a, b) => offsetAmount(a) - offsetAmount(b));
  return { ...step, cues };
}

function placeCue(steps: Step[], cue: Cue): Step[] {
  const unit = cue.at.type === "time" ? "seconds" : "meters";
  let start = 0;
  for (const [index, step] of steps.entries()) {
    const length = stepAmount(step, cue.at.type);
    if (length === undefined) {
      throw new CuePlacementError(
        `A cue ${offsetAmount(cue)} ${unit} into a repeat reaches a step measured in ${step.duration.type === "time" ? "time" : "distance"}`,
      );
    }
    const end = start + length;
    const isLast = index === steps.length - 1;
    if (offsetAmount(cue) < end || (isLast && offsetAmount(cue) === end)) {
      const placed = { ...cue, at: shifted(cue.at, offsetAmount(cue) - start) };
      return steps.map((candidate, position) =>
        position === index ? withCue(candidate, placed) : candidate,
      );
    }
    start = end;
  }
  throw new CuePlacementError(
    `A cue ${offsetAmount(cue)} ${unit} into a repeat comes after the repeat ends`,
  );
}

function shifted(at: Cue["at"], amount: number): Cue["at"] {
  return at.type === "time"
    ? { type: "time", seconds: amount }
    : { type: "distance", meters: amount };
}

export function flatten(blocks: readonly Block[]): Step[] {
  return blocks.flatMap((block) => {
    if (block.type === "step") return [block];
    const once = flatten(block.steps);
    const expanded = Array.from({ length: block.count }, () => once).flat();
    return (block.cues ?? []).reduce(placeCue, expanded);
  });
}

export type Totals = { seconds: number; meters: number };

export function totals(blocks: readonly Block[]): Totals {
  return blocks.reduce<Totals>(
    (sum, block) => {
      if (block.type === "repeat") {
        const inner = totals(block.steps);
        return {
          seconds: sum.seconds + inner.seconds * block.count,
          meters: sum.meters + inner.meters * block.count,
        };
      }
      return block.duration.type === "time"
        ? { ...sum, seconds: sum.seconds + block.duration.seconds }
        : { ...sum, meters: sum.meters + block.duration.meters };
    },
    { seconds: 0, meters: 0 },
  );
}

export function repeatsWithin(blocks: readonly Block[]): Repeat[] {
  return blocks.flatMap((block) =>
    block.type === "repeat" ? [block, ...repeatsWithin(block.steps)] : [],
  );
}
