/**
 * Event system initialization.
 *
 * On the API side, this ensures the graphile_worker schema exists (runs
 * migrations) so that emitEvent() can call graphile_worker.add_job().
 *
 * On the worker side, graphile-worker's run() handles migrations automatically.
 */

import { type WorkerUtils, makeWorkerUtils } from "graphile-worker";
import { env } from "@trainstack/prehab-env/server";
import { logger } from "../lib/logger";

let workerUtils: WorkerUtils | null = null;

export async function initEvents(): Promise<void> {
  workerUtils = await makeWorkerUtils({
    connectionString: env.DATABASE_URL,
  });
  logger.info("Event system initialized (graphile_worker schema ready)");
}

export async function shutdownEvents(): Promise<void> {
  if (workerUtils) {
    await workerUtils.release();
    workerUtils = null;
  }
}
