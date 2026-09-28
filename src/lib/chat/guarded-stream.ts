import { checkAllergenGrounding, type TurnPart } from "./allergen-guard";
import type { ChatChunk } from "./types";

export const ALLERGEN_FALLBACK = "I can't confirm this, please check with the kitchen.";

const GUARD_PART_ID = "allergen-guard";

type BufferedText = { id: string; part: TurnPart & { type: "text"; text: string } };

/**
 * Wraps the assistant's UI message stream so no text reaches the browser until
 * the whole turn has been checked for ungrounded allergen statements.
 *
 * - Tool activity is forwarded immediately, so staff see the assistant working.
 * - Text is held back. When text starts, a `data-guard` part with status
 *   "checking" is sent so the UI can show a checking state.
 * - At the end of the turn the guard runs on the complete turn. If it passes, the
 *   original text is released; if not, only ALLERGEN_FALLBACK is sent, and
 *   `onFlag` is awaited (used to write the audit log) before anything is released.
 */
export function guardAllergenStream(
  source: ReadableStream<ChatChunk>,
  onFlag: (excerpts: string[]) => Promise<void>,
): ReadableStream<ChatChunk> {
  let parts: TurnPart[] = [];
  let texts: BufferedText[] = [];
  let stepStart = { parts: 0, texts: 0 };
  const toolCallsSeen = new Set<string>();
  let checkingSent = false;
  let released = false;

  async function release(controller: TransformStreamDefaultController<ChatChunk>) {
    if (released) return;
    released = true;
    if (texts.length === 0) {
      if (checkingSent) controller.enqueue({ type: "data-guard", id: GUARD_PART_ID, data: { status: "passed" } });
      return;
    }

    const check = checkAllergenGrounding(parts);
    if (check.flagged) {
      try {
        await onFlag(check.excerpts);
      } catch (error) {
        console.error("[allergen-guard] failed to record flag", error);
      }
    }

    controller.enqueue({
      type: "data-guard",
      id: GUARD_PART_ID,
      data: { status: check.flagged ? "replaced" : "passed" },
    });

    const outgoing = check.flagged
      ? [{ id: "allergen-fallback", text: ALLERGEN_FALLBACK }]
      : texts.map(({ id, part }) => ({ id, text: part.text }));
    for (const { id, text } of outgoing) {
      controller.enqueue({ type: "text-start", id });
      controller.enqueue({ type: "text-delta", id, delta: text });
      controller.enqueue({ type: "text-end", id });
    }
  }

  return source.pipeThrough(
    new TransformStream<ChatChunk, ChatChunk>({
      async transform(chunk, controller) {
        switch (chunk.type) {
          case "text-start": {
            const part = { type: "text" as const, text: "" };
            parts.push(part);
            texts.push({ id: chunk.id, part });
            if (!checkingSent) {
              checkingSent = true;
              controller.enqueue({ type: "data-guard", id: GUARD_PART_ID, data: { status: "checking" } });
            }
            return;
          }
          case "text-delta": {
            const buffered = texts.find((t) => t.id === chunk.id);
            if (buffered) buffered.part.text += chunk.delta;
            return;
          }
          case "text-end":
            return;

          case "tool-input-start":
          case "tool-input-available":
            if (!toolCallsSeen.has(chunk.toolCallId)) {
              toolCallsSeen.add(chunk.toolCallId);
              parts.push({ type: "tool-call", toolName: chunk.toolName });
            }
            break;

          case "start-step":
            stepStart = { parts: parts.length, texts: texts.length };
            break;
          case "reset-step":
            // The SDK discards this step's parts; forget its text and tool calls too.
            parts = parts.slice(0, stepStart.parts);
            texts = texts.slice(0, stepStart.texts);
            break;

          case "finish":
            await release(controller);
            break;
        }
        controller.enqueue(chunk);
      },
      async flush(controller) {
        // Stream ended without a finish chunk (e.g. aborted): still never leak unchecked text.
        await release(controller);
      },
    }),
  );
}
