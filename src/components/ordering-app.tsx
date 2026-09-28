"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ordersFromMessages, type StaffOverride } from "@/lib/chat/orders-from-messages";
import type { ChatMessage } from "@/lib/chat/types";
import type { OrderSummary } from "@/lib/orders/pricing";
import { ChatMessageView } from "./chat-message";
import { OrderCard } from "./order-card";

const EXAMPLES = [
  "Add two margherita pizzas and one cola to table 4",
  "Does the pad thai contain peanuts?",
  "Give table 4 a 10% discount",
];

/** Turns a failed chat request into one readable line; never shows raw HTML or stack traces. */
function readableError(message: string | undefined): string {
  const fallback = "Something went wrong talking to the assistant.";
  if (!message) return fallback;
  try {
    const body = JSON.parse(message) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // not JSON
  }
  if (message.trimStart().startsWith("<") || message.length > 300) return `${fallback} (server error)`;
  return message;
}

export function OrderingApp() {
  const { messages, sendMessage, status, error, regenerate } = useChat<ChatMessage>({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });
  const [input, setInput] = useState("");
  const [overrides, setOverrides] = useState<Record<string, StaffOverride>>({});
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const busy = status === "submitted" || status === "streaming";
  const orders = useMemo(() => ordersFromMessages(messages, overrides), [messages, overrides]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    void sendMessage({ text: trimmed });
    setInput("");
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    send(input);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send(input);
    }
  }

  function onUpdated(order: OrderSummary) {
    const toolUpdates = orders.find((view) => view.order.order_id === order.order_id)?.toolUpdates ?? 0;
    setOverrides((current) => ({ ...current, [order.order_id]: { order, afterToolUpdates: toolUpdates } }));
  }

  function onEdit(order: OrderSummary) {
    setInput(`For the table ${order.table} order: `);
    inputRef.current?.focus();
  }

  return (
    <div className="mx-auto grid min-h-dvh max-w-6xl grid-rows-[auto_1fr] gap-4 p-4 lg:grid-cols-[1fr_22rem] lg:grid-rows-[auto_1fr]">
      <header className="lg:col-span-2">
        <h1 className="text-xl font-semibold">MenuMind</h1>
        <p className="text-sm text-stone-600 dark:text-stone-400">
          Type what the table wants. Nothing goes to the kitchen until you press Confirm.
        </p>
      </header>

      <section aria-label="Chat" className="flex min-h-[60dvh] flex-col rounded-2xl bg-stone-100 dark:bg-stone-900/50">
        <div className="flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
          {messages.length === 0 && (
            <div className="space-y-2">
              <p className="text-sm text-stone-600 dark:text-stone-400">Try:</p>
              <ul className="flex flex-wrap gap-2">
                {EXAMPLES.map((example) => (
                  <li key={example}>
                    <button
                      type="button"
                      onClick={() => send(example)}
                      className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-left text-sm hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:hover:bg-stone-800"
                    >
                      {example}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {messages.map((message, i) => (
            <ChatMessageView key={message.id} message={message} isLast={i === messages.length - 1} busy={busy} />
          ))}

          {status === "submitted" && messages.at(-1)?.role === "user" && (
            <p className="flex items-center gap-2 text-sm text-stone-500 dark:text-stone-400" role="status">
              <span aria-hidden className="size-2 animate-pulse rounded-full bg-stone-400" />
              Working…
            </p>
          )}

          {error && (
            <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-200">
              {readableError(error.message)}{" "}
              <button type="button" onClick={() => regenerate()} className="font-semibold underline">
                Try again
              </button>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <form onSubmit={onSubmit} className="flex items-end gap-2 border-t border-stone-200 p-3 dark:border-stone-800">
          <label htmlFor="chat-input" className="sr-only">
            Message
          </label>
          <textarea
            id="chat-input"
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            placeholder="e.g. add two margherita pizzas and one cola to table 4"
            className="min-h-11 flex-1 resize-none rounded-xl border border-stone-300 bg-white px-3 py-2 text-base focus:border-stone-500 focus:outline-none dark:border-stone-700 dark:bg-stone-950"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="h-11 rounded-xl bg-stone-900 px-4 font-semibold text-white disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900"
          >
            Send
          </button>
        </form>
      </section>

      <aside aria-label="Orders" className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Orders</h2>
        {orders.length === 0 ? (
          <p className="text-sm text-stone-500">Orders created in the chat appear here for confirmation.</p>
        ) : (
          [...orders].reverse().map(({ order }) => (
            <OrderCard key={order.order_id} order={order} onUpdated={onUpdated} onEdit={onEdit} />
          ))
        )}
      </aside>
    </div>
  );
}
