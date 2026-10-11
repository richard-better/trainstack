import type { Conversation, Harness } from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";

// A terminal model failure permits another attempt; completed and interrupted submissions retain their identity.
export async function submitRecoverably(
  harness: Harness,
  root: Conversation,
  requestId: string,
  content: string,
) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const key = attempt === 0 ? requestId : `${requestId}:retry:${attempt}`;
    const existing = await root.commit((tx) => tx.submissionByRequest(root.id, key), context);
    if (!existing) return root.submit({ type: "input", content, requestId: key }, context);
    if (existing.status === "unanswered") continue;
    const submission = await harness.submission(existing.id, context);
    if (submission) return submission;
  }
  throw new Error("This request has exceeded its retry limit.");
}
