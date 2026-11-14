import { activitiesRouter } from "./activities/router";
import { calendarRouter, plannedWorkoutsRouter } from "./calendar/router";
import { api } from "./procedures";
import { settingsRouter } from "./settings/router";
import { trainingRouter } from "./training/router";
import { builtinWorkoutsRouter, workoutListsRouter, workoutsRouter } from "./workouts/router";

export const appRouter = api.router({
  healthCheck: api.healthCheck.handler(() => "OK"),
  activities: activitiesRouter,
  settings: settingsRouter,
  training: trainingRouter,
  workouts: workoutsRouter,
  builtinWorkouts: builtinWorkoutsRouter,
  workoutLists: workoutListsRouter,
  plannedWorkouts: plannedWorkoutsRouter,
  calendar: calendarRouter,
});
