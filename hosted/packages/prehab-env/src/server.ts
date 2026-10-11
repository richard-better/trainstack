import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    CORS_ORIGIN: z.url(),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().default(3000),
    GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    // Comma-separated allowlist of staff emails granted access to the internal
    // admin surface + LLM playground (PRE-129/PRE-130). Empty/unset = nobody is
    // an admin (the gate fails closed). Matched case-insensitively.
    ADMIN_EMAILS: z.string().optional(),
    POSTHOG_API_KEY: z.string().min(1).optional(),
    POSTHOG_HOST: z.string().url().optional(),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
    APPLE_CLIENT_ID: z.string().min(1).optional(),
    APPLE_CLIENT_SECRET: z.string().min(1).optional(),
    APPLE_APP_BUNDLE_IDENTIFIER: z.string().min(1).optional(),
    APP_MODE: z.enum(["api", "worker"]).default("api"),
    WORKER_CONCURRENCY: z.coerce.number().default(5),
    WORKER_POLL_INTERVAL: z.coerce.number().default(1000),
    WORKER_HEALTH_PORT: z.coerce.number().default(5103),
    MEDIA_DIRECTORY: z.string().optional(),
    S3_ENDPOINT: z.string().url().default("http://localhost:9012"),
    S3_REGION: z.string().default("auto"),
    S3_ACCESS_KEY: z.string().default("minio_root_user"),
    S3_SECRET_KEY: z.string().default("minio_root_password"),
    S3_MEDIA_BUCKET: z.string().default("prehab-media"),
    S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
    S3_MEDIA_PUBLIC_URL: z.string().url().default("http://localhost:9012/prehab-media"),
    RESEND_API_KEY: z.string().min(1).optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
