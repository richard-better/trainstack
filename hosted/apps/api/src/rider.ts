import { and, eq } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";

import type { Database } from "./db";
import { account } from "./db/schema";

export type RiderOf = (token: string) => Promise<string | undefined>;

export function requireRider(
  riderOf: RiderOf,
  authenticatesAnotherWay: (path: string) => boolean = () => false,
): MiddlewareHandler {
  return async (c, next) => {
    if (authenticatesAnotherWay(c.req.path)) return next();
    const token = /^Bearer\s+(\S+)$/i.exec(c.req.header("Authorization") ?? "")?.[1];
    if (!token) return c.json({ error: "unauthorized" }, 401);
    const userId = await riderOf(token);
    if (!userId) return c.json({ error: "unauthorized" }, 401);
    c.set("userId" as never, userId as never);
    return next();
  };
}

export const riderId = (c: Context) => c.get("userId" as never) as string;

export async function hasAppleAccount(database: Database, userId: string) {
  const apple = await database
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "apple")))
    .get();
  return !!apple;
}
