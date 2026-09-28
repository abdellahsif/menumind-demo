import { convertToModelMessages, createUIMessageStreamResponse, stepCountIs, streamText, validateUIMessages } from "ai";
import { guardAllergenStream } from "@/lib/chat/guarded-stream";
import { SYSTEM_PROMPT } from "@/lib/chat/system-prompt";
import type { ChatMessage } from "@/lib/chat/types";
import { chatModel } from "@/lib/llm/model";
import { supabaseAuditSink, supabaseToolStore } from "@/lib/orders/supabase-store";
import { createAssistantTools } from "@/lib/tools/registry";

export const runtime = "nodejs";
// Must cover the 120 s model timeout below (Vercel Hobby with Fluid compute allows up to 300 s).
export const maxDuration = 130;

const MAX_HISTORY = 40;
const MAX_STEPS = 8;

export async function POST(request: Request): Promise<Response> {
  let messages: ChatMessage[];
  try {
    const body = (await request.json()) as { messages?: unknown };
    messages = await validateUIMessages<ChatMessage>({ messages: body.messages });
  } catch {
    return Response.json({ error: "Invalid chat request" }, { status: 400 });
  }

  let audit: ReturnType<typeof supabaseAuditSink>;
  let tools: ReturnType<typeof createAssistantTools>;
  let model: ReturnType<typeof chatModel>;
  try {
    audit = supabaseAuditSink();
    tools = createAssistantTools({ store: supabaseToolStore(), audit });
    model = chatModel();
  } catch (error) {
    // Usually a missing or invalid environment variable. The message names the
    // variable but never its value (see formatEnvError).
    console.error("[chat] server not configured", error);
    const reason = error instanceof Error ? error.message.split("\n").slice(0, 3).join(" ") : "unknown error";
    return Response.json({ error: `Server configuration error: ${reason}` }, { status: 500 });
  }

  const result = streamText({
    model,
    instructions: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages.slice(-MAX_HISTORY), { ignoreIncompleteToolCalls: true }),
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
    // A stalled provider must not leave the chat spinning forever.
    timeout: { stepMs: 45_000, totalMs: 120_000 },
  });

  // Text is held back and checked for ungrounded allergen statements before it
  // reaches the browser; a flagged message is replaced with a safe fallback.
  const stream = guardAllergenStream(result.toUIMessageStream<ChatMessage>({ onError: describeError }), async (excerpts) => {
    console.warn("[allergen-guard] replaced an ungrounded allergen statement", excerpts);
    await audit.record({
      tool_name: "guard:allergen_grounding",
      order_id: null,
      input: { excerpts },
      output: {
        flagged: true,
        action: "replaced_with_fallback",
        reason: "Allergens mentioned without a preceding get_allergens call in this turn",
      },
    });
  });

  return createUIMessageStreamResponse({ stream });
}

/** Message shown in the chat when the model call fails. Never exposes server details. */
function describeError(error: unknown): string {
  console.error("[chat] model call failed", error);
  const text = error instanceof Error ? error.message : String(error);
  if (/quota|rate.?limit|429|resource.?exhausted/i.test(text)) {
    return "The AI provider's rate limit was reached (the free tier allows only a few requests per minute). Wait a minute and try again.";
  }
  if (/timeout|timed out|abort/i.test(text) || (error instanceof Error && /Timeout|Abort/.test(error.name))) {
    return "The AI model took too long to answer. Any change shown on the order card was saved; nothing was confirmed. Try again.";
  }
  return "The assistant ran into an error. Nothing was confirmed.";
}
