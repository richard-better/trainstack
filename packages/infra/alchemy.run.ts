import * as Alchemy from "alchemy";
import * as Axiom from "alchemy/Axiom";
import * as Cloudflare from "alchemy/Cloudflare";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import "varlock/auto-load";

const production = Alchemy.Stack.pipe(Effect.map(({ stage }) => stage === "production"));
const webDomain = "trainstackhq.com";
const serverDomain = `api.${webDomain}`;
const compatibility = { date: "2026-07-30", flags: ["nodejs_compat"] };

export const db = Cloudflare.D1.Database("database", {
  migrations: "../../packages/db/src/migrations",
}).pipe(RemovalPolicy.retain(production));

export const observability = Effect.gen(function* () {
  const { stage } = yield* Alchemy.Stack;
  const datasetName = `trainstack-${stage}-logs`;

  const dataset = yield* Axiom.Dataset("logs", {
    name: datasetName,
    kind: "axiom:events:v1",
    description: "trainstack application logs",
  });
  const ingest = yield* Axiom.ApiToken("logs-ingest", {
    name: `trainstack-${stage}-logs-ingest`,
    datasetCapabilities: {
      [datasetName]: {
        ingest: ["create"],
      },
    },
  });

  return {
    dataset,
    runtimeEnv: {
      AXIOM_API_KEY: ingest.token,
      AXIOM_DATASET: dataset.name,
      AXIOM_EDGE_URL: dataset.edgeDeploymentUrl,
    },
  };
});

export const observabilityEnv = observability.pipe(Effect.map(({ runtimeEnv }) => runtimeEnv));

export const observabilityBindings = {
  AXIOM_API_KEY: observabilityEnv.pipe(Effect.map(({ AXIOM_API_KEY }) => AXIOM_API_KEY)),
  AXIOM_DATASET: observabilityEnv.pipe(Effect.map(({ AXIOM_DATASET }) => AXIOM_DATASET)),
  AXIOM_EDGE_URL: observabilityEnv.pipe(Effect.map(({ AXIOM_EDGE_URL }) => AXIOM_EDGE_URL)),
};

export const server = Cloudflare.Worker("server", {
  main: "../../apps/server/src/index.ts",
  compatibility,
  domain: production.pipe(Effect.map((prod) => (prod ? serverDomain : undefined))),
  workersDev: production.pipe(Effect.map((prod) => !prod)),
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
    providers: Layer.mergeAll(Cloudflare.providers(), Axiom.providers()),
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
      axiomDataset: observabilityResources.dataset.name,
    };
  }),
);
