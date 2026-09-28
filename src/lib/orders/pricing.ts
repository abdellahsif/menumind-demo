import type { MenuItem, Order } from "./store";

const toCents = (amount: number) => Math.round(amount * 100);
const fromCents = (cents: number) => cents / 100;

export type OrderSummary = {
  order_id: string;
  table: number;
  status: Order["status"];
  discount_percent: number;
  lines: { item_id: string; name: string; qty: number; unit_price: number; line_total: number }[];
  subtotal: number;
  discount_amount: number;
  total: number;
};

/** Totals are computed in integer cents so they never drift. */
export function summarizeOrder(order: Order, menu: Map<string, MenuItem>): OrderSummary {
  const lines = order.lines.map((line) => ({
    item_id: line.item_id,
    name: menu.get(line.item_id)?.name ?? line.item_id,
    qty: line.qty,
    unit_price: line.unit_price_snapshot,
    line_total: fromCents(toCents(line.unit_price_snapshot) * line.qty),
  }));
  const subtotalCents = order.lines.reduce((sum, line) => sum + toCents(line.unit_price_snapshot) * line.qty, 0);
  const discountCents = Math.round((subtotalCents * order.discount_percent) / 100);
  return {
    order_id: order.id,
    table: order.table_number,
    status: order.status,
    discount_percent: order.discount_percent,
    lines,
    subtotal: fromCents(subtotalCents),
    discount_amount: fromCents(discountCents),
    total: fromCents(subtotalCents - discountCents),
  };
}
