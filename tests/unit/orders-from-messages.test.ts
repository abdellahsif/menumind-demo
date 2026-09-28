import { describe, expect, it } from "vitest";
import { ordersFromMessages } from "@/lib/chat/orders-from-messages";
import type { ChatMessage } from "@/lib/chat/types";
import type { OrderSummary } from "@/lib/orders/pricing";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const summary = (order_id: string, patch: Partial<OrderSummary> = {}): OrderSummary => ({
  order_id,
  table: 4,
  status: "pending",
  discount_percent: 0,
  lines: [{ item_id: "cola", name: "Cola", qty: 1, unit_price: 3.5, line_total: 3.5 }],
  subtotal: 3.5,
  discount_amount: 0,
  total: 3.5,
  ...patch,
});

let seq = 0;
const toolPart = (name: string, output: unknown, state = "output-available") =>
  ({ type: `tool-${name}`, toolCallId: `c${++seq}`, state, input: {}, output }) as ChatMessage["parts"][number];
const assistant = (...parts: ChatMessage["parts"]): ChatMessage => ({ id: `m${++seq}`, role: "assistant", parts });
const user = (text: string): ChatMessage => ({ id: `m${++seq}`, role: "user", parts: [{ type: "text", text }] });

describe("ordersFromMessages", () => {
  it("keeps the latest summary per order, most recently touched last", () => {
    const views = ordersFromMessages([
      user("two orders"),
      assistant(toolPart("create_pending_order", { ok: true, order: summary(A) })),
      assistant(toolPart("create_pending_order", { ok: true, order: summary(B, { table: 5 }) })),
      assistant(toolPart("apply_discount", { ok: true, order: summary(A, { discount_percent: 10, total: 3.15 }) })),
    ]);
    expect(views.map((v) => [v.order.order_id, v.order.total])).toEqual([
      [B, 3.5],
      [A, 3.15],
    ]);
  });

  it("ignores failed and still-running tool calls", () => {
    const views = ordersFromMessages([
      assistant(
        toolPart("create_pending_order", { ok: true, order: summary(A) }),
        toolPart("apply_discount", { ok: false, error: "invalid_input" }),
        toolPart("edit_pending_order", undefined, "input-available"),
      ),
    ]);
    expect(views).toHaveLength(1);
    expect(views[0]!.order.total).toBe(3.5);
  });

  it("marks an order cancelled by the assistant", () => {
    const views = ordersFromMessages([
      assistant(toolPart("create_pending_order", { ok: true, order: summary(A) })),
      assistant(toolPart("cancel_pending_order", { ok: true, order_id: A, status: "cancelled" })),
    ]);
    expect(views[0]!.order.status).toBe("cancelled");
  });

  it("applies a staff confirm result on top of the tool summary", () => {
    const messages = [assistant(toolPart("create_pending_order", { ok: true, order: summary(A) }))];
    const views = ordersFromMessages(messages, {
      [A]: { order: summary(A, { status: "confirmed" }), afterToolUpdates: 1 },
    });
    expect(views[0]!.order.status).toBe("confirmed");
  });

  it("lets a newer assistant update win over an older staff result", () => {
    const messages = [
      assistant(toolPart("create_pending_order", { ok: true, order: summary(A) })),
      assistant(toolPart("edit_pending_order", { ok: true, order: summary(A, { table: 9 }) })),
    ];
    const views = ordersFromMessages(messages, {
      // e.g. a "prices changed" refresh returned before the assistant edited the order
      [A]: { order: summary(A, { total: 4 }), afterToolUpdates: 1 },
    });
    expect(views[0]!.order).toMatchObject({ table: 9, total: 3.5 });
  });
});
