import type { IssueLog } from "./issues.ts";
import type { Block, Cue, Step } from "./model.ts";
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
  const expected = duration.expected;
  log.warn(
    "approximated",
    `The lap-button step is written as a step of its expected length, ${describeLength(expected)}`,
    at,
  );
  const within = (cue: Cue) =>
    cue.at.type !== expected.type ||
    (cue.at.type === "time" ? cue.at.seconds : cue.at.meters) <=
      (expected.type === "time" ? expected.seconds : expected.meters);
  for (const cue of step.cues ?? []) {
    if (!within(cue)) {
      log.warn("dropped", `Cue "${cue.text}" comes after the step's expected length`, at);
    }
  }
  const cues = step.cues?.filter(within);
  return {
    ...step,
    duration: expected,
    ...(cues === undefined ? {} : { cues: cues.length > 0 ? cues : undefined }),
  };
}
