import type { IssueLog } from "./issues.ts";
import type { Block, Step } from "./model.ts";
import { describeLength } from "./numbers.ts";

export function withOpenStepsTimed(
  log: IssueLog,
  blocks: readonly Block[],
  approximate: boolean | undefined,
  at = "steps",
): Block[] {
  return blocks.map((block, index) => {
    const where = `${at}.${index}`;
    if (block.type === "repeat") {
      return {
        ...block,
        steps: withOpenStepsTimed(log, block.steps, approximate, `${where}.steps`),
      };
    }
    return timedStep(log, block, approximate, where);
  });
}

function timedStep(log: IssueLog, step: Step, approximate: boolean | undefined, at: string): Step {
  const duration = step.duration;
  if (duration.type !== "open") return step;
  if (!approximate) {
    log.fail("unsupported", `A lap-button step has no place in a .${log.format} file`, at);
    return step;
  }
  if (!duration.expected) {
    log.fail(
      "unsupported",
      "A lap-button step with no expected length cannot be written as a timed step",
      at,
    );
    return step;
  }
  log.warn(
    "approximated",
    `The lap-button step is written as a step of its expected length, ${describeLength(duration.expected)}`,
    at,
  );
  return { ...step, duration: duration.expected };
}
