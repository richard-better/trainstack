import http from "node:http";
import { Logger as GraphileLogger, run } from "graphile-worker";
import { env } from "@trainstack/prehab-env/server";
import { taskList } from "./events/registry";
import { logger } from "./lib/logger";

function createGraphileLogger(): GraphileLogger {
  return new GraphileLogger((scope) => (level, message, meta) => {
    const data = { ...scope, ...meta };
    switch (level) {
      case "error":
        logger.error(data, message);
        break;
      case "warning":
        logger.warn(data, message);
        break;
      case "info":
        logger.info(data, message);
        break;
      case "debug":
        logger.debug(data, message);
        break;
      default:
        logger.info(data, message);
        break;
    }
  });
}

export async function startWorker(): Promise<void> {
  logger.info(
    {
      concurrency: env.WORKER_CONCURRENCY,
      pollInterval: env.WORKER_POLL_INTERVAL,
    },
    "Starting event worker",
  );

  const runner = await run({
    connectionString: env.DATABASE_URL,
    concurrency: env.WORKER_CONCURRENCY,
    pollInterval: env.WORKER_POLL_INTERVAL,
    noHandleSignals: false,
    taskList,
    logger: createGraphileLogger(),
  });

  logger.info("Event worker running, processing domain events");

  // Minimal health endpoint for Cloud Run health checks
  const healthPort = env.WORKER_HEALTH_PORT;
  const healthServer = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", mode: "worker" }));
  });
  healthServer.listen(healthPort, "0.0.0.0");
  logger.info({ port: healthPort }, "Worker health endpoint listening");

  await runner.promise;
}
