import { submitRecoverably } from "./submit";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { createModels, type Models } from "@earendil-works/pi-ai/models";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { Harness, createRegistry, type Registry, type ModelRef } from "@earendil-works/pi-durable";
import { openNodeJsonlStorage } from "@earendil-works/pi-durable/storage/jsonl/node";
import { z } from "zod";

export const context = BACKGROUND_CONTEXT;
export const google = (modelId: string): ModelRef => ({ provider: "google", modelId });
export const anthropic = (modelId: string): ModelRef => ({ provider: "anthropic", modelId });

export function createPrehabModels() {
  const models = createModels({
    authContext: {
      env: async (name) =>
        process.env[name] ??
        (name === "GEMINI_API_KEY" ? process.env.GOOGLE_GENERATIVE_AI_API_KEY : undefined),
      fileExists: async () => false,
    },
  });
  models.setProvider(googleProvider());
  models.setProvider(anthropicProvider());
  return models;
}

export function durablePath(key: string) {
  const hash = createHash("sha256").update(key).digest("hex");
  return join(resolve(process.env.PI_DURABLE_DIRECTORY ?? ".prehab-agents"), hash);
}

// Serialize opens within this process; JSONL's filesystem lock also fences other processes.
const pending = new Map<string, Promise<unknown>>();
export async function withHarness<T>(
  key: string,
  registry: Registry,
  run: (harness: Harness) => Promise<T>,
  options: { models?: Models; directory?: string } = {},
): Promise<T> {
  const previous = pending.get(key) ?? Promise.resolve();
  const operation = previous
    .catch(() => {})
    .then(async () => {
      const directory = options.directory ?? durablePath(key);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const storage = await openNodeJsonlStorage(directory, context);
      const harness = await Harness.open(
        storage,
        { models: options.models ?? createPrehabModels(), registry },
        context,
      );
      try {
        return await run(harness);
      } finally {
        await harness.close(context);
      }
    });
  pending.set(key, operation);
  try {
    return await operation;
  } finally {
    if (pending.get(key) === operation) pending.delete(key);
  }
}

export interface GenerateParameters {
  model: ModelRef;
  schema: z.ZodType;
  system?: string;
  prompt: string;
  abortSignal?: AbortSignal;
  temperature?: number;
}

export async function generateObject(
  params: GenerateParameters,
  options: { models?: Models; directory?: string } = {},
) {
  const schema = z.toJSONSchema(params.schema);
  const key = JSON.stringify({
    model: params.model,
    system: params.system,
    prompt: params.prompt,
    schema,
    temperature: params.temperature,
  });
  return withHarness(
    `generation:${key}`,
    createRegistry(),
    async (harness) => {
      const root = await harness.root(context, {
        agent: {
          model: params.model,
          instructions: `${params.system ?? ""}\nReturn only JSON matching this schema, without Markdown fences:\n${JSON.stringify(schema)}`,
        },
      });
      let validationError: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        const prompt =
          attempt === 0
            ? params.prompt
            : `The previous answer did not match the required JSON schema. Return a corrected JSON object. Validation: ${String(validationError)}`;
        const submission = await submitRecoverably(harness, root, `generate:${attempt}`, prompt);
        const waitContext = params.abortSignal
          ? withAbortSignal(params.abortSignal, context)
          : context;
        const settled = await submission.wait(waitContext);
        if (settled.status !== "done" || settled.type !== "input")
          throw new Error("Durable generation did not produce an answer");
        const entry = await root.commit((tx) => tx.entry(settled.answer), context);
        const message = entry?.model?.find((item) => item.role === "assistant");
        if (!message || message.role !== "assistant")
          throw new Error("Durable generation returned no assistant message");
        const text = message.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("");
        try {
          const object = params.schema.parse(
            JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")),
          );
          return {
            object,
            usage: {
              inputTokens: message.usage.input,
              outputTokens: message.usage.output,
              totalTokens: message.usage.totalTokens,
            },
          };
        } catch (error) {
          validationError = error;
        }
      }
      throw validationError;
    },
    options,
  );
}
