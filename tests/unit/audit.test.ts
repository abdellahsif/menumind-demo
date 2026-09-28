import { afterEach, describe, expect, it, vi } from "vitest";
import { executeTool } from "@/lib/tools/execute";
import { createAssistantTools } from "@/lib/tools/registry";
import { makeDeps } from "./support/memory-store";

afterEach(() => vi.restoreAllMocks());

describe("tool audit log", () => {
  it("records a successful call with input, output and order id", async () => {
    const { audit, deps } = makeDeps();
    const input = { table: 4, items: [{ item_id: "cola", qty: 2 }] };
    const output = await executeTool("create_pending_order", input, deps);

    expect(audit.entries).toHaveLength(1);
    const [entry] = audit.entries;
    expect(entry).toMatchObject({ tool_name: "create_pending_order", input, output });
    expect(entry!.order_id).toBe((output as unknown as { order: { order_id: string } }).order.order_id);
  });

  it("records read-only calls without an order id", async () => {
    const { audit, deps } = makeDeps();
    await executeTool("get_allergens", { item_id: "soup-of-the-day" }, deps);
    expect(audit.entries[0]).toMatchObject({ tool_name: "get_allergens", order_id: null });
  });

  it("records calls rejected by validation", async () => {
    const { store, audit, deps } = makeDeps();
    const order = store.seedOrder("pending");
    await executeTool("apply_discount", { order_id: order.id, percent: 50 }, deps);
    expect(audit.entries[0]).toMatchObject({
      tool_name: "apply_discount",
      order_id: order.id,
      input: { order_id: order.id, percent: 50 },
      output: { ok: false, error: "invalid_input" },
    });
  });

  it("records calls refused by business rules", async () => {
    const { store, audit, deps } = makeDeps();
    const order = store.seedOrder("confirmed");
    await executeTool("cancel_pending_order", { order_id: order.id }, deps);
    expect(audit.entries[0]).toMatchObject({ output: { ok: false, error: "order_not_pending" } });
  });

  it("records calls that crashed, without leaking the error to the model", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { store, audit, deps } = makeDeps();
    store.listMenu = async () => {
      throw new Error("connection reset");
    };
    const output = await executeTool("search_menu", { query: "pizza" }, deps);
    expect(output).toMatchObject({ ok: false, error: "internal_error" });
    expect(JSON.stringify(output)).not.toContain("connection reset");
    expect(audit.entries).toHaveLength(1);
  });

  it("does not throw (and so does not trigger a model retry) if the audit write fails", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { audit, deps } = makeDeps();
    audit.failNext = true;
    const output = await executeTool("get_item_price", { item_id: "cola" }, deps);
    expect(output.ok).toBe(true);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("[audit] FAILED"), expect.any(Error));
  });

  it("audits invalid input that arrives through the AI SDK instead of letting the SDK drop it", async () => {
    const { store, audit, deps } = makeDeps();
    const order = store.seedOrder("pending");
    const tools = createAssistantTools(deps);
    const output = await tools.apply_discount!.execute!(
      { order_id: order.id, percent: 90 },
      { toolCallId: "t1", messages: [] } as never,
    );
    expect(output).toMatchObject({ ok: false, error: "invalid_input" });
    expect(audit.entries).toHaveLength(1);
  });

  it("still advertises the real constraints to the model as JSON Schema", async () => {
    const tools = createAssistantTools(makeDeps().deps);
    const schema = await (tools.apply_discount!.inputSchema as { jsonSchema: unknown }).jsonSchema;
    expect(schema).toMatchObject({
      properties: { percent: { type: "integer", minimum: 0, maximum: 20 } },
      required: ["order_id", "percent"],
    });
  });
});
