import { env } from "@trainstack/prehab-env/server";
import { buildApp } from "./app";
import { initEvents, shutdownEvents } from "./events/init";

export async function startApi(): Promise<void> {
  // Ensure graphile_worker schema exists so emitEvent() works
  await initEvents();

  const app = await buildApp();

  await app.listen({ port: env.PORT, host: "0.0.0.0" });

  app.log.info(`Server listening on http://localhost:${env.PORT}`);
  app.log.info(`Health check: http://localhost:${env.PORT}/api/health`);

  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  for (const signal of signals) {
    process.on(signal, async () => {
      app.log.info(`Received ${signal}, shutting down gracefully...`);
      await app.close();
      await shutdownEvents();
      process.exit(0);
    });
  }
}
