import { type ShowcaseEntry, SHOWCASE_PARAMETER, showcaseEntry } from "./entries.ts";
import {
  type RecordedExchange,
  type Recording,
  bodyHash,
  exchangeKey,
  recordingUrl,
} from "./recording.ts";

export interface ShowcaseFrame {
  readonly entry: ShowcaseEntry;
  readonly send: (request: Request) => Promise<Response>;
  readonly fetch: typeof fetch;
}

const SESSION_PATH = "/api/auth/get-session";

export async function frameOfThisPage(): Promise<ShowcaseFrame | null> {
  if (typeof window === "undefined") return null;
  const id = new URLSearchParams(window.location.search).get(SHOWCASE_PARAMETER);
  if (id === null) return null;
  const entry = showcaseEntry(id);
  if (!entry) throw new Error(`No showcase entry called ${id}`);
  const response = await fetch(recordingUrl(entry.world));
  if (!response.ok) {
    throw new Error(`No recording of the ${entry.world} world. Run bun run showcase to record it`);
  }
  const recording: Recording = await response.json();
  holdTheClockAt(Date.parse(recording.at));
  const send = replay(recording, entry);
  return {
    entry,
    send,
    fetch: (input, init) => send(new Request(input, init)),
  };
}

function holdTheClockAt(moment: number) {
  const RunningDate = Date;
  class HeldDate extends RunningDate {
    constructor(...parts: unknown[]) {
      if (parts.length === 0) super(moment);
      else super(...(parts as ConstructorParameters<DateConstructor>));
    }

    static override now() {
      return moment;
    }
  }
  globalThis.Date = HeldDate as DateConstructor;
}

function replay(recording: Recording, entry: ShowcaseEntry) {
  const own = recording.entries[entry.id]?.exchanges ?? [];
  const world = Object.values(recording.entries).flatMap(({ exchanges }) => exchanges);
  const byKey = (exchanges: readonly RecordedExchange[], key: string) =>
    exchanges.findLast(
      (exchange) => exchangeKey(exchange.method, exchange.path, exchange.bodyHash) === key,
    );
  const byPath = (exchanges: readonly RecordedExchange[], method: string, path: string) =>
    exchanges.findLast((exchange) => exchange.method === method && exchange.path === path);

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const path = `${url.pathname}${url.search}`;
    const isSession = url.pathname === SESSION_PATH;
    if (!isSession && entry.network === "waits") return new Promise<Response>(() => {});
    if (!isSession && entry.network === "fails") throw new TypeError("Failed to fetch");
    const body = new Uint8Array(await request.arrayBuffer());
    const key = exchangeKey(
      request.method,
      path,
      await bodyHash(body, request.headers.get("content-type")),
    );
    const found =
      byKey(own, key) ??
      byKey(world, key) ??
      byPath(own, request.method, path) ??
      byPath(world, request.method, path);
    if (!found) {
      console.error(`The showcase recorded no answer to ${request.method} ${path}`);
      return Response.json(
        { json: { defined: false, code: "NOT_RECORDED", status: 501, message: "Not recorded" } },
        { status: 501 },
      );
    }
    return answer(found);
  };
}

function answer(exchange: RecordedExchange): Response {
  const headers = exchange.contentType ? { "content-type": exchange.contentType } : undefined;
  const body =
    "text" in exchange.response
      ? exchange.response.text
      : Uint8Array.from(atob(exchange.response.base64), (character) => character.charCodeAt(0));
  return new Response(exchange.status === 204 ? null : body, { status: exchange.status, headers });
}
