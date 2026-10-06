import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import type * as Redacted from "effect/Redacted";
import "varlock/auto-load";

import { Observability } from "./observability";

const production = Alchemy.Stack.pipe(Effect.map(({ stage }) => stage === "production"));
const webDomain = "trainstackhq.com";
const serverDomain = `api.${webDomain}`;
const serverDomainForStage = Output.fromEffect(
  production.pipe(Effect.map((prod) => (prod ? serverDomain : undefined))),
);
const serverWorkersDevForStage = Output.fromEffect(production.pipe(Effect.map((prod) => !prod)));
const compatibility = { date: "2026-07-30", flags: ["nodejs_compat"] };

export const db = Cloudflare.D1.Database("database", {
  migrations: "../../packages/db/src/migrations",
}).pipe(RemovalPolicy.retain(production));

export const observability = Effect.gen(function* () {
  const enabled = yield* Config.Boolean("AXIOM_ENABLED").pipe(Config.withDefault(false));
  if (!enabled) {
    return { AXIOM_API_KEY: "", AXIOM_DATASET: "", AXIOM_EDGE_URL: "" };
  }
  const logging = yield* Observability;
  return {
    AXIOM_API_KEY: logging.AXIOM_API_KEY.as<Redacted.Redacted<string>>(),
    AXIOM_DATASET: logging.AXIOM_DATASET,
    AXIOM_EDGE_URL: logging.AXIOM_EDGE_URL,
  };
});

export const observabilityBindings = {
  AXIOM_API_KEY: observability.pipe(Effect.map(({ AXIOM_API_KEY }) => AXIOM_API_KEY)),
  AXIOM_DATASET: observability.pipe(Effect.map(({ AXIOM_DATASET }) => AXIOM_DATASET)),
  AXIOM_EDGE_URL: observability.pipe(Effect.map(({ AXIOM_EDGE_URL }) => AXIOM_EDGE_URL)),
};

export const server = Cloudflare.Worker("server", {
  main: "../../apps/server/src/index.ts",
  compatibility,
  domain: serverDomainForStage,
  workersDev: serverWorkersDevForStage,
  env: {
    DB: db,
    NODE_ENV: production.pipe(Effect.map((prod) => (prod ? "production" : "development"))),
    CORS_ORIGIN: production.pipe(
      Effect.flatMap((prod) =>
        prod ? Effect.succeed(`https://${webDomain}`) : Config.String("CORS_ORIGIN"),
      ),
    ),
    BETTER_AUTH_SECRET: Config.Redacted("BETTER_AUTH_SECRET"),
    BETTER_AUTH_URL: Cloudflare.Worker.URL,
    ...observabilityBindings,
  },
  dev: {
    port: 3000,
  },
});

export type ServerEnv = Cloudflare.InferEnv<typeof server>;

export default Alchemy.Stack(
  "trainstack",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const prod = yield* production;
    const observabilityResources = yield* observability;
    const serverWorker = yield* server;
    const webWorker = yield* Cloudflare.Website.Astro("web", {
      rootDir: "../../apps/web",
      compatibility,
      domain: prod ? webDomain : undefined,
      workersDev: !prod,
      env: {
        NODE_ENV: prod ? "production" : "development",
        ...observabilityBindings,
        SESSION: Cloudflare.KV.Namespace("session"),
        IMAGES: Cloudflare.Images.Images(),
        PUBLIC_SERVER_URL: serverWorker.url.as<string>(),
      },
      dev: {
        port: 4321,
      },
    });

    return {
      web: webWorker.url,
      server: serverWorker.url,
      database: (yield* db).databaseId,
      axiomDataset: observabilityResources.AXIOM_DATASET,
    };
  }),
);
