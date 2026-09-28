import { convertToModelMessages, stepCountIs, streamText, validateUIMessages, type UIMessage } from "ai";
import { checkAllergenGrounding } from "@/lib/chat/allergen-guard";
import { SYSTEM_PROMPT } from "@/lib/chat/system-prompt";
import { chatModel } from "@/lib/llm/model";
import { supabaseAuditSink, supabaseToolStore } from "@/lib/orders/supabase-store";
import { createAssistantTools } from "@/lib/tools/registry";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_HISTORY = 40;
const MAX_STEPS = 8;

export async function POST(request: Request): Promise<Response> {
  let messages: UIMessage[];
  try {
    const body = (await request.json()) as { messages?: unknown };
    messages = await validateUIMessages<UIMessage>({ messages: body.messages });
  } catch {
    return Response.json({ error: "Invalid chat request" }, { status: 400 });
  }

  const audit = supabaseAuditSink();
  const tools = createAssistantTools({ store: supabaseToolStore(), audit });

  const result = streamText({
    model: chatModel(),
    instructions: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages.slice(-MAX_HISTORY), { ignoreIncompleteToolCalls: true }),
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
    // `content` holds every step of this turn, in order, so the check sees
    // whether get_allergens ran before any allergen statement.
    onEnd: async ({ content }) => {
      const check = checkAllergenGrounding(content);
      if (!check.flagged) return;
      console.warn("[allergen-guard] ungrounded allergen statement", check.excerpts);
      try {
        await audit.record({
          tool_name: "guard:allergen_grounding",
          order_id: null,
          input: { excerpts: check.excerpts },
          output: { flagged: true, reason: "Allergens mentioned without a preceding get_allergens call in this turn" },
        });
      } catch (error) {
        console.error("[audit] FAILED to record allergen guard flag", error);
      }
    },
  });

  return result.toUIMessageStreamResponse();
}
