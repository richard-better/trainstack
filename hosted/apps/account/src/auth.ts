import { createAuthClient } from "better-auth/react";

import { showcaseFrame } from "./dev-showcase";

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_SERVER_URL,
  fetchOptions: showcaseFrame ? { customFetchImpl: showcaseFrame.fetch } : undefined,
});
