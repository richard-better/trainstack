import * as Alchemy from "alchemy";
import * as Axiom from "alchemy/Axiom";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

export interface ObservabilityEnv {
  AXIOM_API_KEY: Redacted.Redacted<string>;
  AXIOM_DATASET: string;
  AXIOM_EDGE_URL: string;
}

export class Observability extends Alchemy.Stack<Observability, ObservabilityEnv>()(
  "trainstack-observability",
) {}

export default Observability.make(
  {
    providers: Axiom.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
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
        [datasetName]: { ingest: ["create"] },
      },
    });

    return {
      AXIOM_API_KEY: ingest.token,
      AXIOM_DATASET: dataset.name,
      AXIOM_EDGE_URL: dataset.edgeDeploymentUrl,
    };
  }),
);
