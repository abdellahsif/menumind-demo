import type { InferUIMessageChunk, UIMessage } from "ai";

/** Status of the allergen guard for one assistant message. */
export type GuardData = { status: "checking" | "passed" | "replaced" };

export type ChatMessage = UIMessage<never, { guard: GuardData }>;
export type ChatChunk = InferUIMessageChunk<ChatMessage>;
