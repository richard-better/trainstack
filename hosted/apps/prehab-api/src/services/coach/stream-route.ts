import { Readable } from "node:stream";

import { runCoachTurn } from "./durable";
import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from "ai";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { z } from "zod";

import { auth } from "../../auth";
import { buildStructuredIntakeProse, loadProfileAnswers } from "../profile-projection";

import { RED_FLAG_SAFETY_MESSAGE } from "./agent";
import { extractIntakeSummary } from "./extraction";
import { GEMINI_MODEL } from "../llm/models";
import { instrumentGenerateObject, recordCoachStreamCall } from "../llm/observability";
import {
  flagThreadForReview,
  getThreadForUser,
  persistMessage,
  transitionThreadCompleted,
  upsertIntakeSummary,
} from "./persistence";

// AI SDK v6 useChat sends `{ id, messages, trigger }` plus any extra
// `body` fields configured client-side. We require `threadId` in the body.
const RequestBodySchema = z.object({
  threadId: z.string().min(1),
  messages: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        role: z.enum(["user", "assistant"]),
        parts: z
          .array(z.object({ type: z.literal("text"), text: z.string().min(1).max(10000) }))
          .min(1),
      }),
    )
    .min(1)
    .max(100),
  trigger: z.enum(["submit-message", "regenerate-message"]).optional(),
  id: z.string().optional(),
});

type CoachUIMessage = UIMessage;

interface ToolPartLike {
  type: string;
  input?: unknown;
}

function findToolCall(parts: unknown[], toolName: string): { input: unknown } | null {
  for (const p of parts) {
    if (!p || typeof p !== "object") continue;
    const part = p as ToolPartLike;
    if (part.type === `tool-${toolName}`) return { input: part.input };
  }
  return null;
}

function lastUserMessage(messages: CoachUIMessage[]): CoachUIMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") return messages[i]!;
  }
  return null;
}

export const COACH_STREAM_PATH = "/api/coach/stream";

export function registerCoachStreamRoute(app: FastifyInstance): void {
  app.post(COACH_STREAM_PATH, async (request: FastifyRequest, reply: FastifyReply) => {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });
    if (!session?.user) {
      reply.status(401).send({ error: "Unauthorized" });
      return;
    }
    const userId = session.user.id;

    const parsedBody = RequestBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      reply.status(400).send({ error: "Invalid request body", details: parsedBody.error.format() });
      return;
    }
    const { threadId, messages: clientMessages } = parsedBody.data;

    const threadRecord = await getThreadForUser(userId, threadId);
    if (!threadRecord) {
      reply.status(404).send({ error: "Thread not found" });
      return;
    }
    if (threadRecord.thread.status !== "pending") {
      reply
        .status(409)
        .send({ error: `Thread is ${threadRecord.thread.status}, cannot send messages` });
      return;
    }

    const answers = await loadProfileAnswers(userId);
    const intakeProse = buildStructuredIntakeProse(answers);
    if (!intakeProse) {
      reply
        .status(412)
        .send({ error: "Sport profile not found. Complete structured intake first." });
      return;
    }

    // Persist the new user message before kicking off the stream so a client
    // disconnect mid-stream still leaves a recoverable record.
    const incoming = lastUserMessage(clientMessages as CoachUIMessage[]);
    if (incoming) {
      await persistMessage(
        threadId,
        "user",
        incoming.parts as unknown[],
        `${threadId}:${incoming.id}`,
      );
    }

    // Reload prior messages from DB (now includes the just-persisted user
    // turn). This is the source of truth — clients can drop messages.
    const refreshed = await getThreadForUser(userId, threadId);
    const fullHistory: CoachUIMessage[] = (refreshed?.messages ?? []).map((m) => ({
      id: m.id,
      role: m.role as CoachUIMessage["role"],
      parts: m.parts,
    })) as CoachUIMessage[];

    // Commit the durable answer and domain effects before exposing it to a client.
    const coachStreamStartedAt = Date.now();

    if (!incoming?.id) throw new Error("A stable message ID is required");
    const result = await runCoachTurn({
      userId,
      threadId,
      requestId: incoming.id,
      intakeProse,
      text: incoming.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n"),
    });

    const parts = result.parts as unknown[];
    await persistMessage(threadId, "assistant", parts, `${threadId}:${result.id}`);

    recordCoachStreamCall({
      userId,
      latencyMs: Date.now() - coachStreamStartedAt,
      status: "ok",
      model: GEMINI_MODEL,
      provider: "google",
      metadata: { threadId },
    });

    const redFlag = findToolCall(parts, "flagRedFlag");
    if (redFlag) {
      // Soft audit tag only — flag the thread for internal review but
      // never terminate it. The user keeps chatting; the Coach keeps
      // gathering context.
      const reason = (redFlag.input as { reason?: string } | undefined)?.reason ?? "unspecified";
      await flagThreadForReview(threadId, reason);
    }

    const ended = findToolCall(parts, "endSession");
    if (ended) {
      await transitionThreadCompleted(threadId);
      try {
        const summary = await extractIntakeSummary(
          {
            structuredIntakeProse: intakeProse,
            messages: fullHistory.map((m) => ({
              role: m.role as "user" | "assistant" | "system",
              parts: m.parts as unknown[],
            })),
          },
          instrumentGenerateObject({ endpoint: "intake_extraction", userId }),
        );
        await upsertIntakeSummary(userId, threadId, summary);
      } catch (err) {
        request.log.warn(
          { err, threadId },
          "Coach intake extraction failed; thread completed without summary",
        );
      }
    }
    const stream = createUIMessageStream<CoachUIMessage>({
      originalMessages: fullHistory,
      execute: async ({ writer }) => {
        writer.write({ type: "start", messageId: result.id });
        for (const [index, part] of result.parts.entries()) {
          if (part.type === "text") {
            const id = `text-${index}`;
            writer.write({ type: "text-start", id });
            writer.write({ type: "text-delta", id, delta: part.text ?? "" });
            writer.write({ type: "text-end", id });
          } else if (part.type.startsWith("tool-")) {
            const toolCallId = part.toolCallId ?? `tool-${index}`;
            writer.write({
              type: "tool-input-available",
              toolCallId,
              toolName: part.type.slice(5),
              input: part.input,
            });
            writer.write({ type: "tool-output-available", toolCallId, output: part.output });
          }
        }
        writer.write({ type: "finish" });
      },
    });

    const response = createUIMessageStreamResponse({ stream });

    // Pipe the already-committed response using Fastify's raw SSE transport.
    reply.hijack();
    reply.raw.statusCode = response.status;
    response.headers.forEach((value, key) => reply.raw.setHeader(key, value));

    if (!response.body) {
      reply.raw.end();
      return;
    }

    // `response.body` is the DOM-lib `ReadableStream`; `Readable.fromWeb`
    // wants the `node:stream/web` flavour. They're structurally compatible at
    // runtime — bridge the (lib-drift) type mismatch via the expected param type.
    const nodeStream = Readable.fromWeb(
      response.body as unknown as Parameters<typeof Readable.fromWeb>[0],
    );
    nodeStream.pipe(reply.raw);
    await new Promise<void>((resolve, reject) => {
      nodeStream.on("end", resolve);
      nodeStream.on("error", reject);
    });
  });
}

// Re-exported so tests can reference the safety message without importing the agent.
export { RED_FLAG_SAFETY_MESSAGE };
