import { execFileSync } from "node:child_process";
import "varlock/auto-load";

if (
  process.env.AXIOM_ENABLED !== undefined &&
  !["true", "false"].includes(process.env.AXIOM_ENABLED)
) {
  throw new Error("AXIOM_ENABLED must be true or false.");
}

const enabled =
  process.env.AXIOM_ENABLED === "true" ||
  (process.env.AXIOM_ENABLED === undefined && Boolean(process.env.AXIOM_TOKEN?.trim()));
process.env.AXIOM_ENABLED = String(enabled);

const args = process.argv.slice(2);
if (enabled) {
  execFileSync("bunx", ["alchemy", "deploy", "--config", "axiom.run.ts", ...args], {
    stdio: "inherit",
  });
} else {
  console.log("Axiom is disabled; deploying with Cloudflare Workers logging.");
}

execFileSync("bunx", ["alchemy", "deploy", ...args], { stdio: "inherit" });
