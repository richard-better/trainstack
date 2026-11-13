import type { Context as HonoContext } from "hono";

import { ENV } from "./env.server";
import { createAuth, getDb } from "./services";

export type CreateContextOptions = {
  context: HonoContext;
};

function sentByTheWebAppOrWithABearerToken(request: Request) {
  if (/^Bearer\s/i.test(request.headers.get("Authorization") ?? "")) return true;
  const origin = request.headers.get("Origin");
  if (origin) return origin === ENV.WEB_APP_ORIGIN;
  return request.headers.get("Sec-Fetch-Site") !== "cross-site";
}

export async function createContext({ context }: CreateContextOptions) {
  const db = getDb();
  const request = context.req.raw;
  const session = await (
    await createAuth(db)
  ).api.getSession({
    headers: request.headers,
  });
  return {
    session: sentByTheWebAppOrWithABearerToken(request) ? session : null,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
