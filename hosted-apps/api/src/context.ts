import type { Context as ApiContext } from "@trainstack/hosted-contract/context";
import type { Context as HonoContext } from "hono";

import { createAuth, getDb } from "./services";

export type CreateContextOptions = {
  context: HonoContext;
};

export async function createContext({ context }: CreateContextOptions): Promise<ApiContext> {
  const db = getDb();
  const session = await (await createAuth(db)).api.getSession({
    headers: context.req.raw.headers,
  });
  return {
    session,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
