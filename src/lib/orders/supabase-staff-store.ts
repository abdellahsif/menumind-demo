import "server-only";
import { supabaseAdmin, type AdminClient } from "@/lib/supabase/admin";
import type { StaffOrderStore } from "./confirm";
import { supabaseToolStore } from "./supabase-store";

/**
 * Supabase implementation of the staff-only store. This is the only code in the
 * app that can write status = 'confirmed', and it is only reachable from the
 * server actions behind the Confirm / Cancel buttons.
 */
export function supabaseStaffStore(db: AdminClient = supabaseAdmin()): StaffOrderStore {
  const reads = supabaseToolStore(db);

  async function conditionalStatus(orderId: string, status: "confirmed" | "cancelled"): Promise<boolean> {
    const { data, error } = await db
      .from("orders")
      .update({ status })
      .eq("id", orderId)
      .eq("status", "pending")
      .select("id");
    if (error) throw new Error(`set order ${status}: ${error.message}`);
    return (data ?? []).length === 1;
  }

  return {
    getOrder: (orderId) => reads.getOrder(orderId),
    listMenu: () => reads.listMenu(),

    async refreshPendingPrices(orderId, lines) {
      const order = await reads.getOrder(orderId);
      if (order?.status !== "pending") return false;
      // The order_items trigger rejects these updates if the order stops being pending meanwhile.
      for (const line of lines) {
        const { error } = await db
          .from("order_items")
          .update({ unit_price_snapshot: line.unit_price_snapshot })
          .eq("order_id", orderId)
          .eq("item_id", line.item_id);
        if (error) throw new Error(`refresh price: ${error.message}`);
      }
      return true;
    },

    confirmIfPending: (orderId) => conditionalStatus(orderId, "confirmed"),
    cancelIfPending: (orderId) => conditionalStatus(orderId, "cancelled"),
  };
}
