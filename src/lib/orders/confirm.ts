import { z } from "zod";
import type { Json } from "@/lib/supabase/database.types";
import { summarizeOrder, type OrderSummary } from "./pricing";
import type { AuditSink, MenuItem, Order, OrderLine } from "./store";

/*
 * Human-only order actions, called from the Confirm / Cancel buttons through
 * server actions. The assistant's tools never import this module (see
 * tests/unit/tool-safety.test.ts), and it is not registered as a tool.
 */

/** Database operations only the staff actions may use. */
export interface StaffOrderStore {
  getOrder(orderId: string): Promise<Order | null>;
  listMenu(): Promise<MenuItem[]>;
  /** Updates price snapshots. Returns false if the order is not pending. */
  refreshPendingPrices(orderId: string, lines: OrderLine[]): Promise<boolean>;
  /** `update orders set status = 'confirmed' where id = $1 and status = 'pending'`. True if a row changed. */
  confirmIfPending(orderId: string): Promise<boolean>;
  /** `update orders set status = 'cancelled' where id = $1 and status = 'pending'`. True if a row changed. */
  cancelIfPending(orderId: string): Promise<boolean>;
}

export type StaffDeps = { store: StaffOrderStore; audit: AuditSink };

export type StaffActionResult =
  | { ok: true; order: OrderSummary }
  | {
      ok: false;
      error:
        | "invalid_request"
        | "order_not_found"
        | "not_pending"
        | "order_changed"
        | "items_unavailable"
        | "prices_changed";
      message: string;
      /** The current state, so the UI can refresh a stale card. */
      order?: OrderSummary;
    };

const requestSchema = z.object({
  orderId: z.uuid(),
  /** The total the staff member was looking at when they pressed Confirm. */
  expectedTotal: z.number().nonnegative().optional(),
});

const money = (n: number) => n.toFixed(2);

async function audited(
  deps: StaffDeps,
  action: string,
  input: Json,
  orderId: string | null,
  run: () => Promise<StaffActionResult>,
): Promise<StaffActionResult> {
  let result: StaffActionResult;
  try {
    result = await run();
  } catch (error) {
    console.error(`[${action}] failed`, error);
    result = { ok: false, error: "invalid_request", message: "Something went wrong. The order was not changed." };
  }
  try {
    await deps.audit.record({
      tool_name: action,
      order_id: orderId,
      input,
      output: JSON.parse(JSON.stringify(result)) as Json,
    });
  } catch (error) {
    console.error(`[audit] FAILED to record ${action}`, error);
  }
  return result;
}

function notPending(order: Order, menu: Map<string, MenuItem>): StaffActionResult {
  return {
    ok: false,
    error: "not_pending",
    message: `This order is already ${order.status}.`,
    order: summarizeOrder(order, menu),
  };
}

/**
 * Confirms a pending order after re-checking it on the server:
 * - every item still exists and is available,
 * - every price snapshot matches the current menu price (if not, the snapshots are
 *   refreshed and the staff member must confirm the new total),
 * - optionally, the total matches what the staff member saw (catches stale tabs).
 * The final write is conditional on status = 'pending', so two clicks, two tabs
 * or two devices can never confirm the same order twice.
 */
export async function confirmOrder(request: unknown, deps: StaffDeps): Promise<StaffActionResult> {
  const parsed = requestSchema.safeParse(request);
  const orderId = parsed.success ? parsed.data.orderId : null;

  return audited(deps, "action:confirm_order", JSON.parse(JSON.stringify(request ?? null)) as Json, orderId, async () => {
    if (!parsed.success) return { ok: false, error: "invalid_request", message: "Invalid confirm request." };
    const { expectedTotal } = parsed.data;
    const id = parsed.data.orderId;

    const [order, menuRows] = await Promise.all([deps.store.getOrder(id), deps.store.listMenu()]);
    const menu = new Map(menuRows.map((item) => [item.id, item]));
    if (!order) return { ok: false, error: "order_not_found", message: "Order not found." };
    if (order.status !== "pending") return notPending(order, menu);

    const unavailable = order.lines.filter((line) => !menu.get(line.item_id)?.available);
    if (unavailable.length > 0) {
      const names = unavailable.map((line) => menu.get(line.item_id)?.name ?? line.item_id);
      return {
        ok: false,
        error: "items_unavailable",
        message: `No longer available: ${names.join(", ")}. Edit the order before confirming.`,
        order: summarizeOrder(order, menu),
      };
    }

    const changed = order.lines.filter((line) => menu.get(line.item_id)!.price !== line.unit_price_snapshot);
    if (changed.length > 0) {
      const refreshed = order.lines.map((line) => ({ ...line, unit_price_snapshot: menu.get(line.item_id)!.price }));
      if (!(await deps.store.refreshPendingPrices(id, refreshed))) {
        const current = await deps.store.getOrder(id);
        return current ? notPending(current, menu) : { ok: false, error: "order_not_found", message: "Order not found." };
      }
      const details = changed
        .map((line) => `${menu.get(line.item_id)!.name} ${money(line.unit_price_snapshot)} → ${money(menu.get(line.item_id)!.price)}`)
        .join(", ");
      return {
        ok: false,
        error: "prices_changed",
        message: `Prices changed (${details}). Check the new total and confirm again.`,
        order: summarizeOrder({ ...order, lines: refreshed }, menu),
      };
    }

    const summary = summarizeOrder(order, menu);
    if (expectedTotal !== undefined && Math.round(expectedTotal * 100) !== Math.round(summary.total * 100)) {
      return {
        ok: false,
        error: "order_changed",
        message: `The order changed since you last saw it. The total is now ${money(summary.total)}. Check it and confirm again.`,
        order: summary,
      };
    }

    if (!(await deps.store.confirmIfPending(id))) {
      // Lost a race: someone else confirmed or cancelled it in the meantime.
      const current = await deps.store.getOrder(id);
      return current ? notPending(current, menu) : { ok: false, error: "order_not_found", message: "Order not found." };
    }
    return { ok: true, order: { ...summary, status: "confirmed" } };
  });
}

/** Staff cancel from the order card. Same conditional-update rule as confirm. */
export async function cancelOrder(request: unknown, deps: StaffDeps): Promise<StaffActionResult> {
  const parsed = requestSchema.pick({ orderId: true }).safeParse(request);
  const orderId = parsed.success ? parsed.data.orderId : null;

  return audited(deps, "action:cancel_order", JSON.parse(JSON.stringify(request ?? null)) as Json, orderId, async () => {
    if (!parsed.success) return { ok: false, error: "invalid_request", message: "Invalid cancel request." };
    const id = parsed.data.orderId;
    const [order, menuRows] = await Promise.all([deps.store.getOrder(id), deps.store.listMenu()]);
    const menu = new Map(menuRows.map((item) => [item.id, item]));
    if (!order) return { ok: false, error: "order_not_found", message: "Order not found." };
    if (order.status !== "pending" || !(await deps.store.cancelIfPending(id))) {
      const current = (await deps.store.getOrder(id)) ?? order;
      return notPending(current, menu);
    }
    return { ok: true, order: { ...summarizeOrder(order, menu), status: "cancelled" } };
  });
}
