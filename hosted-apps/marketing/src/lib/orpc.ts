import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { AppContractClient } from "@trainstack/hosted-contract";

import { ENV } from "../env.public";

export const link = new RPCLink({
  url: `${ENV.PUBLIC_SERVER_URL.replace(/\/$/, "")}/rpc`,
  fetch(url, options) {
    return fetch(url, {
      ...options,
      credentials: "include",
    });
  },
});

export const orpc: AppContractClient = createORPCClient(link);
