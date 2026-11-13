import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { AppContractClient } from "@trainstack/contract";

export type ApiClient = AppContractClient;

export function createApiClient(
  serverUrl: string,
  send: (request: Request) => Promise<Response> = (request) => fetch(request),
): ApiClient {
  return createORPCClient(
    new RPCLink({
      url: `${serverUrl}/rpc`,
      fetch: (request, init) => send(new Request(request, { ...init, credentials: "include" })),
    }),
  );
}

export const ACTIVITIES_PER_PAGE = 30;
