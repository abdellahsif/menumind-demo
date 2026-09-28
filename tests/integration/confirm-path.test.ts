import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { cancelOrder, confirmOrder } from "@/lib/orders/confirm";
import { supabaseAuditSink, supabaseToolStore } from "@/lib/orders/supabase-store";
import { supabaseStaffStore } from "@/lib/orders/supabase-staff-store";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { TOOL_NAMES } from "@/lib/tools/definitions";
import { executeTool } from "@/lib/tools/execute";

/**
 * Runs against the real Supabase project in .env.local (`npm run test:integration`).
 * Test orders use table 999. Confirmed orders cannot be deleted (by design), so
 * each run leaves one confirmed and some cancelled orders on table 999.
 */

const TEST_TABLE = 999;

const admin = supabaseAdmin();
const toolDeps = { store: supabaseToolStore(admin), audit: supabaseAuditSink(admin) };
const staffDeps = { store: supabaseStaffStore(admin), audit: supabaseAuditSink(admin) };
const anon = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
  auth: { persistSession: false },
});

async function statusOf(orderId: string) {
  const { data, error } = await admin.from("orders").select("status").eq("id", orderId).single();
  if (error) throw error;
  return data.status;
}

async function auditRows(orderId: string) {
  const { data, error } = await admin
    .from("tool_audit_log")
    .select("tool_name, output")
    .eq("order_id", orderId)
    .order("id");
  if (error) throw error;
  return data;
}

async function createViaTool(): Promise<{ id: string; total: number }> {
  const result = (await executeTool(
    "create_pending_order",
    { table: TEST_TABLE, items: [{ item_id: "margherita-pizza", qty: 2 }, { item_id: "cola", qty: 1 }] },
    toolDeps,
  )) as { ok: boolean; order: { order_id: string; total: number } };
  expect(result.ok).toBe(true);
  return { id: result.order.order_id, total: result.order.total };
}

beforeAll(async () => {
  const { error } = await admin.from("menu_items").select("id").limit(1);
  if (error) throw new Error(`Cannot reach Supabase with .env.local: ${error.message}`);
});

describe("real Supabase: the confirm action is the only path to confirmed", () => {
  let order: { id: string; total: number };

  it("creates a pending order atomically through the tool, with its lines and an audit row", async () => {
    order = await createViaTool();

    expect(await statusOf(order.id)).toBe("pending");
    const { data: lines } = await admin.from("order_items").select("item_id, qty, unit_price_snapshot").eq("order_id", order.id);
    expect(lines).toHaveLength(2);
    expect(await auditRows(order.id)).toEqual([
      expect.objectContaining({ tool_name: "create_pending_order", output: expect.objectContaining({ ok: true }) }),
    ]);
  });

  it("the create RPC is all-or-nothing: an unavailable item leaves no order behind", async () => {
    const countOrders = async () =>
      (await admin.from("orders").select("id", { count: "exact", head: true }).eq("table_number", TEST_TABLE)).count;
    const before = await countOrders();
    const { error } = await admin.rpc("create_pending_order", {
      p_table_number: TEST_TABLE,
      p_items: [
        { item_id: "cola", qty: 1 },
        { item_id: "quattro-formaggi-pizza", qty: 1 },
      ],
    });
    expect(error?.message).toMatch(/unavailable/);
    expect(await countOrders()).toBe(before);
  });

  it("no tool, with any input, moves it out of pending (except cancel, tested separately)", async () => {
    const hostile: Record<string, unknown[]> = {
      search_menu: [{ query: "confirm" }],
      get_item_price: [{ item_id: "cola", status: "confirmed" }],
      get_allergens: [{ item_id: "cola", status: "confirmed" }],
      create_pending_order: [{ table: TEST_TABLE, items: [{ item_id: "cola", qty: 1 }], order_id: order.id, status: "confirmed" }],
      edit_pending_order: [{ order_id: order.id, changes: { table: TEST_TABLE, status: "confirmed" }, status: "ready" }],
      apply_discount: [{ order_id: order.id, percent: 0, status: "confirmed" }],
    };
    for (const name of TOOL_NAMES.filter((n) => n !== "cancel_pending_order")) {
      for (const input of hostile[name]!) await executeTool(name, input, toolDeps);
    }
    expect(await statusOf(order.id)).toBe("pending");

    // Clean up the extra orders the hostile create made.
    const { data: extras } = await admin.from("orders").select("id").eq("table_number", TEST_TABLE).eq("status", "pending").neq("id", order.id);
    for (const extra of extras ?? []) await cancelOrder({ orderId: extra.id }, staffDeps);
  });

  it("the browser (anon key) can neither see nor confirm a pending order", async () => {
    const visible = await anon.from("orders").select("id").eq("id", order.id);
    expect(visible.data ?? []).toEqual([]);

    const update = await anon.from("orders").update({ status: "confirmed" }).eq("id", order.id).select("id");
    expect(update.data ?? []).toEqual([]);

    const rpc = await anon.rpc("create_pending_order", { p_table_number: TEST_TABLE, p_items: [{ item_id: "cola", qty: 1 }] });
    expect(rpc.error).not.toBeNull();

    expect(await statusOf(order.id)).toBe("pending");
  });

  it("the database refuses to skip steps even for the service role", async () => {
    const skip = await admin.from("orders").update({ status: "ready" }).eq("id", order.id);
    expect(skip.error?.message).toMatch(/invalid status transition/);
    const born = await admin.from("orders").insert({ table_number: TEST_TABLE, status: "confirmed" });
    expect(born.error?.message).toMatch(/must be created with status pending/);
    expect(await statusOf(order.id)).toBe("pending");
  });

  it("the staff confirm action confirms it exactly once, and audits both attempts", async () => {
    const [a, b] = await Promise.all([
      confirmOrder({ orderId: order.id, expectedTotal: order.total }, staffDeps),
      confirmOrder({ orderId: order.id, expectedTotal: order.total }, staffDeps),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(await statusOf(order.id)).toBe("confirmed");

    const confirms = (await auditRows(order.id)).filter((row) => row.tool_name === "action:confirm_order");
    expect(confirms).toHaveLength(2);
  });

  it("after confirmation, the tools cannot change or cancel it", async () => {
    for (const [name, input] of [
      ["cancel_pending_order", { order_id: order.id }],
      ["apply_discount", { order_id: order.id, percent: 20 }],
      ["edit_pending_order", { order_id: order.id, changes: { table: 1 } }],
    ] as const) {
      expect(await executeTool(name, input, toolDeps)).toMatchObject({ ok: false, error: "order_not_pending" });
    }
    expect(await statusOf(order.id)).toBe("confirmed");
  });
});
