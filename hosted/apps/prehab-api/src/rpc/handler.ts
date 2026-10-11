import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fastify";
import { router } from "./router";

export const rpcHandler = new RPCHandler(router, {
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});
