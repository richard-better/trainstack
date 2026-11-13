import { implement, ORPCError } from "@orpc/server";
import { appContract } from "@trainstack/contract";

import type { Context } from "./context";

export const api = implement(appContract).$context<Context>();

export const signedIn = api.use(async ({ context, next }) => {
  if (!context.session?.user) {
    throw new ORPCError("UNAUTHORIZED");
  }
  return next({ context: { session: context.session } });
});
