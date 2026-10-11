import { submitRecoverably } from "../durable/submit";
import { Type } from "@earendil-works/pi-ai";
import { createRegistry, defineExtension, defineTool } from "@earendil-works/pi-durable";
import { context, google, withHarness } from "../durable/runtime";
import { GEMINI_MODEL } from "../llm/models";
import { buildCoachContextSystem, COACH_INSTRUCTIONS, RED_FLAG_SAFETY_MESSAGE } from "./agent";

export const endSessionTool = defineTool({
  name: "endSession",
  description: "Finish intake when sufficient context has been gathered.",
  parameters: Type.Object({}),
  replay: "safe",
  execute: async () => ({
    content: [{ type: "text", text: "Intake complete." }],
    control: { terminate: true },
  }),
});
export const flagRedFlagTool = defineTool({
  name: "flagRedFlag",
  description: "Flag symptoms warranting a professional assessment, while continuing intake.",
  parameters: Type.Object({ reason: Type.String({ minLength: 1 }) }),
  replay: "safe",
  execute: async () => ({ content: [{ type: "text", text: RED_FLAG_SAFETY_MESSAGE }] }),
});

export interface CoachPart {
  type: string;
  text?: string;
  input?: unknown;
  output?: unknown;
  toolCallId?: string;
  state?: string;
}
export async function runCoachTurn(input: {
  userId: string;
  threadId: string;
  requestId: string;
  text: string;
  intakeProse: string;
}) {
  const registry = createRegistry();
  registry.install(
    defineExtension({ name: "prehab-coach", tools: [endSessionTool, flagRedFlagTool] }),
  );
  return withHarness(`coach:${input.userId}:${input.threadId}`, registry, async (harness) => {
    const root = await harness.root(context, {
      agent: {
        model: google(GEMINI_MODEL),
        instructions: `${COACH_INSTRUCTIONS}\n${buildCoachContextSystem(input.intakeProse)}`,
      },
    });
    const submission = await submitRecoverably(harness, root, input.requestId, input.text);
    const settled = await submission.wait(context);
    if (settled.status !== "done" || settled.type !== "input")
      throw new Error("Coach could not finish this response. Please retry.");
    const history = await root.entries(
      { minEntryId: settled.entry, maxEntryId: settled.answer, order: "ascending" },
      500,
      undefined,
      context,
    );
    const parts: CoachPart[] = [];
    for (const entry of history.items) {
      for (const message of entry.model ?? []) {
        if (message.role !== "assistant") continue;
        for (const part of message.content) {
          if (part.type === "text") parts.push({ type: "text", text: part.text });
          if (part.type === "toolCall")
            parts.push({
              type: `tool-${part.name}`,
              input: part.arguments,
              toolCallId: part.id,
              state: "output-available",
              output: { ok: true },
            });
        }
      }
    }
    return { id: `${input.requestId}-assistant`, parts };
  });
}
