"use client";

import { useState, useTransition } from "react";
import { cancelOrderAction, confirmOrderAction } from "@/app/actions/orders";
import type { StaffActionResult } from "@/lib/orders/confirm";
import type { OrderSummary } from "@/lib/orders/pricing";

const money = (n: number) => n.toFixed(2);

const STATUS_STYLE: Record<OrderSummary["status"], { label: string; className: string }> = {
  pending: { label: "Pending: not sent", className: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200" },
  confirmed: { label: "Confirmed: sent to kitchen", className: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200" },
  preparing: { label: "Preparing", className: "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200" },
  ready: { label: "Ready", className: "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200" },
  cancelled: { label: "Cancelled", className: "bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300" },
};

type Props = {
  order: OrderSummary;
  /** Called with the server's view of the order after a staff action. */
  onUpdated: (order: OrderSummary) => void;
  onEdit: (order: OrderSummary) => void;
};

export function OrderCard({ order, onUpdated, onEdit }: Props) {
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const status = STATUS_STYLE[order.status];

  function run(action: () => Promise<StaffActionResult>) {
    setNotice(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (result.order) onUpdated(result.order);
        if (!result.ok) setNotice(result.message);
      } catch {
        setNotice("Could not reach the server. The order was not changed.");
      }
      setConfirmingCancel(false);
    });
  }

  return (
    <article
      aria-label={`Order for table ${order.table}`}
      data-status={order.status}
      className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900"
    >
      <header className="flex items-start justify-between gap-3">
        <h3 className="font-semibold">Table {order.table}</h3>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}>{status.label}</span>
      </header>

      <ul className="mt-3 space-y-1 text-sm">
        {order.lines.map((line) => (
          <li key={line.item_id} className="flex justify-between gap-3">
            <span>
              {line.qty} × {line.name}
            </span>
            <span className="tabular-nums text-stone-600 dark:text-stone-400">{money(line.line_total)}</span>
          </li>
        ))}
      </ul>

      <dl className="mt-3 space-y-0.5 border-t border-stone-200 pt-2 text-sm dark:border-stone-800">
        {order.discount_percent > 0 && (
          <>
            <div className="flex justify-between text-stone-600 dark:text-stone-400">
              <dt>Subtotal</dt>
              <dd className="tabular-nums">{money(order.subtotal)}</dd>
            </div>
            <div className="flex justify-between text-stone-600 dark:text-stone-400">
              <dt>Discount {order.discount_percent}%</dt>
              <dd className="tabular-nums">−{money(order.discount_amount)}</dd>
            </div>
          </>
        )}
        <div className="flex justify-between font-semibold">
          <dt>Total</dt>
          <dd className="tabular-nums">{money(order.total)}</dd>
        </div>
      </dl>

      {notice && (
        <p role="alert" className="mt-3 rounded-md bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {notice}
        </p>
      )}

      {order.status === "pending" && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => confirmOrderAction(order.order_id, order.total))}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {isPending ? "Working…" : "Confirm"}
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => onEdit(order)}
            className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium hover:bg-stone-100 disabled:opacity-50 dark:border-stone-700 dark:hover:bg-stone-800"
          >
            Edit
          </button>
          {confirmingCancel ? (
            <button
              type="button"
              disabled={isPending}
              onClick={() => run(() => cancelOrderAction(order.order_id))}
              className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
            >
              Yes, cancel order
            </button>
          ) : (
            <button
              type="button"
              disabled={isPending}
              onClick={() => setConfirmingCancel(true)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950"
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </article>
  );
}
