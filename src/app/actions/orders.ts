"use server";

import { cancelOrder, confirmOrder, type StaffActionResult } from "@/lib/orders/confirm";
import { supabaseAuditSink } from "@/lib/orders/supabase-store";
import { supabaseStaffStore } from "@/lib/orders/supabase-staff-store";

/*
 * Server actions behind the order card's buttons. These are the only way an
 * order becomes confirmed. They are not tools: the chat route never imports
 * this file, so the model cannot call them.
 */

const deps = () => ({ store: supabaseStaffStore(), audit: supabaseAuditSink() });

export async function confirmOrderAction(orderId: string, expectedTotal: number): Promise<StaffActionResult> {
  return confirmOrder({ orderId, expectedTotal }, deps());
}

export async function cancelOrderAction(orderId: string): Promise<StaffActionResult> {
  return cancelOrder({ orderId }, deps());
}
