// Alchemy validates deployment inputs with Varlock; Workers use native env bindings.
import type { PublicCoercedEnvSchema } from "./env";

export const ENV = {
  PUBLIC_SERVER_URL: import.meta.env.PUBLIC_SERVER_URL!,
} satisfies Pick<PublicCoercedEnvSchema, "PUBLIC_SERVER_URL">;
