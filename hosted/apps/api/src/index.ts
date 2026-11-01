import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { initLogger } from "evlog";
import { createAxiomDrain } from "evlog/axiom";
import { createAuthMiddleware, type BetterAuthInstance } from "evlog/better-auth";
import { evlog, type EvlogVariables } from "evlog/hono";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { createContext } from "./context";
import { ENV } from "./env.server";
import { feedbackRoutes } from "./feedback";
import { appRouter } from "./router";
import { createAuth, getDb } from "./services";
import { stravaRoutes } from "./strava";

initLogger({
  env: { service: "trainstack-api" },
});

const identifyUser = createAuthMiddleware((await createAuth()) as BetterAuthInstance, {
  exclude: ["/api/auth/**"],
  maskEmail: true,
});

const app = new Hono<EvlogVariables>();

app.use(
  evlog({
    drain:
      ENV.AXIOM_API_KEY && ENV.AXIOM_DATASET
        ? createAxiomDrain({
            apiKey: ENV.AXIOM_API_KEY,
            dataset: ENV.AXIOM_DATASET,
            edgeUrl: ENV.AXIOM_EDGE_URL,
          })
        : undefined,
  }),
);
app.use("*", async (c, next) => {
  await identifyUser(c.get("log"), c.req.raw.headers, c.req.path);
  await next();
});

app.use(
  "/*",
  cors({
    origin: ENV.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.get("/health", async (c) => {
  c.header("Cache-Control", "no-store");
  try {
    await ENV.DB.prepare('SELECT 1 FROM "user" LIMIT 1').first();
    return c.json({ status: "ok" });
  } catch (error) {
    c.get("log").error(error instanceof Error ? error : new Error(String(error)));
    return c.json({ status: "unavailable" }, 503);
  }
});

/** The rider a session token belongs to, read from the token alone. */
const riderOf = async (token: string) => {
  const auth = await createAuth();
  const session = await auth.api.getSession({
    headers: new Headers({ Authorization: `Bearer ${token}` }),
  });
  return session?.user.id;
};

app.route("/strava", stravaRoutes({ env: ENV, database: getDb, userId: riderOf }));
app.route("/feedback", feedbackRoutes({ env: ENV, database: getDb, userId: riderOf }));

app.on(["POST", "GET"], "/api/auth/*", async (c) => (await createAuth()).handler(c.req.raw));

export const apiHandler = new OpenAPIHandler(appRouter, {
  plugins: [
    new OpenAPIReferencePlugin({
      schemaConverters: [new ZodToJsonSchemaConverter()],
    }),
  ],
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});

export const rpcHandler = new RPCHandler(appRouter, {
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});

app.use("/*", async (c, next) => {
  const context = await createContext({ context: c });

  const rpcResult = await rpcHandler.handle(c.req.raw, {
    prefix: "/rpc",
    context: context,
  });

  if (rpcResult.matched) {
    return c.newResponse(rpcResult.response.body, rpcResult.response);
  }

  const apiResult = await apiHandler.handle(c.req.raw, {
    prefix: "/api-reference",
    context: context,
  });

  if (apiResult.matched) {
    return c.newResponse(apiResult.response.body, apiResult.response);
  }

  await next();
});

app.get("/", (c) => {
  return c.text("OK");
});

export default app;
