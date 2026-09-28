import type { Json, OrderStatus } from "@/lib/supabase/database.types";

export type MenuItem = {
  id: string;
  name: string;
  price: number;
  description: string;
  available: boolean;
  allergens: Json | null;
  ingredients: string[];
};

export type OrderLine = {
  item_id: string;
  qty: number;
  unit_price_snapshot: number;
};

export type OrderItemRequest = { item_id: string; qty: number };

export type Order = {
  id: string;
  table_number: number;
  status: OrderStatus;
  discount_percent: number;
  created_at: string;
  lines: OrderLine[];
};

/**
 * Everything the assistant's tools are allowed to do to the database.
 *
 * This interface is the code-level guarantee behind "the LLM cannot confirm":
 * there is no method that sets an arbitrary status. The only status change on
 * offer is pending -> cancelled, and every write method must only affect an
 * order that is still pending (returning false otherwise). Confirmation lives in
 * a separate server action that tools never receive.
 */
export interface ToolStore {
  listMenu(): Promise<MenuItem[]>;
  getMenuItem(itemId: string): Promise<MenuItem | null>;
  getOrder(orderId: string): Promise<Order | null>;

  /**
   * Creates a pending order and its lines atomically. Prices are snapshotted from
   * the menu at creation time; unknown or unavailable items abort the whole call.
   */
  createPendingOrder(tableNumber: number, items: OrderItemRequest[]): Promise<Order>;

  /** Updates table number and/or discount. Returns false if the order is not pending. */
  updatePendingOrder(
    orderId: string,
    patch: { table_number?: number; discount_percent?: number },
  ): Promise<boolean>;

  /** Replaces the full set of lines. Returns false if the order is not pending. */
  replacePendingLines(orderId: string, lines: OrderLine[]): Promise<boolean>;

  /** pending -> cancelled. Returns false if the order is not pending. */
  cancelPendingOrder(orderId: string): Promise<boolean>;
}

export type AuditEntry = {
  tool_name: string;
  order_id: string | null;
  input: Json;
  output: Json;
};

export interface AuditSink {
  record(entry: AuditEntry): Promise<void>;
}
