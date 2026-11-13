import { activitiesRouter } from "./activities/router";
import { api } from "./procedures";

export const appRouter = api.router({
  healthCheck: api.healthCheck.handler(() => "OK"),
  activities: activitiesRouter,
});
