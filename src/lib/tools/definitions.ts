import { z } from "zod";
import { interpretAllergens } from "@/lib/menu/allergens";
import { searchMenuItems } from "@/lib/menu/search";
import { summarizeOrder } from "@/lib/orders/pricing";
import type { MenuItem, Order, OrderLine, ToolStore } from "@/lib/orders/store";
import type { Json } from "@/lib/supabase/database.types";

/*
 * The complete set of tools the assistant can call. There is deliberately no
 * tool that confirms an order or changes its status to anything but "cancelled".
 * See tests/unit/tool-safety.test.ts.
 */

export const MAX_DISCOUNT_PERCENT = 20;
const MAX_QTY = 50;
const MAX_LINES = 30;

const itemId = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use the exact item_id returned by search_menu");
const orderId = z.uuid();
const tableNumber = z.number().int().min(1).max(999);

export type ToolFailure = { ok: false; error: string; message: string };
export type ToolResult = ({ ok: true } & Record<string, Json>) | ToolFailure;

const fail = (error: string, message: string): ToolFailure => ({ ok: false, error, message });

type ToolDefinition<S extends z.ZodType> = {
  description: string;
  schema: S;
  run: (input: z.infer<S>, store: ToolStore) => Promise<ToolResult>;
};

const define = <S extends z.ZodType>(def: ToolDefinition<S>) => def;

// --- helpers -----------------------------------------------------------------

async function menuMap(store: ToolStore): Promise<Map<string, MenuItem>> {
  return new Map((await store.listMenu()).map((item) => [item.id, item]));
}

async function orderSummary(store: ToolStore, order: Order): Promise<ToolResult> {
  return { ok: true, order: summarizeOrder(order, await menuMap(store)) };
}

/** Loads an order and refuses anything that is not pending. */
async function loadPending(store: ToolStore, id: string): Promise<Order | ToolFailure> {
  const order = await store.getOrder(id);
  if (!order) return fail("order_not_found", `No order with id ${id}.`);
  if (order.status !== "pending") {
    return fail(
      "order_not_pending",
      `Order ${id} is ${order.status}. The assistant can only change pending orders; staff handle everything after confirmation.`,
    );
  }
  return order;
}

const isFailure = (value: unknown): value is ToolFailure =>
  typeof value === "object" && value !== null && (value as ToolFailure).ok === false;

/** Checks that every item exists and is available, and returns the menu rows. */
function checkOrderable(menu: Map<string, MenuItem>, ids: string[]): ToolFailure | null {
  const unknown = ids.filter((id) => !menu.has(id));
  if (unknown.length > 0) {
    return fail("unknown_item", `Not on the menu: ${unknown.join(", ")}. Use search_menu to find the right item_id.`);
  }
  const unavailable = ids.filter((id) => !menu.get(id)!.available);
  if (unavailable.length > 0) {
    return fail(
      "item_unavailable",
      `Currently unavailable: ${unavailable.map((id) => menu.get(id)!.name).join(", ")}. It cannot be ordered.`,
    );
  }
  return null;
}

// --- tools -------------------------------------------------------------------

export const toolDefinitions = {
  search_menu: define({
    description:
      "Search the menu by name, description or ingredient. Returns item ids, names, prices and availability. " +
      "Does NOT return allergen information; use get_allergens for that.",
    schema: z.object({ query: z.string().trim().min(1).max(100) }),
    async run({ query }, store) {
      const results = searchMenuItems(await store.listMenu(), query).map((item) => ({
        item_id: item.id,
        name: item.name,
        price: item.price,
        available: item.available,
        description: item.description,
      }));
      return { ok: true, query, results };
    },
  }),

  get_item_price: define({
    description: "Get the current price and availability of one menu item.",
    schema: z.object({ item_id: itemId }),
    async run({ item_id }, store) {
      const item = await store.getMenuItem(item_id);
      if (!item) return fail("unknown_item", `Not on the menu: ${item_id}.`);
      return { ok: true, item_id: item.id, name: item.name, price: item.price, available: item.available };
    },
  }),

  get_allergens: define({
    description:
      "Get the stored allergen record (EU-14) for one menu item. This is the ONLY source for allergen answers. " +
      'If the result has status "unknown", tell the guest you cannot confirm and that they should check with the kitchen.',
    schema: z.object({ item_id: itemId }),
    async run({ item_id }, store) {
      const item = await store.getMenuItem(item_id);
      if (!item) return fail("unknown_item", `Not on the menu: ${item_id}.`);
      return { ok: true, name: item.name, allergens: interpretAllergens(item.id, item.allergens) };
    },
  }),

  create_pending_order: define({
    description:
      "Create a new PENDING order for a table. The order is not sent to the kitchen; a staff member must press Confirm in the app.",
    schema: z.object({
      table: tableNumber,
      items: z
        .array(z.object({ item_id: itemId, qty: z.number().int().min(1).max(MAX_QTY) }))
        .min(1)
        .max(MAX_LINES),
    }),
    async run({ table, items }, store) {
      const merged = new Map<string, number>();
      for (const { item_id, qty } of items) merged.set(item_id, (merged.get(item_id) ?? 0) + qty);
      const tooMany = [...merged].filter(([, qty]) => qty > MAX_QTY).map(([id]) => id);
      if (tooMany.length > 0) return fail("qty_too_large", `At most ${MAX_QTY} of one item: ${tooMany.join(", ")}.`);

      const menu = await menuMap(store);
      const problem = checkOrderable(menu, [...merged.keys()]);
      if (problem) return problem;

      const lines: OrderLine[] = [...merged].map(([item_id, qty]) => ({
        item_id,
        qty,
        unit_price_snapshot: menu.get(item_id)!.price,
      }));
      const order = await store.createPendingOrder(table, lines);
      return { ok: true, order: summarizeOrder(order, menu), next_step: "Waiting for staff to press Confirm." };
    },
  }),

  edit_pending_order: define({
    description:
      "Change a PENDING order. `table` moves it to another table. Each entry in `items` sets the NEW TOTAL quantity " +
      "of that item (0 removes it); items not listed are left unchanged.",
    schema: z.object({
      order_id: orderId,
      changes: z
        .object({
          table: tableNumber.optional(),
          items: z
            .array(z.object({ item_id: itemId, qty: z.number().int().min(0).max(MAX_QTY) }))
            .min(1)
            .max(MAX_LINES)
            .optional(),
        })
        .refine((c) => c.table !== undefined || c.items !== undefined, "Provide `table`, `items`, or both"),
    }),
    async run({ order_id, changes }, store) {
      const order = await loadPending(store, order_id);
      if (isFailure(order)) return order;

      if (changes.items) {
        const ids = changes.items.map((c) => c.item_id);
        if (new Set(ids).size !== ids.length) return fail("duplicate_item", "List each item_id at most once.");

        const menu = await menuMap(store);
        const current = new Map(order.lines.map((line) => [line.item_id, line]));
        const increased = changes.items
          .filter((c) => c.qty > (current.get(c.item_id)?.qty ?? 0))
          .map((c) => c.item_id);
        const problem = checkOrderable(menu, increased);
        if (problem) return problem;

        for (const { item_id, qty } of changes.items) {
          if (qty === 0) current.delete(item_id);
          else
            current.set(item_id, {
              item_id,
              qty,
              unit_price_snapshot: current.get(item_id)?.unit_price_snapshot ?? menu.get(item_id)!.price,
            });
        }
        if (current.size === 0) {
          return fail("empty_order", "That would remove every item. Use cancel_pending_order to cancel the order instead.");
        }
        if (!(await store.replacePendingLines(order_id, [...current.values()]))) {
          return fail("order_not_pending", `Order ${order_id} is no longer pending.`);
        }
      }

      if (changes.table !== undefined && !(await store.updatePendingOrder(order_id, { table_number: changes.table }))) {
        return fail("order_not_pending", `Order ${order_id} is no longer pending.`);
      }

      return orderSummary(store, (await store.getOrder(order_id))!);
    },
  }),

  apply_discount: define({
    description: `Set the discount on a PENDING order, as a whole percentage from 0 to ${MAX_DISCOUNT_PERCENT}. 0 removes the discount.`,
    schema: z.object({ order_id: orderId, percent: z.number().int().min(0).max(MAX_DISCOUNT_PERCENT) }),
    async run({ order_id, percent }, store) {
      const order = await loadPending(store, order_id);
      if (isFailure(order)) return order;
      if (!(await store.updatePendingOrder(order_id, { discount_percent: percent }))) {
        return fail("order_not_pending", `Order ${order_id} is no longer pending.`);
      }
      return orderSummary(store, { ...order, discount_percent: percent });
    },
  }),

  cancel_pending_order: define({
    description: "Cancel a PENDING order. Confirmed orders cannot be cancelled by the assistant.",
    schema: z.object({ order_id: orderId }),
    async run({ order_id }, store) {
      const order = await loadPending(store, order_id);
      if (isFailure(order)) return order;
      if (!(await store.cancelPendingOrder(order_id))) {
        return fail("order_not_pending", `Order ${order_id} is no longer pending.`);
      }
      return { ok: true, order_id, status: "cancelled" };
    },
  }),
};

export type ToolName = keyof typeof toolDefinitions;
export const TOOL_NAMES = Object.keys(toolDefinitions) as ToolName[];
