import type { PublicCoercedEnvSchema } from "./env";

export const ENV = {
  PUBLIC_SERVER_URL: import.meta.env.PUBLIC_SERVER_URL!,
} satisfies Pick<PublicCoercedEnvSchema, "PUBLIC_SERVER_URL">;
