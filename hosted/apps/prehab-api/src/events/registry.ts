/**
 * Event handler registry — maps domain event names to their task handlers.
 *
 * Graphile Worker uses this TaskList to dispatch jobs to the correct handler.
 * Each handler is a standalone module in ./handlers/.
 */

import type { TaskList } from "graphile-worker";
import { waitlistSignup } from "./handlers/waitlist-signup.js";
import { accountDeletionScheduled } from "./handlers/account-deletion-scheduled.js";
import { accountReactivated } from "./handlers/account-reactivated.js";
import { sessionGenerationRequested } from "./handlers/session-generation-requested.js";
import { planGenerationRequested } from "./handlers/plan-generation-requested.js";

export const taskList: TaskList = {
  waitlist_signup: waitlistSignup,
  account_deletion_scheduled: accountDeletionScheduled,
  account_reactivated: accountReactivated,
  session_generation_requested: sessionGenerationRequested,
  plan_generation_requested: planGenerationRequested,
};
