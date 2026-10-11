/**
 * Canonical LLM model identifiers, in a dependency-light module.
 *
 * Lives apart from session-generator.ts (which pulls in the S3 client via the
 * exercise catalogue) so lightweight consumers — the Coach stream, the
 * observability layer, the pricing table — can reference the model ids without
 * dragging the whole generation stack (and `bun`-only imports) into their
 * module graph. session-generator.ts re-exports these for backwards compat.
 */
export const GEMINI_MODEL = "gemini-3.1-flash-lite";
export const CLAUDE_MODEL = "claude-haiku-4-5-20251001";
export const PROMPT_VERSION = "v1";
