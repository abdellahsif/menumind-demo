import { describe, expect, it, vi } from "vitest";
import { executeTool } from "@/lib/tools/execute";
import { makeDeps } from "./support/memory-store";

type Anything = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function run(name: Parameters<typeof executeTool>[0], input: unknown, deps = makeDeps().deps) {
  return (await executeTool(name, input, deps)) as Anything;
}

describe("search_menu", () => {
  it("finds items by name, plural and ingredient, and never returns allergens", async () => {
    const byName = await run("search_menu", { query: "margherita pizzas" });
    expect(byName.results.map((r: Anything) => r.item_id)).toEqual(["margherita-pizza"]);
    expect(byName.results[0]).not.toHaveProperty("allergens");

    const byIngredient = await run("search_menu", { query: "peanut" });
    expect(byIngredient.results.map((r: Anything) => r.item_id)).toEqual(["chicken-pad-thai"]);
  });

  it("returns unavailable items flagged as unavailable", async () => {
    const result = await run("search_menu", { query: "quattro" });
    expect(result.results[0]).toMatchObject({ item_id: "quattro-formaggi-pizza", available: false });
  });

  it("returns an empty list for no match", async () => {
    expect((await run("search_menu", { query: "sushi" })).results).toEqual([]);
  });
});

describe("get_item_price", () => {
  it("returns the stored price", async () => {
    expect(await run("get_item_price", { item_id: "cola" })).toMatchObject({ ok: true, price: 3.5, available: true });
  });

  it("reports an unknown item", async () => {
    expect(await run("get_item_price", { item_id: "caviar" })).toMatchObject({ ok: false, error: "unknown_item" });
  });
});

describe("get_allergens", () => {
  it("returns exactly the stored record when it is complete", async () => {
    const result = await run("get_allergens", { item_id: "chicken-pad-thai" });
    expect(result.allergens).toEqual({
      status: "known",
      item_id: "chicken-pad-thai",
      contains: ["peanuts", "eggs", "fish"],
      may_contain: ["crustaceans", "sesame"],
      last_reviewed: "2026-09-01",
    });
  });

  it("returns an explicit unknown result for NULL allergens", async () => {
    const result = await run("get_allergens", { item_id: "soup-of-the-day" });
    expect(result.allergens).toMatchObject({ status: "unknown", reason: "no_allergen_data", stored: null });
    expect(result.allergens.instruction).toMatch(/check with the kitchen/);
  });

  it("returns an explicit unknown result for incomplete allergens, with the raw stored value", async () => {
    const result = await run("get_allergens", { item_id: "garlic-bread" });
    expect(result.allergens).toMatchObject({
      status: "unknown",
      reason: "incomplete_allergen_data",
      stored: { contains: ["gluten", "milk"] },
    });
  });

  it("treats an empty contains list as known (nothing declared), not unknown", async () => {
    const result = await run("get_allergens", { item_id: "cola" });
    expect(result.allergens).toMatchObject({ status: "known", contains: [], may_contain: [] });
  });
});

describe("create_pending_order", () => {
  it("creates a pending order, snapshots prices and totals it", async () => {
    const { store, deps } = makeDeps();
    const result = await run(
      "create_pending_order",
      { table: 4, items: [{ item_id: "margherita-pizza", qty: 2 }, { item_id: "cola", qty: 1 }] },
      deps,
    );
    expect(result.ok).toBe(true);
    expect(result.order).toMatchObject({ table: 4, status: "pending", subtotal: 28.5, total: 28.5 });
    expect(store.orders.get(result.order.order_id)!.lines).toContainEqual({
      item_id: "margherita-pizza",
      qty: 2,
      unit_price_snapshot: 12.5,
    });
  });

  it("merges duplicate lines", async () => {
    const result = await run("create_pending_order", {
      table: 1,
      items: [{ item_id: "cola", qty: 1 }, { item_id: "cola", qty: 2 }],
    });
    expect(result.order.lines).toEqual([expect.objectContaining({ item_id: "cola", qty: 3 })]);
  });

  it("refuses unavailable items and creates nothing", async () => {
    const { store, deps } = makeDeps();
    const result = await run("create_pending_order", { table: 1, items: [{ item_id: "quattro-formaggi-pizza", qty: 1 }] }, deps);
    expect(result).toMatchObject({ ok: false, error: "item_unavailable" });
    expect(store.orders.size).toBe(0);
  });

  it("leaves no order behind if an item becomes unavailable between the check and the insert", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { store, deps } = makeDeps();
    const staleMenu = await store.listMenu(); // the tool's check still sees cola as available
    store.listMenu = async () => staleMenu;
    store.menu.get("cola")!.available = false; // ...but the atomic create sees the truth

    const result = await run("create_pending_order", { table: 1, items: [{ item_id: "cola", qty: 1 }] }, deps);
    expect(result).toMatchObject({ ok: false, error: "internal_error" });
    expect(store.orders.size).toBe(0);
    vi.restoreAllMocks();
  });

  it("refuses unknown items", async () => {
    const result = await run("create_pending_order", { table: 1, items: [{ item_id: "caviar", qty: 1 }] });
    expect(result).toMatchObject({ ok: false, error: "unknown_item" });
  });

  it.each([
    ["table 0", { table: 0, items: [{ item_id: "cola", qty: 1 }] }],
    ["qty 0", { table: 1, items: [{ item_id: "cola", qty: 0 }] }],
    ["fractional qty", { table: 1, items: [{ item_id: "cola", qty: 1.5 }] }],
    ["no items", { table: 1, items: [] }],
    ["item name instead of id", { table: 1, items: [{ item_id: "Margherita Pizza", qty: 1 }] }],
  ])("rejects invalid input: %s", async (_, input) => {
    expect(await run("create_pending_order", input)).toMatchObject({ ok: false, error: "invalid_input" });
  });
});

describe("edit_pending_order", () => {
  it("sets absolute quantities, adds and removes lines", async () => {
    const { store, deps } = makeDeps();
    const order = store.seedOrder("pending", [
      { item_id: "cola", qty: 1, unit_price_snapshot: 3.5 },
      { item_id: "margherita-pizza", qty: 1, unit_price_snapshot: 12.5 },
    ]);
    const result = await run(
      "edit_pending_order",
      {
        order_id: order.id,
        changes: {
          items: [
            { item_id: "cola", qty: 3 },
            { item_id: "margherita-pizza", qty: 0 },
            { item_id: "fresh-lemonade", qty: 1 },
          ],
        },
      },
      deps,
    );
    expect(result.ok).toBe(true);
    expect(result.order.lines.map((l: Anything) => [l.item_id, l.qty]).sort()).toEqual([
      ["cola", 3],
      ["fresh-lemonade", 1],
    ]);
  });

  it("keeps the original price snapshot on existing lines", async () => {
    const { store, deps } = makeDeps();
    const order = store.seedOrder("pending", [{ item_id: "cola", qty: 1, unit_price_snapshot: 3.0 }]);
    await run("edit_pending_order", { order_id: order.id, changes: { items: [{ item_id: "cola", qty: 2 }] } }, deps);
    expect(store.orders.get(order.id)!.lines[0]!.unit_price_snapshot).toBe(3.0);
  });

  it("moves the order to another table", async () => {
    const { store, deps } = makeDeps();
    const order = store.seedOrder("pending");
    const result = await run("edit_pending_order", { order_id: order.id, changes: { table: 12 } }, deps);
    expect(result.order.table).toBe(12);
  });

  it("refuses to empty the order and points to cancel", async () => {
    const { store, deps } = makeDeps();
    const order = store.seedOrder("pending");
    const result = await run("edit_pending_order", { order_id: order.id, changes: { items: [{ item_id: "cola", qty: 0 }] } }, deps);
    expect(result).toMatchObject({ ok: false, error: "empty_order" });
    expect(result.message).toMatch(/cancel_pending_order/);
  });

  it("refuses to add an unavailable item", async () => {
    const { store, deps } = makeDeps();
    const order = store.seedOrder("pending");
    const result = await run(
      "edit_pending_order",
      { order_id: order.id, changes: { items: [{ item_id: "quattro-formaggi-pizza", qty: 1 }] } },
      deps,
    );
    expect(result).toMatchObject({ ok: false, error: "item_unavailable" });
  });

  it("requires at least one change", async () => {
    const { store, deps } = makeDeps();
    const order = store.seedOrder("pending");
    expect(await run("edit_pending_order", { order_id: order.id, changes: {} }, deps)).toMatchObject({
      error: "invalid_input",
    });
  });
});

describe("apply_discount", () => {
  it("applies up to 20% and recomputes the total in cents", async () => {
    const { store, deps } = makeDeps();
    const order = store.seedOrder("pending", [{ item_id: "cola", qty: 3, unit_price_snapshot: 3.35 }]);
    const result = await run("apply_discount", { order_id: order.id, percent: 15 }, deps);
    // 3 x 3.35 = 10.05; 15% = 1.5075 -> 1.51; total 8.54
    expect(result.order).toMatchObject({ subtotal: 10.05, discount_amount: 1.51, total: 8.54, discount_percent: 15 });
  });

  it.each([21, 50, 100, -5, 12.5])("rejects %s%%", async (percent) => {
    const { store, deps } = makeDeps();
    const order = store.seedOrder("pending");
    expect(await run("apply_discount", { order_id: order.id, percent }, deps)).toMatchObject({ error: "invalid_input" });
    expect(store.orders.get(order.id)!.discount_percent).toBe(0);
  });

  it("accepts exactly 20%", async () => {
    const { store, deps } = makeDeps();
    const order = store.seedOrder("pending");
    expect(await run("apply_discount", { order_id: order.id, percent: 20 }, deps)).toMatchObject({ ok: true });
  });
});

describe("cancel_pending_order", () => {
  it("cancels a pending order", async () => {
    const { store, deps } = makeDeps();
    const order = store.seedOrder("pending");
    expect(await run("cancel_pending_order", { order_id: order.id }, deps)).toEqual({
      ok: true,
      order_id: order.id,
      status: "cancelled",
    });
  });

  it("reports an unknown order", async () => {
    expect(await run("cancel_pending_order", { order_id: crypto.randomUUID() })).toMatchObject({
      error: "order_not_found",
    });
  });
});
