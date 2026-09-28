# MenuMind Demo: Build Plan

Work phase by phase. Stop at the end of each phase and show the test results
before moving on. Do not add features that are not in this plan.

## Phases

1. **Setup, schema, migrations, seed data.** Done.
2. **Tools and server-side logic with unit tests.**
3. **Chat UI with the confirmation flow.**
4. **Live order board** (`/board`, Supabase Realtime) and **tool audit log page** (`/log`).
5. **Allergen test set** (Vitest, 12+ cases) and **one Playwright e2e test**
   (type an order, confirm it, see it on the board).
6. **Vercel deployment notes**, README (architecture diagram, why confirmation is
   not an LLM tool, allergen strategy, setup, tests), and `DEMO.md` with a
   2-minute demo script.

## Phase 2: tools

Every tool input is validated with Zod, and every call is written to `tool_audit_log`.

| Tool | Behaviour |
| --- | --- |
| `search_menu(query)` | Search the menu. |
| `get_item_price(item_id)` | Current price of one item. |
| `get_allergens(item_id)` | Returns exactly what is stored. If allergens are `null` or incomplete, returns an explicit "unknown" result, so the assistant says it can't confirm and the guest should check with the kitchen. |
| `create_pending_order(table, items[{item_id, qty}])` | Creates the order with status `pending` only. Never confirmed. |
| `edit_pending_order(order_id, changes)` | Edits a pending order. |
| `apply_discount(order_id, percent)` | Maximum 20%. Pending orders only. |
| `cancel_pending_order(order_id)` | Cancels a pending order. |

## Hard rules

- **No confirm tool**, including any "request confirm" tool. The LLM has no way to
  confirm an order, mark it preparing or ready, or touch a confirmed order.
  Confirmation is only a UI button that calls a server action, which re-checks
  prices and availability on the server. This is enforced in code, not only in the
  system prompt. A unit test proves that no registered tool can move an order out
  of `pending`.
- **Allergen answers must come from `get_allergens` in the same turn.** A
  server-side check flags any assistant message that mentions allergens without a
  preceding `get_allergens` call.
- **Chat route** uses the Vercel AI SDK with a provider switch (Google, Anthropic,
  OpenAI) set by an environment variable. API keys stay on the server.
