import { describe, expect, it, vi } from "vitest";
import { supabaseToolStore } from "@/lib/orders/supabase-store";
import type { AdminClient } from "@/lib/supabase/admin";

/** Minimal fake of the supabase-js surface the store uses, recording every call. */
function fakeDb(rpcResult: { data: unknown; error: { message: string } | null }) {
  const calls: string[] = [];
  const orderRow = {
    id: "11111111-1111-4111-8111-111111111111",
    table_number: 4,
    status: "pending",
    discount_percent: 0,
    created_at: "2026-09-28T00:00:00Z",
    order_items: [{ item_id: "cola", qty: 2, unit_price_snapshot: "3.50" }],
  };
  const query = (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "not", "insert", "update", "delete", "upsert"]) {
      chain[method] = (...args: unknown[]) => {
        calls.push(`${table}.${method}`);
        void args;
        return chain;
      };
    }
    chain.maybeSingle = async () => ({ data: orderRow, error: null });
    return chain;
  };
  const db = {
    rpc: vi.fn(async (fn: string) => {
      calls.push(`rpc:${fn}`);
      return rpcResult;
    }),
    from: (table: string) => query(table),
  };
  return { db: db as unknown as AdminClient, calls, rpc: db.rpc };
}

describe("supabaseToolStore.createPendingOrder", () => {
  it("creates the order and lines with a single RPC call, never with separate inserts", async () => {
    const { db, calls, rpc } = fakeDb({ data: "11111111-1111-4111-8111-111111111111", error: null });
    const order = await supabaseToolStore(db).createPendingOrder(4, [{ item_id: "cola", qty: 2 }]);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("create_pending_order", {
      p_table_number: 4,
      p_items: [{ item_id: "cola", qty: 2 }],
    });
    expect(calls.filter((c) => /\.(insert|delete|upsert|update)$/.test(c))).toEqual([]);
    expect(order).toMatchObject({ status: "pending", lines: [{ item_id: "cola", qty: 2, unit_price_snapshot: 3.5 }] });
  });

  it("surfaces a failed RPC as an error and does no clean-up writes (the transaction rolled back)", async () => {
    const { db, calls } = fakeDb({ data: null, error: { message: "unknown or unavailable menu items: cola" } });
    await expect(supabaseToolStore(db).createPendingOrder(4, [{ item_id: "cola", qty: 2 }])).rejects.toThrow(
      /unavailable menu items/,
    );
    expect(calls).toEqual(["rpc:create_pending_order"]);
  });
});
