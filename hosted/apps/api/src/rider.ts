import { and, eq } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";

import type { Database } from "./db";
import { account } from "./db/schema";

/** The rider authenticated by a bearer token, without falling back to cookies. */
export type RiderOf = (token: string) => Promise<string | undefined>;

/**
 * Lets a request through only with the rider's session token as `Authorization: Bearer`, and
 * keeps who they are for `riderId`. Cookies never authenticate, so a page in a browser cannot act
 * for a rider. Paths `except` lets through are left to authenticate some other way.
 */
export function requireRider(
  riderOf: RiderOf,
  except: (path: string) => boolean = () => false,
): MiddlewareHandler {
  return async (c, next) => {
    if (except(c.req.path)) return next();
    const token = /^Bearer\s+(\S+)$/i.exec(c.req.header("Authorization") ?? "")?.[1];
    if (!token) return c.json({ error: "unauthorized" }, 401);
    const userId = await riderOf(token);
    if (!userId) return c.json({ error: "unauthorized" }, 401);
    c.set("userId" as never, userId as never);
    return next();
  };
}

/** The rider `requireRider` let through. */
export const riderId = (c: Context) => c.get("userId" as never) as string;

/**
 * Whether the account was made with Sign in with Apple. Accounts from when email signup was open
 * cost nothing to make in bulk, so they cannot spend anything shared.
 */
export async function hasAppleAccount(database: Database, userId: string) {
  const apple = await database
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "apple")))
    .get();
  return !!apple;
}
