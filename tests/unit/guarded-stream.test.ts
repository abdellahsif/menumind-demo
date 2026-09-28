import { readUIMessageStream, stepCountIs, streamText, tool } from "ai";
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ALLERGEN_FALLBACK, guardAllergenStream } from "@/lib/chat/guarded-stream";
import type { ChatChunk, ChatMessage } from "@/lib/chat/types";

// --- chunk helpers -------------------------------------------------------------

const text = (id: string, ...deltas: string[]): ChatChunk[] => [
  { type: "text-start", id },
  ...deltas.map((delta) => ({ type: "text-delta" as const, id, delta })),
  { type: "text-end", id },
];
const toolCall = (toolCallId: string, toolName: string): ChatChunk[] => [
  { type: "tool-input-start", toolCallId, toolName },
  { type: "tool-input-available", toolCallId, toolName, input: {} },
  { type: "tool-output-available", toolCallId, output: { ok: true } },
];
const step = (...chunks: ChatChunk[][]): ChatChunk[] => [{ type: "start-step" }, ...chunks.flat(), { type: "finish-step" }];

async function collect(stream: ReadableStream<ChatChunk>): Promise<ChatChunk[]> {
  const out: ChatChunk[] = [];
  for await (const chunk of stream as unknown as AsyncIterable<ChatChunk>) out.push(chunk);
  return out;
}

function guard(chunks: ChatChunk[], onFlag = vi.fn(async () => {})) {
  return { out: collect(guardAllergenStream(convertArrayToReadableStream(chunks), onFlag)), onFlag };
}

const textOf = (chunks: ChatChunk[]) =>
  chunks.flatMap((c) => (c.type === "text-delta" ? [c.delta] : [])).join("");
const guardStatuses = (chunks: ChatChunk[]) =>
  chunks.flatMap((c) => (c.type === "data-guard" ? [c.data.status] : []));

// --- tests ---------------------------------------------------------------------

describe("guardAllergenStream (blocking)", () => {
  it("replaces an ungrounded allergen message with the fallback and never sends the original", async () => {
    const { out, onFlag } = guard([
      { type: "start" },
      ...step(text("t1", "The Greek salad ", "is nut-free.")),
      { type: "finish" },
    ]);
    const chunks = await out;

    expect(textOf(chunks)).toBe(ALLERGEN_FALLBACK);
    expect(JSON.stringify(chunks)).not.toContain("nut-free");
    expect(guardStatuses(chunks)).toEqual(["checking", "replaced"]);
    expect(onFlag).toHaveBeenCalledWith(["The Greek salad is nut-free."]);
  });

  it("releases the original text when get_allergens was called earlier in the turn", async () => {
    const { out, onFlag } = guard([
      { type: "start" },
      ...step(toolCall("c1", "get_allergens")),
      ...step(text("t1", "Pad thai contains peanuts, eggs and fish.")),
      { type: "finish" },
    ]);
    const chunks = await out;

    expect(textOf(chunks)).toBe("Pad thai contains peanuts, eggs and fish.");
    expect(guardStatuses(chunks)).toEqual(["checking", "passed"]);
    expect(onFlag).not.toHaveBeenCalled();
  });

  it("replaces the message if the allergen claim came before the get_allergens call", async () => {
    const { out } = guard([
      { type: "start" },
      ...step(text("t1", "No nuts in the tiramisu."), toolCall("c1", "get_allergens")),
      ...step(text("t2", "Checked: may contain tree nuts.")),
      { type: "finish" },
    ]);
    expect(textOf(await out)).toBe(ALLERGEN_FALLBACK);
  });

  it("passes ordinary order messages through unchanged", async () => {
    const { out, onFlag } = guard([
      { type: "start" },
      ...step(toolCall("c1", "create_pending_order")),
      ...step(text("t1", "Order created for table 4. Press Confirm when ready.")),
      { type: "finish" },
    ]);
    expect(textOf(await out)).toBe("Order created for table 4. Press Confirm when ready.");
    expect(onFlag).not.toHaveBeenCalled();
  });

  it("streams tool activity immediately but holds all text until the turn finishes", async () => {
    let push!: (chunk: ChatChunk) => void;
    let end!: () => void;
    const source = new ReadableStream<ChatChunk>({
      start(controller) {
        push = (chunk) => controller.enqueue(chunk);
        end = () => controller.close();
      },
    });
    const reader = guardAllergenStream(source, async () => {}).getReader();
    const received: ChatChunk[] = [];
    const pump = (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        received.push(value);
      }
    })();
    const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

    push({ type: "start" });
    push({ type: "start-step" });
    for (const chunk of toolCall("c1", "search_menu")) push(chunk);
    for (const chunk of text("t1", "Found ", "two pizzas.")) push(chunk);
    push({ type: "finish-step" });
    await settle();

    // Tool activity and the "checking" state are already visible; no text yet.
    expect(received.some((c) => c.type === "tool-output-available")).toBe(true);
    expect(guardStatuses(received)).toEqual(["checking"]);
    expect(received.some((c) => c.type.startsWith("text-"))).toBe(false);

    push({ type: "finish" });
    end();
    await pump;
    expect(textOf(received)).toBe("Found two pizzas.");
    // Text is released after the guard verdict, just before finish.
    const types = received.map((c) => c.type);
    expect(types.indexOf("text-start")).toBeGreaterThan(types.lastIndexOf("finish-step"));
    expect(types.at(-1)).toBe("finish");
  });

  it("forgets text from a step the SDK reset", async () => {
    const { out } = guard([
      { type: "start" },
      { type: "start-step" },
      ...text("t1", "It is gluten-free."),
      { type: "reset-step" },
      ...step(text("t2", "Order updated.")),
      { type: "finish" },
    ]);
    expect(textOf(await out)).toBe("Order updated.");
  });

  it("still checks (and replaces) if the stream ends without a finish chunk", async () => {
    const { out } = guard([{ type: "start" }, { type: "start-step" }, ...text("t1", "Contains no dairy.")]);
    const chunks = await out;
    expect(textOf(chunks)).toBe(ALLERGEN_FALLBACK);
  });

  it("still replaces the message if writing the audit entry fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = vi.fn(async () => {
      throw new Error("audit down");
    });
    const { out } = guard([{ type: "start" }, ...step(text("t1", "Contains milk.")), { type: "finish" }], failing);
    expect(textOf(await out)).toBe(ALLERGEN_FALLBACK);
    vi.restoreAllMocks();
  });
});

describe("guard end to end with a streaming model", () => {
  const usage = {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  };

  function textResponse(message: string) {
    return {
      stream: convertArrayToReadableStream([
        { type: "stream-start" as const, warnings: [] },
        { type: "text-start" as const, id: "m" },
        ...message.split(" ").map((word, i) => ({ type: "text-delta" as const, id: "m", delta: (i ? " " : "") + word })),
        { type: "text-end" as const, id: "m" },
        { type: "finish" as const, finishReason: { unified: "stop" as const, raw: undefined }, usage },
      ]),
    };
  }

  async function finalMessage(stream: ReadableStream<ChatChunk>): Promise<ChatMessage> {
    let last: ChatMessage | undefined;
    for await (const message of readUIMessageStream<ChatMessage>({ stream })) last = message;
    return last!;
  }

  it("the guest sees only the fallback when the model answers allergens from memory", async () => {
    const onFlag = vi.fn(async () => {});
    const result = streamText({
      model: new MockLanguageModelV4({ doStream: textResponse("The carbonara is gluten-free and safe for coeliacs.") }),
      prompt: "is the carbonara gluten free?",
    });
    const message = await finalMessage(guardAllergenStream(result.toUIMessageStream<ChatMessage>(), onFlag));

    const texts = message.parts.flatMap((p) => (p.type === "text" ? [p.text] : []));
    expect(texts).toEqual([ALLERGEN_FALLBACK]);
    expect(message.parts).toContainEqual(expect.objectContaining({ type: "data-guard", data: { status: "replaced" } }));
    expect(onFlag).toHaveBeenCalledTimes(1);
  });

  it("the guest sees the real answer when it is grounded in get_allergens", async () => {
    const model = new MockLanguageModelV4({
      doStream: [
        {
          stream: convertArrayToReadableStream([
            { type: "stream-start" as const, warnings: [] },
            { type: "tool-call" as const, toolCallId: "c1", toolName: "get_allergens", input: '{"item_id":"spaghetti-carbonara"}' },
            { type: "finish" as const, finishReason: { unified: "tool-calls" as const, raw: undefined }, usage },
          ]),
        },
        textResponse("Carbonara contains gluten, eggs and milk."),
      ],
    });
    const result = streamText({
      model,
      prompt: "is the carbonara gluten free?",
      tools: {
        get_allergens: tool({
          inputSchema: z.object({ item_id: z.string() }),
          execute: async () => ({ ok: true, allergens: { status: "known", contains: ["gluten", "eggs", "milk"] } }),
        }),
      },
      stopWhen: stepCountIs(3),
    });
    const message = await finalMessage(guardAllergenStream(result.toUIMessageStream<ChatMessage>(), vi.fn()));

    const texts = message.parts.flatMap((p) => (p.type === "text" ? [p.text] : []));
    expect(texts).toEqual(["Carbonara contains gluten, eggs and milk."]);
    expect(message.parts).toContainEqual(expect.objectContaining({ type: "data-guard", data: { status: "passed" } }));
  });
});
