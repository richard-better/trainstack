import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import type { contract } from "@trainstack/prehab-contract";
import { PUBLIC_SERVER_URL } from "astro:env/client";

export const link = new RPCLink({
  url: `${PUBLIC_SERVER_URL}/rpc`,
  fetch(url, options) {
    return fetch(url, {
      ...options,
      credentials: "include",
    });
  },
});

export const orpc: ContractRouterClient<typeof contract> = createORPCClient(link);
