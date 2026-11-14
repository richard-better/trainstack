import { SmartCoercionPlugin } from "@orpc/json-schema";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError, ORPCError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { initLogger } from "evlog";
import { createAxiomDrain } from "evlog/axiom";
import { createAuthMiddleware, type BetterAuthInstance } from "evlog/better-auth";
import { evlog, type EvlogVariables } from "evlog/hono";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { appleGrantRoutes } from "./account/apple-grant";
import { exportRoutes } from "./account/export";
import { forgetSpentStravaBudgets, sweepFilesOfDeletedAccounts } from "./account/deletion";
import { analyzeDueActivities } from "./activities/analysis";
import { summarizeDueActivities } from "./activities/summary";
import { matchDueActivities } from "./activities/workouts";
import { detectDueThresholds } from "./thresholds/detection";
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
    origin: ENV.WEB_APP_ORIGIN,
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
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

const riderOfBearerToken = async (token: string) => {
  const auth = await createAuth();
  const session = await auth.api.getSession({
    headers: new Headers({ Authorization: `Bearer ${token}` }),
  });
  return session?.user.id;
};

app.route("/strava", stravaRoutes({ env: ENV, database: getDb, userId: riderOfBearerToken }));
app.route("/account", exportRoutes({ env: ENV, database: getDb }));
app.route("/account", appleGrantRoutes({ env: ENV, database: getDb, userId: riderOfBearerToken }));
app.route("/feedback", feedbackRoutes({ env: ENV, database: getDb, userId: riderOfBearerToken }));

app.on(["POST", "GET"], "/api/auth/*", async (c) => (await createAuth()).handler(c.req.raw));

function logUnexpected(error: unknown) {
  if (error instanceof ORPCError && error.status < 500) return;
  console.error(error);
}

export const apiHandler = new OpenAPIHandler(appRouter, {
  plugins: [
    new SmartCoercionPlugin({
      schemaConverters: [new ZodToJsonSchemaConverter()],
    }),
    new OpenAPIReferencePlugin({
      schemaConverters: [new ZodToJsonSchemaConverter()],
    }),
  ],
  interceptors: [onError(logUnexpected)],
});

export const rpcHandler = new RPCHandler(appRouter, {
  interceptors: [onError(logUnexpected)],
});

function downloadedNeverOpened(response: Response) {
  const disposition = response.headers.get("Content-Disposition");
  if (!disposition) return response;
  const headers = new Headers(response.headers);
  headers.set("Content-Disposition", disposition.replace(/^inline/, "attachment"));
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", "sandbox; default-src 'none'");
  return new Response(response.body, { status: response.status, headers });
}

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
    return downloadedNeverOpened(c.newResponse(apiResult.response.body, apiResult.response));
  }

  await next();
});

app.get("/", (c) => {
  return c.text("OK");
});

async function summarizeWhatIsDue() {
  const db = getDb();
  const summaries = await summarizeDueActivities(db, ENV.ACTIVITY_FILES);
  const matches = await matchDueActivities(db);
  const analyses = await analyzeDueActivities(db, ENV.ACTIVITY_FILES);
  const detections = await detectDueThresholds(db);
  const sweeps = await sweepFilesOfDeletedAccounts(ENV, db);
  await forgetSpentStravaBudgets(db);
  for (const failure of [
    ...summaries.failures,
    ...matches.failures,
    ...analyses.failures,
    ...detections.failures,
    ...sweeps.failures,
  ]) {
    console.error(failure);
  }
}

export default {
  fetch: app.fetch,
  scheduled: summarizeWhatIsDue,
} satisfies ExportedHandler<Env>;
