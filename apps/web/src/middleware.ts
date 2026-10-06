import { defineMiddleware } from "astro:middleware";
import { createRequestLogger, initLogger } from "evlog";
import { createAxiomDrain } from "evlog/axiom";

initLogger({
  env: { service: "trainstack-web" },
  drain: createAxiomDrain(),
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
