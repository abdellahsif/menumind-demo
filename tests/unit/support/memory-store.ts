import { randomUUID } from "node:crypto";
import type { AuditEntry, AuditSink, MenuItem, Order, OrderLine, ToolStore } from "@/lib/orders/store";
import type { OrderStatus } from "@/lib/supabase/database.types";

/** Mirrors the special rows in supabase/seed.sql plus a few normal ones. */
export const MENU: MenuItem[] = [
  {
    id: "margherita-pizza",
    name: "Margherita Pizza",
    price: 12.5,
    description: "San Marzano tomato, fior di latte mozzarella and fresh basil on a wood-fired base.",
    available: true,
    allergens: { contains: ["gluten", "milk"], may_contain: [], last_reviewed: "2026-09-01" },
    ingredients: ["wheat flour dough", "San Marzano tomato", "fior di latte mozzarella", "basil"],
  },
  {
    id: "quattro-formaggi-pizza",
    name: "Quattro Formaggi Pizza",
    price: 15.5,
    description: "Mozzarella, gorgonzola, parmigiano and fontina. White base.",
    available: false,
    allergens: { contains: ["gluten", "milk"], may_contain: [], last_reviewed: "2026-09-01" },
    ingredients: ["wheat flour dough", "mozzarella", "gorgonzola"],
  },
  {
    id: "chicken-pad-thai",
    name: "Chicken Pad Thai",
    price: 13.5,
    description: "Rice noodles wok-fried with chicken, egg, tamarind and roasted peanuts.",
    available: true,
    allergens: { contains: ["peanuts", "eggs", "fish"], may_contain: ["crustaceans", "sesame"], last_reviewed: "2026-09-01" },
    ingredients: ["rice noodles", "chicken", "egg", "fish sauce", "roasted peanuts"],
  },
  {
    id: "garlic-bread",
    name: "Garlic Bread",
    price: 5.5,
    description: "Toasted focaccia with garlic butter and parsley.",
    available: true,
    allergens: { contains: ["gluten", "milk"] },
    ingredients: ["focaccia", "butter", "garlic", "parsley"],
  },
  {
    id: "soup-of-the-day",
    name: "Soup of the Day",
    price: 8,
    description: "Ask your server for today's soup. Recipe changes daily.",
    available: true,
    allergens: null,
    ingredients: [],
  },
  {
    id: "cola",
    name: "Cola",
    price: 3.5,
    description: "330 ml can.",
    available: true,
    allergens: { contains: [], may_contain: [], last_reviewed: "2026-09-01" },
    ingredients: ["carbonated water", "sugar"],
  },
  {
    id: "fresh-lemonade",
    name: "Fresh Lemonade",
    price: 4,
    description: "Squeezed to order with mint.",
    available: true,
    allergens: { contains: [], may_contain: [], last_reviewed: "2026-09-01" },
    ingredients: ["lemon", "sugar", "water", "mint"],
  },
];

export type StatusWrite = { orderId: string; from: OrderStatus; to: OrderStatus };

/**
 * In-memory ToolStore. It does NOT enforce the pending-only rule itself beyond
 * what the interface contract says, and it records every write, so tests can
 * prove what the tool code attempts.
 */
export class MemoryStore implements ToolStore {
  menu = new Map(MENU.map((item) => [item.id, structuredClone(item)]));
  orders = new Map<string, Order>();
  statusWrites: StatusWrite[] = [];
  writes: { method: string; orderId: string }[] = [];

  /** Test helper: put an order in any state, bypassing the tools. */
  seedOrder(status: OrderStatus, lines: OrderLine[] = [{ item_id: "cola", qty: 1, unit_price_snapshot: 3.5 }]): Order {
    const order: Order = {
      id: randomUUID(),
      table_number: 7,
      status,
      discount_percent: 0,
      created_at: new Date().toISOString(),
      lines: structuredClone(lines),
    };
    this.orders.set(order.id, order);
    return structuredClone(order);
  }

  async listMenu() {
    return [...this.menu.values()].map((item) => structuredClone(item));
  }

  async getMenuItem(itemId: string) {
    const item = this.menu.get(itemId);
    return item ? structuredClone(item) : null;
  }

  async getOrder(orderId: string) {
    const order = this.orders.get(orderId);
    return order ? structuredClone(order) : null;
  }

  async createPendingOrder(tableNumber: number, lines: OrderLine[]) {
    const order: Order = {
      id: randomUUID(),
      table_number: tableNumber,
      status: "pending",
      discount_percent: 0,
      created_at: new Date().toISOString(),
      lines: structuredClone(lines),
    };
    this.orders.set(order.id, order);
    this.writes.push({ method: "createPendingOrder", orderId: order.id });
    return structuredClone(order);
  }

  async updatePendingOrder(orderId: string, patch: { table_number?: number; discount_percent?: number }) {
    this.writes.push({ method: "updatePendingOrder", orderId });
    const order = this.orders.get(orderId);
    if (order?.status !== "pending") return false;
    Object.assign(order, patch);
    return true;
  }

  async replacePendingLines(orderId: string, lines: OrderLine[]) {
    this.writes.push({ method: "replacePendingLines", orderId });
    const order = this.orders.get(orderId);
    if (order?.status !== "pending") return false;
    order.lines = structuredClone(lines);
    return true;
  }

  async cancelPendingOrder(orderId: string) {
    this.writes.push({ method: "cancelPendingOrder", orderId });
    const order = this.orders.get(orderId);
    if (order?.status !== "pending") return false;
    this.statusWrites.push({ orderId, from: order.status, to: "cancelled" });
    order.status = "cancelled";
    return true;
  }
}

export class MemoryAudit implements AuditSink {
  entries: AuditEntry[] = [];
  failNext = false;

  async record(entry: AuditEntry) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("audit database unavailable");
    }
    this.entries.push(structuredClone(entry));
  }
}

export function makeDeps() {
  const store = new MemoryStore();
  const audit = new MemoryAudit();
  return { store, audit, deps: { store, audit } };
}
