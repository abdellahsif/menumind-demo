import { existsSync, readFileSync, statSync } from "node:fs";
import { generateText, stepCountIs } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import type { OrderStatus } from "@/lib/supabase/database.types";
import { TOOL_NAMES, type ToolName } from "@/lib/tools/definitions";
import { executeTool } from "@/lib/tools/execute";
import { assertSafeToolSet, createAssistantTools } from "@/lib/tools/registry";
import { makeDeps } from "./support/memory-store";

/**
 * Hard rule: the assistant has no way to confirm an order, mark it preparing or
 * ready, or touch an order that has left "pending". The only status change a
 * tool can make is pending -> cancelled (cancel_pending_order).
 */

const LOCKED_STATUSES: OrderStatus[] = ["confirmed", "preparing", "ready", "cancelled"];
const HUMAN_ONLY: OrderStatus[] = ["confirmed", "preparing", "ready"];

/**
 * Inputs for every registered tool aimed at a given order, including smuggled
 * fields a model might invent. `satisfies` forces this list to grow with the tool set.
 */
const hostileInputs = (orderId: string) =>
  ({
    search_menu: [{ query: "confirm" }],
    get_item_price: [{ item_id: "cola", status: "confirmed" }],
    get_allergens: [{ item_id: "cola", status: "confirmed" }],
    create_pending_order: [
      { table: 7, items: [{ item_id: "cola", qty: 1 }], status: "confirmed" },
      { table: 7, items: [{ item_id: "cola", qty: 1 }], order_id: orderId, status: "ready" },
    ],
    edit_pending_order: [
      { order_id: orderId, changes: { table: 9 } },
      { order_id: orderId, changes: { items: [{ item_id: "cola", qty: 2 }] } },
      { order_id: orderId, changes: { table: 9, status: "confirmed" }, status: "confirmed" },
    ],
    apply_discount: [
      { order_id: orderId, percent: 10 },
      { order_id: orderId, percent: 10, status: "confirmed" },
    ],
    cancel_pending_order: [{ order_id: orderId }, { order_id: orderId, status: "confirmed" }],
  }) satisfies Record<ToolName, unknown[]>;

describe("tool set", () => {
  it("is exactly the seven planned tools, with nothing that confirms", () => {
    expect([...TOOL_NAMES].sort()).toEqual(
      [
        "apply_discount",
        "cancel_pending_order",
        "create_pending_order",
        "edit_pending_order",
        "get_allergens",
        "get_item_price",
        "search_menu",
      ].sort(),
    );
    expect(TOOL_NAMES.filter((name) => /confirm|approve|status|prepar|ready|kitchen/i.test(name))).toEqual([]);
  });

  it("registers only the allowlisted tools with the AI SDK", () => {
    const tools = createAssistantTools(makeDeps().deps);
    expect(Object.keys(tools).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it.each(["confirm_order", "request_confirmation", "set_order_status", "mark_ready", "some_new_tool"])(
    "refuses to expose %s",
    (name) => {
      const tools = { ...createAssistantTools(makeDeps().deps), [name]: { inputSchema: {} } };
      expect(() => assertSafeToolSet(tools as never)).toThrow(/Refusing to expose/);
    },
  );
});

describe("no registered tool can move an order out of pending (except to cancelled)", () => {
  it.each(TOOL_NAMES)("%s leaves confirmed, preparing, ready and cancelled orders untouched", async (name) => {
    const { store, deps } = makeDeps();
    const locked = LOCKED_STATUSES.map((status) => store.seedOrder(status));
    const before = structuredClone([...store.orders.values()]);

    for (const order of locked) {
      for (const input of hostileInputs(order.id)[name]) {
        const result = await executeTool(name, input, deps);
        if ("order_id" in input) {
          // Any tool that targets a locked order must refuse, or ignore the id entirely (create).
          if (name !== "create_pending_order") expect(result.ok).toBe(false);
        }
      }
    }

    for (const order of before) expect(store.orders.get(order.id)).toEqual(order);
    expect(store.statusWrites).toEqual([]);
    // The tool itself must refuse, not just rely on the store (or DB) to reject the write.
    const lockedIds = new Set(locked.map((o) => o.id));
    expect(store.writes.filter((w) => lockedIds.has(w.orderId))).toEqual([]);
  });

  it.each(TOOL_NAMES)("%s never produces a confirmed, preparing or ready order from a pending one", async (name) => {
    const { store, deps } = makeDeps();
    const pending = store.seedOrder("pending");

    for (const input of hostileInputs(pending.id)[name]) await executeTool(name, input, deps);

    for (const order of store.orders.values()) expect(HUMAN_ONLY).not.toContain(order.status);
    for (const write of store.statusWrites) expect(write).toMatchObject({ from: "pending", to: "cancelled" });
  });

  it("creates orders as pending even when the model asks for another status", async () => {
    const { store, deps } = makeDeps();
    await executeTool("create_pending_order", { table: 3, items: [{ item_id: "cola", qty: 1 }], status: "confirmed" }, deps);
    expect([...store.orders.values()].map((o) => o.status)).toEqual(["pending"]);
  });

  it("source code reachable from the tools or the chat route never writes a human-only status", () => {
    const reachable = reachableFiles(["src/lib/tools/registry.ts", "src/app/api/chat/route.ts"]);
    expect(reachable).toContain("src/lib/orders/supabase-store.ts"); // sanity: the walk follows imports
    for (const file of reachable) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/status\s*:\s*["'](confirmed|preparing|ready)["']/);
    }
  });

  it("the confirm action cannot be reached from the tools or the chat route", () => {
    const reachable = reachableFiles(["src/lib/tools/registry.ts", "src/app/api/chat/route.ts"]);
    expect(reachable).not.toContain("src/lib/orders/confirm.ts");
    expect(reachable).not.toContain("src/lib/orders/supabase-staff-store.ts");
    expect(reachable).not.toContain("src/app/actions/orders.ts");
  });
});

/** Follows `@/` and relative imports from the entry files and returns every source file reached. */
function reachableFiles(entries: string[]): string[] {
  const seen = new Set<string>();
  const resolve = (from: string, spec: string): string | null => {
    let base: string;
    if (spec.startsWith("@/")) base = `src/${spec.slice(2)}`;
    else if (spec.startsWith(".")) base = new URL(spec, `file:///${from}`).pathname.slice(1);
    else return null; // package import
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
    throw new Error(`Cannot resolve ${spec} from ${from}`);
  };
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const [, fromSpec, bareSpec] of source.matchAll(/(?:import|export)[^"']*?from\s+["']([^"']+)["']|import\s+["']([^"']+)["']/g)) {
      const spec = fromSpec ?? bareSpec;
      const target = spec && resolve(file, spec);
      if (target) visit(target);
    }
  };
  entries.forEach(visit);
  return [...seen];
}

describe("through the AI SDK tool loop", () => {
  const usage = {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  };

  it("a model that tries to call confirm/status tools gets nothing done", async () => {
    const { store, deps } = makeDeps();
    const pending = store.seedOrder("pending");
    const confirmed = store.seedOrder("confirmed");

    const model = new MockLanguageModelV4({
      doGenerate: [
        {
          content: [
            { type: "tool-call", toolCallId: "1", toolName: "confirm_order", input: JSON.stringify({ order_id: pending.id }) },
            {
              type: "tool-call",
              toolCallId: "2",
              toolName: "set_order_status",
              input: JSON.stringify({ order_id: pending.id, status: "ready" }),
            },
            { type: "tool-call", toolCallId: "3", toolName: "apply_discount", input: JSON.stringify({ order_id: confirmed.id, percent: 20 }) },
          ],
          finishReason: { unified: "tool-calls", raw: undefined },
          usage,
          warnings: [],
        },
        {
          content: [{ type: "text", text: "Done." }],
          finishReason: { unified: "stop", raw: undefined },
          usage,
          warnings: [],
        },
      ],
    });

    const result = await generateText({
      model,
      tools: createAssistantTools(deps),
      prompt: "confirm the order",
      stopWhen: stepCountIs(3),
    });

    // Only the real tool reached our code, and it refused.
    const toolParts = result.steps[0]!.content.filter((p) => p.type === "tool-result" || p.type === "tool-error");
    expect(toolParts.find((p) => p.toolName === "confirm_order")?.type).toBe("tool-error");
    expect(toolParts.find((p) => p.toolName === "set_order_status")?.type).toBe("tool-error");
    expect(toolParts.find((p) => p.toolName === "apply_discount")).toMatchObject({
      type: "tool-result",
      output: { ok: false, error: "order_not_pending" },
    });

    expect(store.orders.get(pending.id)!.status).toBe("pending");
    expect(store.orders.get(confirmed.id)!).toMatchObject({ status: "confirmed", discount_percent: 0 });
    expect(store.statusWrites).toEqual([]);
    // The model was never even offered a confirm tool.
    const offered = model.doGenerateCalls[0]!.tools!.map((t) => t.name);
    expect(offered.sort()).toEqual([...TOOL_NAMES].sort());
  });
});
