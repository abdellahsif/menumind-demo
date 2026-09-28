import { afterEach, describe, expect, it, vi } from "vitest";
import { cancelOrder, confirmOrder } from "@/lib/orders/confirm";
import { makeDeps } from "./support/memory-store";

afterEach(() => vi.restoreAllMocks());

const pizzaAndCola = [
  { item_id: "margherita-pizza", qty: 2, unit_price_snapshot: 12.5 },
  { item_id: "cola", qty: 1, unit_price_snapshot: 3.5 },
];

describe("confirmOrder (staff server action)", () => {
  it("confirms a pending order and audits it", async () => {
    const { store, audit, deps } = makeDeps();
    const order = store.seedOrder("pending", pizzaAndCola);

    const result = await confirmOrder({ orderId: order.id, expectedTotal: 28.5 }, deps);

    expect(result).toMatchObject({ ok: true, order: { status: "confirmed", total: 28.5 } });
    expect(store.orders.get(order.id)!.status).toBe("confirmed");
    expect(audit.entries).toEqual([
      expect.objectContaining({ tool_name: "action:confirm_order", order_id: order.id, output: expect.objectContaining({ ok: true }) }),
    ]);
  });

  it("a double click confirms exactly once", async () => {
    const { store, deps } = makeDeps();
    const order = store.seedOrder("pending", pizzaAndCola);

    const results = await Promise.all([
      confirmOrder({ orderId: order.id, expectedTotal: 28.5 }, deps),
      confirmOrder({ orderId: order.id, expectedTotal: 28.5 }, deps),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ error: "not_pending", order: { status: "confirmed" } });
    expect(store.statusWrites).toEqual([{ orderId: order.id, from: "pending", to: "confirmed" }]);
  });

  it("refuses a stale tab whose total no longer matches", async () => {
    const { store, deps } = makeDeps();
    const order = store.seedOrder("pending", pizzaAndCola);

    const result = await confirmOrder({ orderId: order.id, expectedTotal: 25 }, deps);

    expect(result).toMatchObject({ ok: false, error: "order_changed", order: { total: 28.5 } });
    expect(store.orders.get(order.id)!.status).toBe("pending");
  });

  it("refuses when an item became unavailable", async () => {
    const { store, deps } = makeDeps();
    const order = store.seedOrder("pending", pizzaAndCola);
    store.menu.get("cola")!.available = false;

    const result = await confirmOrder({ orderId: order.id, expectedTotal: 28.5 }, deps);

    expect(result).toMatchObject({ ok: false, error: "items_unavailable" });
    expect(result.ok || result.message).toMatch(/Cola/);
    expect(store.orders.get(order.id)!.status).toBe("pending");
  });

  it("refreshes changed prices and requires a second confirm at the new total", async () => {
    const { store, deps } = makeDeps();
    const order = store.seedOrder("pending", pizzaAndCola);
    store.menu.get("cola")!.price = 4;

    const first = await confirmOrder({ orderId: order.id, expectedTotal: 28.5 }, deps);
    expect(first).toMatchObject({ ok: false, error: "prices_changed", order: { total: 29 } });
    expect(first.ok || first.message).toMatch(/Cola 3\.50 → 4\.00/);
    expect(store.orders.get(order.id)!.status).toBe("pending");

    // Re-sending the old total is refused; the new total succeeds.
    expect(await confirmOrder({ orderId: order.id, expectedTotal: 28.5 }, deps)).toMatchObject({ error: "order_changed" });
    expect(await confirmOrder({ orderId: order.id, expectedTotal: 29 }, deps)).toMatchObject({ ok: true });
  });

  it.each(["confirmed", "preparing", "ready", "cancelled"] as const)("does not touch a %s order", async (status) => {
    const { store, deps } = makeDeps();
    const order = store.seedOrder(status);

    expect(await confirmOrder({ orderId: order.id, expectedTotal: 3.5 }, deps)).toMatchObject({
      ok: false,
      error: "not_pending",
    });
    expect(store.writes).toEqual([]);
  });

  it("rejects and audits a malformed request", async () => {
    const { audit, deps } = makeDeps();
    expect(await confirmOrder({ orderId: "not-a-uuid" }, deps)).toMatchObject({ error: "invalid_request" });
    expect(audit.entries[0]).toMatchObject({ tool_name: "action:confirm_order", order_id: null });
  });
});

describe("cancelOrder (staff server action)", () => {
  it("cancels a pending order", async () => {
    const { store, audit, deps } = makeDeps();
    const order = store.seedOrder("pending");
    expect(await cancelOrder({ orderId: order.id }, deps)).toMatchObject({ ok: true, order: { status: "cancelled" } });
    expect(audit.entries[0]).toMatchObject({ tool_name: "action:cancel_order" });
  });

  it("cannot cancel a confirmed order", async () => {
    const { store, deps } = makeDeps();
    const order = store.seedOrder("confirmed");
    expect(await cancelOrder({ orderId: order.id }, deps)).toMatchObject({ ok: false, error: "not_pending" });
    expect(store.orders.get(order.id)!.status).toBe("confirmed");
  });
});
