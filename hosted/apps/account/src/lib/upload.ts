import { isDefinedError, safe } from "@orpc/client";
import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type { Activity } from "@trainstack/contract";
import {
  type ActivityFileFormat,
  type DecodedActivity,
  ActivityFileError,
  decodeActivityFile,
} from "@trainstack/activity-file";

import type { ApiClient } from "./client.ts";
import { sportFromFit } from "./sports.ts";

export interface CheckedFile {
  readonly id: string;
  readonly name: string;
  readonly format: ActivityFileFormat;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly sport: string | null;
  readonly startedAt: Date | undefined;
}

export type Refusal =
  | { readonly kind: "tooLarge" }
  | { readonly kind: "notActivityFile" }
  | { readonly kind: "noActivity"; readonly format: ActivityFileFormat }
  | { readonly kind: "damaged"; readonly format: ActivityFileFormat };

export type Check = { readonly kind: "ready"; readonly file: CheckedFile } | Refusal;

export type Outcome =
  | { readonly kind: "uploaded"; readonly activity: Activity }
  | { readonly kind: "alreadyThere"; readonly activity: Activity }
  | { readonly kind: "deletedBefore"; readonly deletedAt: Date }
  | { readonly kind: "refused"; readonly refusal: Refusal };

export const UPLOAD_SOURCE = "upload";

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function checkActivityFile(file: File, maxBytes: number): Promise<Check> {
  if (file.size > maxBytes) return { kind: "tooLarge" };
  if (file.size === 0) return { kind: "notActivityFile" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  let decoded: DecodedActivity;
  try {
    decoded = decodeActivityFile(bytes);
  } catch (error) {
    if (!(error instanceof ActivityFileError)) throw error;
    if (error.format === undefined) return { kind: "notActivityFile" };
    if (error.code === "noActivity") return { kind: "noActivity", format: error.format };
    return { kind: "damaged", format: error.format };
  }
  return {
    kind: "ready",
    file: {
      id: await sha256Hex(bytes),
      name: file.name,
      format: decoded.format,
      bytes,
      sport: sportFromFit(decoded.summary.sport, decoded.summary.subSport),
      startedAt: decoded.summary.startTime,
    },
  };
}

export async function sendActivityFile(
  api: ApiClient,
  file: CheckedFile,
  upload: ApiClient = api,
): Promise<Outcome> {
  const found = await safe(api.activities.get({ id: file.id }));
  if (!found.error) return { kind: "alreadyThere", activity: found.data };
  if (!(isDefinedError(found.error) && found.error.code === "NOT_FOUND")) throw found.error;

  const sent = await safe(
    upload.activities.upload({
      file: new File([file.bytes], file.name),
      source: UPLOAD_SOURCE,
      ...(file.startedAt ? { startedAt: file.startedAt } : {}),
    }),
  );
  if (!sent.error) return { kind: "uploaded", activity: sent.data };
  if (isDefinedError(sent.error) && sent.error.code === "ACTIVITY_DELETED") {
    return { kind: "deletedBefore", deletedAt: sent.error.data.deletedAt };
  }
  if (isDefinedError(sent.error) && sent.error.code === "UNSUPPORTED_FILE") {
    return { kind: "refused", refusal: { kind: "notActivityFile" } };
  }
  throw sent.error;
}

export interface ActivityPage {
  readonly activities: readonly Activity[];
  readonly nextCursor: string | null;
}

const occurredAt = (activity: Activity) => (activity.startedAt ?? activity.createdAt).getTime();

const comesBefore = (a: Activity, b: Activity) =>
  occurredAt(a) > occurredAt(b) || (occurredAt(a) === occurredAt(b) && a.id > b.id);

export function withActivity<Page extends ActivityPage>(
  pages: readonly Page[],
  activity: Activity,
): Page[] {
  const without = pages.map((page) => ({
    ...page,
    activities: page.activities.filter((other) => other.id !== activity.id),
  }));
  for (const [index, page] of without.entries()) {
    const at = page.activities.findIndex((other) => comesBefore(activity, other));
    const last = index === without.length - 1;
    if (at === -1 && !(last && page.nextCursor === null)) continue;
    const position = at === -1 ? page.activities.length : at;
    without[index] = {
      ...page,
      activities: page.activities.toSpliced(position, 0, activity),
    };
    return without;
  }
  return [...pages];
}

type ActivityPages = InfiniteData<ActivityPage, string | undefined>;

export function placeActivity(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  activity: Activity,
) {
  const place = () =>
    queryClient.setQueryData<ActivityPages>(
      queryKey,
      (data) => data && { ...data, pages: withActivity(data.pages, activity) },
    );
  place();
  const cache = queryClient.getQueryCache();
  const query = cache.find({ queryKey, exact: true });
  if (query?.state.fetchStatus !== "fetching") return;
  const unsubscribe = cache.subscribe((event) => {
    if (event.query !== query || query.state.fetchStatus === "fetching") return;
    unsubscribe();
    place();
  });
}

const emptyBodyStatuses = new Set([101, 204, 205, 304]);

function headersOf(raw: string) {
  const headers = new Headers();
  for (const line of raw.trim().split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon > 0) headers.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  return headers;
}

export function sendWithProgress(onProgress: (fraction: number) => void) {
  return async (request: Request): Promise<Response> => {
    const body = await request.arrayBuffer();
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(request.method, request.url);
      xhr.withCredentials = request.credentials === "include";
      xhr.responseType = "arraybuffer";
      request.headers.forEach((value, name) => xhr.setRequestHeader(name, value));
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) onProgress(event.loaded / event.total);
      });
      xhr.addEventListener("load", () =>
        resolve(
          new Response(emptyBodyStatuses.has(xhr.status) ? null : xhr.response, {
            status: xhr.status,
            statusText: xhr.statusText,
            headers: headersOf(xhr.getAllResponseHeaders()),
          }),
        ),
      );
      xhr.addEventListener("error", () =>
        reject(new TypeError("The upload did not reach the server")),
      );
      xhr.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      xhr.send(body);
    });
  };
}
