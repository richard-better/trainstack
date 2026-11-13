import { activitiesRouter } from "./activities/router";
import { api } from "./procedures";
import { settingsRouter } from "./settings/router";

export const appRouter = api.router({
  healthCheck: api.healthCheck.handler(() => "OK"),
  activities: activitiesRouter,
  settings: settingsRouter,
});
