import { createAuthClient } from "better-auth/client";

import { ENV } from "../env.public";

export const authClient = createAuthClient({
  baseURL: ENV.PUBLIC_SERVER_URL,
});
