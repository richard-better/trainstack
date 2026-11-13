import { QueryClient } from "@tanstack/react-query";
import { MAX_ACTIVITY_FILE_BYTES } from "@trainstack/contract";

import { createApiClient } from "./lib/client";
import { placeActivity, sendWithProgress } from "./lib/upload";
import { createUploads } from "./lib/uploads";

const serverUrl = import.meta.env.VITE_SERVER_URL;

export const api = createApiClient(serverUrl);

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});

export const activitiesQueryKey = ["activities"] as const;

export const activityKey = (id: string) => ["activity", id] as const;

export const uploads = createUploads({
  api,
  maxBytes: MAX_ACTIVITY_FILE_BYTES,
  uploadClient: (onProgress) => createApiClient(serverUrl, sendWithProgress(onProgress)),
  onActivity: (activity) => placeActivity(queryClient, activitiesQueryKey, activity),
});
