import { QueryClient } from "@tanstack/react-query";

import { createApiClient } from "./lib/client";

export const api = createApiClient(import.meta.env.VITE_SERVER_URL);

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});
