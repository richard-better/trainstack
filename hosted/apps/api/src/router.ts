import { implement, ORPCError } from "@orpc/server";
import { appContract } from "@trainstack/contract";

import type { Context } from "./context";

const api = implement(appContract).$context<Context>();

const requireAuth = api.middleware(async ({ context, next }) => {
  if (!context.session?.user) {
    throw new ORPCError("UNAUTHORIZED");
  }
  return next({ context: { session: context.session } });
});

export const appRouter = api.router({
  healthCheck: api.healthCheck.handler(() => "OK"),
  privateData: api.privateData.use(requireAuth).handler(({ context }) => ({
    message: "This is private",
    user: context.session.user,
  })),
});
