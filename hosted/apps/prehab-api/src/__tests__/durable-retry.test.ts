import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry } from "@earendil-works/pi-durable";
import { context, withHarness } from "../services/durable/runtime";
import { submitRecoverably } from "../services/durable/submit";

it("allows retry after a terminal provider failure, then deduplicates the recovered answer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "prehab-retry-"));
  const faux = fauxProvider();
  faux.setResponses([
    fauxAssistantMessage([], { stopReason: "error", errorMessage: "Unavailable" }),
    fauxAssistantMessage("Recovered"),
  ]);
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
        return (await submitRecoverably(harness, root, "message", "Hello")).wait(context);
      },
      { directory, models },
    );
  try {
    expect((await invoke()).status).toBe("unanswered");
    const recovered = await invoke();
    expect(recovered.status).toBe("done");
    expect((await invoke()).id).toBe(recovered.id);
    expect(faux.state.callCount).toBe(2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
