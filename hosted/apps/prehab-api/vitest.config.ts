import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    env: {
      DATABASE_URL: "postgres://postgres:localtestdatabase@localhost:25432/prehab-app",
      BETTER_AUTH_SECRET: "test-only-secret-at-least-32-characters",
      BETTER_AUTH_URL: "http://localhost:3002",
      CORS_ORIGIN: "http://localhost:4322",
      GOOGLE_GENERATIVE_AI_API_KEY: "test-not-a-key",
    },
  },
});
