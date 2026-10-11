import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry } from "@earendil-works/pi-durable";
import { z } from "zod";
import { context, generateObject, withHarness } from "../services/durable/runtime";

describe("durable model conversations", () => {
  it("reopens persisted answers and deduplicates a retried submission without calling the model again", async () => {
    const directory = await mkdtemp(join(tmpdir(), "prehab-durable-"));
    const faux = fauxProvider();
    faux.setResponses([fauxAssistantMessage("Your saved answer")]);
    const models = createModels();
    models.setProvider(faux.provider);
    const invoke = () =>
      withHarness(
        directory,
        createRegistry(),
        async (harness) => {
          const model = faux.getModel();
          const root = await harness.root(context, {
            agent: { model: { provider: model.provider, modelId: model.id } },
          });
          const submission = await root.submit(
            { type: "input", content: "Hello", requestId: "stable-message" },
            context,
          );
          const settled = await submission.wait(context);
          expect(settled.status).toBe("done");
          return { id: submission.id, entries: (await root.context(context)).entries };
        },
        { directory, models },
      );
    try {
      const first = await invoke();
      const retry = await invoke();
      expect(retry.id).toBe(first.id);
      expect(retry.entries).toEqual(first.entries);
      expect(faux.state.callCount).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

it("repairs malformed structured output and reuses the validated result after reopening", async () => {
  const directory = await mkdtemp(join(tmpdir(), "prehab-structured-"));
  const faux = fauxProvider();
  faux.setResponses([
    fauxAssistantMessage("not JSON"),
    fauxAssistantMessage('{"title":"Recovered"}'),
  ]);
  const models = createModels();
  models.setProvider(faux.provider);
  const model = faux.getModel();
  const invoke = () =>
    generateObject(
      {
        model: { provider: model.provider, modelId: model.id },
        schema: z.object({ title: z.string() }),
        prompt: "Create a title",
      },
      { models, directory },
    );
  try {
    expect((await invoke()).object).toEqual({ title: "Recovered" });
    expect((await invoke()).object).toEqual({ title: "Recovered" });
    expect(faux.state.callCount).toBe(2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
