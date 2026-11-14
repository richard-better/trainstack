import * as Astro from "@alchemy.run/frontend-frameworks/astro";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { port: { type: "string", default: "4321" } } });

const site = Effect.gen(function* () {
  const framework = yield* Astro.make({
    targetConfig: {
      worker: {
        config: { compatibility_date: "2026-07-30", compatibility_flags: ["nodejs_compat"] },
      },
    },
  });
  const server = yield* framework.dev({ root: import.meta.dirname, port: Number(values.port) });
  console.log(`The website runs in workerd on ${server.url}`);
  return yield* Effect.never;
});

await Effect.runPromise(site.pipe(Effect.scoped, Effect.provide(NodeServices.layer)));
