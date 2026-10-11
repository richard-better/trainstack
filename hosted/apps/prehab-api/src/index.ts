import "./instrumentation";
import { env } from "@trainstack/prehab-env/server";

async function main() {
  if (env.APP_MODE === "worker") {
    const { startWorker } = await import("./worker");
    await startWorker();
  } else {
    const { startApi } = await import("./api");
    await startApi();
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
