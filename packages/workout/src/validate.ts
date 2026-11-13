import type { IssueLog } from "./issues";
import { type Workout, workoutSchema } from "./model";

export function validated(log: IssueLog, workout: Workout): Workout {
  const parsed = workoutSchema.safeParse(workout);
  if (parsed.success) return parsed.data;
  for (const issue of parsed.error.issues) {
    log.fail("malformed", issue.message, issue.path.join("."));
  }
  return workout;
}

export function checkedInput(log: IssueLog, workout: Workout): Workout | undefined {
  const parsed = workoutSchema.safeParse(workout);
  if (parsed.success) return parsed.data;
  for (const issue of parsed.error.issues) {
    log.fail("malformed", `The workout is not valid: ${issue.message}`, issue.path.join("."));
  }
  return undefined;
}
