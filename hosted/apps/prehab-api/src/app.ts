import { byteRange } from "./lib/byte-range";
import fastifyCors from "@fastify/cors";
import FastifyOtelInstrumentation from "@fastify/otel";
import fastifyRateLimit from "@fastify/rate-limit";
import { OpenAPIHandler } from "@orpc/openapi/fastify";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { auth } from "./auth";
import { testDatabaseConnection } from "./db";
import { env } from "@trainstack/prehab-env/server";
import Fastify from "fastify";

import { rpcHandler } from "./rpc/handler";
import { createContext, router } from "./rpc/router";
import { registerCoachStreamRoute } from "./services/coach";

const otelInstrumentation = new FastifyOtelInstrumentation();

const apiHandler = new OpenAPIHandler(router, {
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

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
    },
  });

  // Register OTel instrumentation (must be before routes)
  await app.register(otelInstrumentation.plugin());

  // Propagate trace context in response headers
  app.addHook("onSend", (request, reply, _payload, done) => {
    const { inject } = request.opentelemetry();
    const carrier: Record<string, string> = {};
    inject(carrier);
    for (const [key, value] of Object.entries(carrier)) {
      reply.header(key, value);
    }
    done();
  });

  await app.register(fastifyCors, {
    origin: env.CORS_ORIGIN,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    credentials: true,
    maxAge: 86400,
  });

  await app.register(fastifyRateLimit, { global: false });

  app.register(async (rpcApp) => {
    // Let oRPC handle body parsing
    rpcApp.addContentTypeParser("*", (_, _payload, done) => {
      done(null, undefined);
    });

    // Rate-limit the waitlist endpoint (3 req/IP/min)
    rpcApp.all("/rpc/waitlist.subscribe", {
      config: { rateLimit: { max: 3, timeWindow: "1 minute" } },
      handler: async (request, reply) => {
        const { matched } = await rpcHandler.handle(request, reply, {
          context: await createContext(request.headers),
          prefix: "/rpc",
        });
        if (!matched) reply.status(404).send();
      },
    });

    rpcApp.all("/rpc/*", async (request, reply) => {
      const { matched } = await rpcHandler.handle(request, reply, {
        context: await createContext(request.headers),
        prefix: "/rpc",
      });
      if (!matched) reply.status(404).send();
    });

    rpcApp.all("/api-reference/*", async (request, reply) => {
      const { matched } = await apiHandler.handle(request, reply, {
        context: await createContext(request.headers),
        prefix: "/api-reference",
      });
      if (!matched) reply.status(404).send();
    });
  });

  // Better Auth catch-all route
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(request, reply) {
      try {
        const url = new URL(request.url, `http://${request.headers.host}`);
        const headers = new Headers();
        Object.entries(request.headers).forEach(([key, value]) => {
          if (value) headers.append(key, value.toString());
        });
        const req = new Request(url.toString(), {
          method: request.method,
          headers,
          body: request.body ? JSON.stringify(request.body) : undefined,
        });
        const response = await auth.handler(req);
        reply.status(response.status);
        // Forward Set-Cookie headers individually — Headers.forEach joins them
        // into a single comma-separated string which corrupts cookie parsing
        // (Expires dates contain commas). Use getSetCookie() for correct handling.
        response.headers.forEach((value, key) => {
          if (key === "set-cookie") return;
          reply.header(key, value);
        });
        for (const cookie of response.headers.getSetCookie()) {
          reply.header("set-cookie", cookie);
        }
        reply.send(response.body ? await response.text() : null);
      } catch (error) {
        app.log.error({ err: error }, "Authentication Error:");
        reply.status(500).send({
          error: "Internal authentication error",
          code: "AUTH_FAILURE",
        });
      }
    },
  });

  // Media proxy — streams S3 objects so native apps don't hit MinIO/R2 directly.
  // Supports Range requests (required by iOS AVPlayer for video playback).
  app.get("/media/*", async (request, reply) => {
    const key = (request.params as { "*": string })["*"];
    if (
      !key ||
      key.split("/").some((part) => part === ".." || part === ".") ||
      key.startsWith("/")
    ) {
      reply.status(400).send({ error: "Missing key" });
      return;
    }

    const { media: s3 } = await import("./lib/media");
    const exists = await s3.exists(key);
    if (!exists) {
      reply.status(404).send({ error: "Not found" });
      return;
    }

    const file = s3.file(key);
    const stat = await file.stat();
    const totalSize = stat.size;
    const ext = key.split(".").pop();
    const contentType =
      ext === "mp4" ? "video/mp4" : ext === "png" ? "image/png" : "application/octet-stream";

    const rangeHeader = request.headers.range;

    if (rangeHeader) {
      const range = byteRange(rangeHeader, totalSize);
      if (!range) {
        return reply.status(416).header("Content-Range", `bytes */${totalSize}`).send();
      }
      {
        const { start, end } = range;
        const chunkSize = end - start + 1;

        const blob = await file.slice(start, end + 1).arrayBuffer();

        reply
          .status(206)
          .header("Content-Type", contentType)
          .header("Content-Length", chunkSize)
          .header("Content-Range", `bytes ${start}-${end}/${totalSize}`)
          .header("Accept-Ranges", "bytes")
          .header("Cache-Control", "public, max-age=86400")
          .send(Buffer.from(blob));
        return;
      }
    }

    const blob = await file.arrayBuffer();
    reply
      .header("Content-Type", contentType)
      .header("Content-Length", totalSize)
      .header("Accept-Ranges", "bytes")
      .header("Cache-Control", "public, max-age=86400")
      .send(Buffer.from(blob));
  });

  // The durable Coach commits its response before emitting the UIMessage SSE stream.
  registerCoachStreamRoute(app);

  // Health check endpoint
  app.get("/api/health", async () => {
    const dbConnected = await testDatabaseConnection();

    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      database: dbConnected ? "connected" : "disconnected",
      environment: env.NODE_ENV,
    };
  });

  // App config endpoint for mobile clients
  app.get("/app.json", (request) => {
    const protocol = request.protocol;
    const host = request.hostname;
    const apiBaseUrl =
      env.NODE_ENV === "production" ? env.BETTER_AUTH_URL : `${protocol}://${host}:${env.PORT}`;

    return {
      environment: env.NODE_ENV === "production" ? "prod" : "dev",
      apiBaseUrl,
      auth: {
        email: true,
        apple: Boolean(
          env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET && env.APPLE_APP_BUNDLE_IDENTIFIER,
        ),
      },
      posthog:
        env.POSTHOG_API_KEY && env.POSTHOG_HOST
          ? { apiKey: env.POSTHOG_API_KEY, host: env.POSTHOG_HOST }
          : undefined,
    };
  });

  // Root endpoint
  app.get("/", async () => "OK");

  return app;
}
