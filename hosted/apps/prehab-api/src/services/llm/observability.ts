/**
 * LLM call observability (PRE-131).
 *
 * The single instrumentation seam for every model call. All `generateObject`
 * call sites already accept an injectable `generateObjectFn`; wrap that fn with
 * `instrumentGenerateObject({ endpoint, userId })` and each call is timed, its
 * token usage + estimated cost captured, and a row written to `llm_call_logs`
 * — plus a `gen_ai.*` OTel span so it flows through the existing OTLP pipeline
 * (instrumentation.ts) when an exporter is configured.
 *
 * Recording is best-effort: a failure to persist the metric never breaks the
 * underlying generation. Provider-agnostic — works for Gemini and Claude
 * (and anything else the `ai` SDK fronts) because it reads the standard
 * `result.usage` shape and the model's `.modelId` / `.provider`.
 */
import { trace, SpanStatusCode } from "@opentelemetry/api";
import { generateObject as _generateObject } from "../durable/runtime";

import { db, llmCallLogs } from "../../db";
import { logger } from "../../lib/logger";
import { estimateCostUsd } from "./pricing";

// The AI surfaces that make model calls. Kept in sync with the contract's
// LlmEndpointEnum and the playground.
export type LlmEndpoint =
  | "daily_generation"
  | "regenerate"
  | "weekly_scaffold"
  | "reveal_copy"
  | "intake_extraction"
  | "coach_stream"
  | "playground";

// Loose to match the injectable type in session-generator.ts / extraction.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GenerateObjectFn = (params: any) => Promise<{ object: any }>;

export interface InstrumentOptions {
  endpoint: LlmEndpoint;
  /** Target user the call is for. Null/undefined for synthetic playground runs. */
  userId?: string | null;
  /** Extra context persisted to `metadata` (lean flag, sessionId, attempt…). */
  metadata?: Record<string, unknown>;
  /** Surfaced back to the caller (e.g. the playground) once the call resolves. */
  onRecord?: (record: RecordedCall) => void;
}

export interface RecordedCall {
  endpoint: LlmEndpoint;
  provider: string;
  model: string;
  status: "ok" | "error";
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  latencyMs: number;
  errorMessage?: string | null;
}

// ── usage / model extraction (provider + SDK-version tolerant) ───────────────

interface UsageLike {
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  // v4/v5 names, kept as a defensive fallback.
  promptTokens?: number | null;
  completionTokens?: number | null;
}

function readUsage(result: unknown): {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
} {
  const usage = (result as { usage?: UsageLike } | null)?.usage ?? {};
  const inputTokens = usage.inputTokens ?? usage.promptTokens ?? null;
  const outputTokens = usage.outputTokens ?? usage.completionTokens ?? null;
  const totalTokens =
    usage.totalTokens ??
    (inputTokens != null || outputTokens != null ? (inputTokens ?? 0) + (outputTokens ?? 0) : null);
  return { inputTokens, outputTokens, totalTokens };
}

function readModel(params: unknown): { model: string; provider: string } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = (params as any)?.model;
  const model: string = m?.modelId ?? (typeof m === "string" ? m : "unknown");
  const rawProvider: string = m?.provider ?? "unknown";
  // Normalise "google.generative-ai" / "anthropic.messages" → "google" / "anthropic".
  const provider = rawProvider.split(".")[0] ?? rawProvider;
  return { model, provider };
}

// ── persistence (best-effort) ────────────────────────────────────────────────

interface PersistInput extends RecordedCall {
  userId?: string | null;
  promptVersion?: string | null;
  metadata?: Record<string, unknown>;
}

async function persistLlmCall(rec: PersistInput): Promise<void> {
  try {
    await db.insert(llmCallLogs).values({
      userId: rec.userId ?? null,
      endpoint: rec.endpoint,
      operation: rec.endpoint === "coach_stream" ? "stream" : "generateObject",
      provider: rec.provider,
      model: rec.model,
      status: rec.status,
      inputTokens: rec.inputTokens,
      outputTokens: rec.outputTokens,
      totalTokens: rec.totalTokens,
      costUsd: rec.costUsd != null ? String(rec.costUsd) : null,
      latencyMs: rec.latencyMs,
      errorMessage: rec.errorMessage,
      promptVersion: rec.promptVersion ?? null,
      metadata: rec.metadata ?? null,
    });
  } catch (err) {
    // Never let observability break generation — just log and move on.
    logger.warn({ err, endpoint: rec.endpoint }, "llm_call_log persist failed");
  }

  logger.info(
    {
      evt: "llm_call",
      endpoint: rec.endpoint,
      provider: rec.provider,
      model: rec.model,
      status: rec.status,
      userId: rec.userId ?? null,
      inputTokens: rec.inputTokens,
      outputTokens: rec.outputTokens,
      costUsd: rec.costUsd,
      latencyMs: rec.latencyMs,
    },
    "llm call",
  );
}

const tracer = trace.getTracer("prehab-llm");

/**
 * Sets gen_ai.* semantic-convention attributes on an LLM span so the existing
 * OTLP exporter surfaces token/cost/latency in traces.
 */
function setLlmSpanAttributes(
  span: ReturnType<typeof tracer.startSpan>,
  rec: RecordedCall,
  userId?: string | null,
): void {
  span.setAttribute("gen_ai.operation.name", "generate_object");
  span.setAttribute("gen_ai.system", rec.provider);
  span.setAttribute("gen_ai.request.model", rec.model);
  span.setAttribute("llm.endpoint", rec.endpoint);
  if (userId) span.setAttribute("enduser.id", userId);
  if (rec.inputTokens != null) span.setAttribute("gen_ai.usage.input_tokens", rec.inputTokens);
  if (rec.outputTokens != null) span.setAttribute("gen_ai.usage.output_tokens", rec.outputTokens);
  if (rec.costUsd != null) span.setAttribute("llm.cost_usd", rec.costUsd);
  span.setAttribute("llm.latency_ms", rec.latencyMs);
}

/**
 * Wraps a `generateObject` fn so every call is measured + recorded. Drop-in for
 * the `generateObjectFn` parameter that the generators already accept:
 *
 *   await generateDailySessionWithAI(
 *     inputs,
 *     instrumentGenerateObject({ endpoint: "daily_generation", userId }),
 *     models,
 *     { lean },
 *   );
 *
 * A generator that makes several model calls (fallback + catalogue-correction
 * retries) records one row per underlying call, so per-attempt spend is visible.
 */
export function instrumentGenerateObject(
  opts: InstrumentOptions,
  base: GenerateObjectFn = _generateObject as GenerateObjectFn,
): GenerateObjectFn {
  return async (params) => {
    const { model, provider } = readModel(params);
    const startedAt = Date.now();
    const span = tracer.startSpan(`llm.${opts.endpoint}`);
    try {
      const result = await base(params);
      const latencyMs = Date.now() - startedAt;
      const { inputTokens, outputTokens, totalTokens } = readUsage(result);
      const costUsd = estimateCostUsd(model, inputTokens, outputTokens);
      const rec: RecordedCall = {
        endpoint: opts.endpoint,
        provider,
        model,
        status: "ok",
        inputTokens,
        outputTokens,
        totalTokens,
        costUsd,
        latencyMs,
      };
      setLlmSpanAttributes(span, rec, opts.userId);
      span.setStatus({ code: SpanStatusCode.OK });
      void persistLlmCall({
        ...rec,
        userId: opts.userId,
        metadata: opts.metadata,
      });
      opts.onRecord?.(rec);
      return result;
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      const message = err instanceof Error ? err.message : String(err);
      const rec: RecordedCall = {
        endpoint: opts.endpoint,
        provider,
        model,
        status: "error",
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        costUsd: null,
        latencyMs,
        errorMessage: message.slice(0, 1000),
      };
      span.recordException(err instanceof Error ? err : new Error(message));
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      void persistLlmCall({ ...rec, userId: opts.userId, metadata: opts.metadata });
      opts.onRecord?.(rec);
      throw err;
    } finally {
      span.end();
    }
  };
}

/**
 * Records Coach latency, status and optional token usage independently of the SSE transport.
 * Best-effort, same as the generateObject path.
 */
export function recordCoachStreamCall(input: {
  userId: string;
  latencyMs: number;
  status: "ok" | "error";
  model: string;
  provider?: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
}): void {
  const inputTokens = input.inputTokens ?? null;
  const outputTokens = input.outputTokens ?? null;
  const totalTokens =
    inputTokens != null || outputTokens != null ? (inputTokens ?? 0) + (outputTokens ?? 0) : null;
  void persistLlmCall({
    endpoint: "coach_stream",
    provider: input.provider ?? "google",
    model: input.model,
    status: input.status,
    inputTokens,
    outputTokens,
    totalTokens,
    costUsd: estimateCostUsd(input.model, inputTokens, outputTokens),
    latencyMs: input.latencyMs,
    errorMessage: input.errorMessage ?? null,
    userId: input.userId,
    metadata: input.metadata,
  });
}
