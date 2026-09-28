import "server-only";
import { supabaseAdmin, type AdminClient } from "@/lib/supabase/admin";
import type { AuditSink, MenuItem, Order, OrderLine, ToolStore } from "./store";

const MENU_COLUMNS = "id, name, price, description, available, allergens, ingredients";
const ORDER_COLUMNS = "id, table_number, status, discount_percent, created_at, order_items(item_id, qty, unit_price_snapshot)";

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}

// For queries that always return data when they succeed (lists, inserts with select).
function required<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  if (result.data === null) throw new Error(`${what}: no data returned`);
  return result.data;
}

// PostgREST may return numeric columns as strings; normalise to numbers.
const toMenuItem = (row: MenuItem): MenuItem => ({ ...row, price: Number(row.price) });

type OrderRow = Omit<Order, "lines"> & { order_items: OrderLine[] };
const toOrder = ({ order_items, ...order }: OrderRow): Order => ({
  ...order,
  lines: order_items.map((line) => ({ ...line, unit_price_snapshot: Number(line.unit_price_snapshot) })),
});

/**
 * Supabase implementation of the tool store. Every write is filtered on
 * status = 'pending', and the database triggers reject changes to non-pending
 * orders independently of this code.
 */
export function supabaseToolStore(db: AdminClient = supabaseAdmin()): ToolStore {
  async function isPending(orderId: string): Promise<boolean> {
    const row = check(
      await db.from("orders").select("status").eq("id", orderId).maybeSingle(),
      "load order status",
    );
    return row?.status === "pending";
  }

  const store: ToolStore = {
    async listMenu() {
      const rows = required(await db.from("menu_items").select(MENU_COLUMNS).order("name"), "list menu");
      return rows.map(toMenuItem);
    },

    async getMenuItem(itemId) {
      const row = check(
        await db.from("menu_items").select(MENU_COLUMNS).eq("id", itemId).maybeSingle(),
        "load menu item",
      );
      return row ? toMenuItem(row) : null;
    },

    async getOrder(orderId) {
      const row = check(
        await db.from("orders").select(ORDER_COLUMNS).eq("id", orderId).maybeSingle(),
        "load order",
      );
      return row ? toOrder(row as OrderRow) : null;
    },

    async createPendingOrder(tableNumber, lines) {
      // No status is sent: the column default and the insert trigger make it pending.
      const { data: order, error } = await db
        .from("orders")
        .insert({ table_number: tableNumber })
        .select("id")
        .single();
      if (error || !order) throw new Error(`create order: ${error?.message ?? "no row returned"}`);
      const inserted = await db.from("order_items").insert(lines.map((line) => ({ ...line, order_id: order.id })));
      if (inserted.error) {
        // Roll back by hand: supabase-js has no multi-statement transaction.
        await db.from("orders").delete().eq("id", order.id).eq("status", "pending");
        throw new Error(`create order items: ${inserted.error.message}`);
      }
      const created = await store.getOrder(order.id);
      if (!created) throw new Error("created order disappeared");
      return created;
    },

    async updatePendingOrder(orderId, patch) {
      const rows = required(
        await db.from("orders").update(patch).eq("id", orderId).eq("status", "pending").select("id"),
        "update order",
      );
      return rows.length === 1;
    },

    async replacePendingLines(orderId, lines) {
      if (!(await isPending(orderId))) return false;
      // The order_items trigger rejects both statements if the order stops being pending meanwhile.
      const keep = lines.map((line) => line.item_id);
      check(
        await db
          .from("order_items")
          .delete()
          .eq("order_id", orderId)
          .not("item_id", "in", `(${keep.map((id) => `"${id}"`).join(",")})`),
        "remove order lines",
      );
      check(
        await db
          .from("order_items")
          .upsert(
            lines.map((line) => ({ ...line, order_id: orderId })),
            { onConflict: "order_id,item_id" },
          ),
        "save order lines",
      );
      return true;
    },

    async cancelPendingOrder(orderId) {
      const rows = required(
        await db.from("orders").update({ status: "cancelled" }).eq("id", orderId).eq("status", "pending").select("id"),
        "cancel order",
      );
      return rows.length === 1;
    },
  };
  return store;
}

export function supabaseAuditSink(db: AdminClient = supabaseAdmin()): AuditSink {
  return {
    async record(entry) {
      check(await db.from("tool_audit_log").insert(entry), "write audit log");
    },
  };
}
