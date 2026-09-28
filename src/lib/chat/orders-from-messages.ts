import { getToolName, isToolUIPart } from "ai";
import type { OrderSummary } from "@/lib/orders/pricing";
import type { ChatMessage } from "./types";

/** A staff action result, remembered with how many tool updates that order had at the time. */
export type StaffOverride = { order: OrderSummary; afterToolUpdates: number };

export type OrderView = { order: OrderSummary; toolUpdates: number };

function isOrderSummary(value: unknown): value is OrderSummary {
  const v = value as OrderSummary | null;
  return typeof v?.order_id === "string" && Array.isArray(v.lines) && typeof v.total === "number";
}

/**
 * The latest known state of every order mentioned in the conversation, oldest
 * first. Tool results come from the assistant; staff overrides (confirm/cancel
 * button results) win unless the assistant has updated the order since.
 */
export function ordersFromMessages(
  messages: ChatMessage[],
  overrides: Record<string, StaffOverride> = {},
): OrderView[] {
  const views = new Map<string, OrderView>();

  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if (!isToolUIPart(part) || part.state !== "output-available") continue;
      const output = part.output as { ok?: boolean; order?: unknown; order_id?: unknown; status?: unknown };
      if (!output?.ok) continue;

      if (isOrderSummary(output.order)) {
        const previous = views.get(output.order.order_id);
        views.delete(output.order.order_id); // re-insert so the most recently touched order is last
        views.set(output.order.order_id, { order: output.order, toolUpdates: (previous?.toolUpdates ?? 0) + 1 });
      } else if (getToolName(part) === "cancel_pending_order" && typeof output.order_id === "string") {
        const previous = views.get(output.order_id);
        if (previous) {
          views.set(output.order_id, {
            order: { ...previous.order, status: "cancelled" },
            toolUpdates: previous.toolUpdates + 1,
          });
        }
      }
    }
  }

  for (const [orderId, override] of Object.entries(overrides)) {
    const view = views.get(orderId);
    if (view && view.toolUpdates <= override.afterToolUpdates) {
      views.set(orderId, { ...view, order: override.order });
    }
  }

  return [...views.values()];
}
