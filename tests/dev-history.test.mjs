import assert from "node:assert/strict";
import { test } from "node:test";
import { seedPlan, trainingHistory } from "../scripts/dev-history.mjs";

test("seeded cycling plans agree with rides on normal weeks while retaining recovery misses", async () => {
  const today = new Date("2026-11-14T12:00:00Z");
  const planned = [];
  await seedPlan(
    {
      plannedWorkouts: {
        put: async (item) => {
          planned.push(item);
          return item;
        },
        skip: async () => {},
      },
    },
    { today },
  );
  const { activities: rides } = trainingHistory({ today });
  let matching = 0;
  let different = 0;
  for (const item of planned.filter((item) => item.content.workout?.sport === "cycling")) {
    const ride = rides.find((ride) => ride.sport === "cycling" && ride.start.startsWith(item.day));
    if (!ride) continue;
    const steps = item.content.workout.steps;
    const plannedSeconds = steps.reduce((sum, step) => sum + step.duration.seconds, 0);
    const riddenSeconds = ride.blocks.reduce((sum, block) => sum + (block.seconds ?? 0), 0);
    if (plannedSeconds === riddenSeconds) matching++;
    else different++;
    if (item.content.workout.name === "Long endurance 150") {
      assert.equal(plannedSeconds, 9000);
      assert.equal(riddenSeconds, 9000);
    }
  }
  assert.ok(matching > different, `${matching} matches, ${different} misses`);
  assert.ok(different > 0);
});
