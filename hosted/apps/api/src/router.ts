import { activitiesRouter } from "./activities/router";
import { api } from "./procedures";
import { settingsRouter } from "./settings/router";
import { builtinWorkoutsRouter, workoutListsRouter, workoutsRouter } from "./workouts/router";

export const appRouter = api.router({
  healthCheck: api.healthCheck.handler(() => "OK"),
  activities: activitiesRouter,
  settings: settingsRouter,
  workouts: workoutsRouter,
  builtinWorkouts: builtinWorkoutsRouter,
  workoutLists: workoutListsRouter,
});
