import type { ShowcaseWorld } from "./entries.ts";

export interface RecordedExchange {
  readonly method: string;
  readonly path: string;
  readonly bodyHash: string;
  readonly status: number;
  readonly contentType: string | null;
  readonly response: { readonly text: string } | { readonly base64: string };
}

export interface RecordedEntry {
  readonly path: string;
  readonly exchanges: readonly RecordedExchange[];
}

export interface Recording {
  readonly world: ShowcaseWorld;
  readonly at: string;
  readonly entries: Readonly<Record<string, RecordedEntry>>;
}

export const RECORDINGS_PATH = "/__dev/showcase/recordings";

export const recordingUrl = (world: ShowcaseWorld) => `${RECORDINGS_PATH}/${world}.json`;

const encoder = new TextEncoder();

function withoutBoundary(body: Uint8Array, contentType: string | null): Uint8Array {
  const boundary = /boundary=("?)([^";]+)\1/.exec(contentType ?? "")?.[2];
  if (!boundary) return body;
  const marker = encoder.encode(boundary);
  const kept: Uint8Array[] = [];
  let from = 0;
  for (let index = 0; index <= body.length - marker.length; index++) {
    if (marker.every((byte, offset) => body[index + offset] === byte)) {
      kept.push(body.subarray(from, index));
      index += marker.length - 1;
      from = index + 1;
    }
  }
  kept.push(body.subarray(from));
  const joined = new Uint8Array(kept.reduce((length, part) => length + part.length, 0));
  kept.reduce((offset, part) => {
    joined.set(part, offset);
    return offset + part.length;
  }, 0);
  return joined;
}

export async function bodyHash(body: Uint8Array, contentType: string | null): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(withoutBoundary(body, contentType)),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const exchangeKey = (method: string, path: string, hash: string) =>
  `${method} ${path} ${hash}`;
