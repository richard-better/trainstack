import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
import { createRequestLogger, initLogger } from "evlog";
import { createAxiomDrain } from "evlog/axiom";

import type { CoercedEnvSchema } from "./env";

const loggingEnv = env as Pick<
  CoercedEnvSchema,
  "AXIOM_API_KEY" | "AXIOM_DATASET" | "AXIOM_EDGE_URL"
>;

initLogger({
  env: { service: "trainstack-web" },
  drain:
    loggingEnv.AXIOM_API_KEY && loggingEnv.AXIOM_DATASET
      ? createAxiomDrain({
          apiKey: loggingEnv.AXIOM_API_KEY,
          dataset: loggingEnv.AXIOM_DATASET,
          edgeUrl: loggingEnv.AXIOM_EDGE_URL,
        })
      : undefined,
});

export const onRequest = defineMiddleware(async ({ request, locals }, next) => {
  const url = new URL(request.url);
  const log = createRequestLogger({
    method: request.method,
    path: url.pathname,
    waitUntil: locals.cfContext.waitUntil.bind(locals.cfContext),
  });

  locals.log = log;

  try {
    const response = await next();
    log.set({ status: response.status });
    log.emit();
    return response;
  } catch (error) {
    log.error(error instanceof Error ? error : new Error(String(error)));
    log.emit();
    throw error;
  }
});
