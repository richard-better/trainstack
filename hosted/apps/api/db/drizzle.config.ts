import { defineConfig } from "drizzle-kit";
import "varlock/auto-load";

export default defineConfig({
  schema: "../src/db/schema/index.ts",
  out: "../src/db/migrations",
  dialect: "sqlite",
  driver: "d1-http",
});
