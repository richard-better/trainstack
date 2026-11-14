import type { Context as HonoContext } from "hono";

import { ENV } from "./env.server";
import { createAuth, getDb } from "./services";

export type CreateContextOptions = {
  context: HonoContext;
};

function cookiesCount(request: Request) {
  const origin = request.headers.get("Origin");
  if (origin) return origin === ENV.WEB_APP_ORIGIN;
  return request.headers.get("Sec-Fetch-Site") !== "cross-site";
}

export async function sessionOf(request: Request) {
  const headers = new Headers(request.headers);
  if (!cookiesCount(request)) headers.delete("Cookie");
  return (await createAuth(getDb())).api.getSession({ headers });
}

export async function createContext({ context }: CreateContextOptions) {
  return { session: await sessionOf(context.req.raw) };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
