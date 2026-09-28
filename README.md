# MenuMind Demo

An ordering assistant for a restaurant. Staff type plain sentences such as
"add two margherita pizzas and one cola to table 4", and the assistant performs
real actions through tool calls. Nothing reaches the kitchen until a human
presses **Confirm**.

> Status: Phase 1 of 6 (project setup, schema, migrations, seed data).
> The architecture, safety design and test sections are completed in later phases.

## Stack

- Next.js (App Router), TypeScript (strict), Tailwind CSS
- Supabase: Postgres, Realtime, Row Level Security
- Vercel AI SDK with tool calling. Default provider is Google Gemini (free tier).
  Anthropic and OpenAI are supported through one environment variable.
- Zod for input validation, Vitest for unit tests, Playwright for end-to-end tests

## Database at a glance

| Table            | Purpose                                                             |
| ---------------- | ------------------------------------------------------------------- |
| `menu_items`     | Menu with price, availability, structured allergens, ingredients    |
| `orders`         | `pending` → `confirmed` → `preparing` → `ready`, or `cancelled`     |
| `order_items`    | Lines of an order with the unit price captured when added           |
| `tool_audit_log` | Every tool the assistant called, with its input and output          |

The database enforces the order lifecycle itself, independent of application code:

- Orders can only be **created** as `pending`.
- Status can only move `pending → confirmed | cancelled`, `confirmed → preparing`, `preparing → ready`.
- Table number, discount and order lines are frozen once an order leaves `pending`.
- Discount is capped at 20% by a check constraint.
- Allergen codes are checked against the EU-14 list, so a typo cannot be stored.
- The audit log is append-only.

### Row Level Security

RLS is enabled on every table.

| Table            | Browser (anon key)                              | Server (service role key) |
| ---------------- | ----------------------------------------------- | ------------------------- |
| `menu_items`     | Read                                            | Read / write              |
| `orders`         | Read only `confirmed`, `preparing`, `ready`     | Read / write              |
| `order_items`    | Read only lines of those orders                 | Read / write              |
| `tool_audit_log` | No access                                       | Read / insert             |

All writes go through server-side code that uses the service role key. That key
is only importable from server modules, so it cannot end up in the browser bundle.
Pending orders and the audit log are never readable from the browser.

---

## Setup

You need **Node.js 20.9 or newer** and **Git**. Everything else below is free.

### 1. Create the Supabase project

1. Go to <https://supabase.com> and click **Start your project**. Sign in with GitHub.
2. Click **New project**.
   - **Organization**: the default personal one is fine.
   - **Project name**: `menumind-demo`.
   - **Database password**: click **Generate a password** and save it somewhere safe.
   - **Region**: the one closest to you.
   - Click **Create new project** and wait about two minutes.

### 2. Create the tables and seed the menu

1. In the left sidebar, open **SQL Editor**.
2. Click **New query**.
3. Open [supabase/migrations/20260928000000_init.sql](supabase/migrations/20260928000000_init.sql)
   in this repo, copy all of it, paste it into the editor, and click **Run**.
   You should see "Success. No rows returned".
4. Click **New query** again, paste the contents of [supabase/seed.sql](supabase/seed.sql),
   and click **Run**.
5. Open **Table Editor** → `menu_items`. You should see 16 rows.

<details>
<summary>Alternative: apply migrations with the Supabase CLI</summary>

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npm run db:push
```

The project ref is the part of your project URL before `.supabase.co`.
</details>

### 3. Copy the Supabase keys

1. Open **Project Settings** (gear icon) → **Data API** and copy the **Project URL**.
2. Open **Project Settings** → **API Keys**.
   - Copy the **Publishable key** (starts with `sb_publishable_`).
     Older projects call it the `anon` key.
   - Copy a **Secret key** (starts with `sb_secret_`).
     Older projects call it the `service_role` key. Treat it like a password.

### 4. Get a free Gemini API key

1. Go to <https://aistudio.google.com/apikey> and sign in with a Google account.
2. Click **Create API key** and copy it.

The free tier has rate limits that are ample for a demo. No card is required.

### 5. Configure the app

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
LLM_PROVIDER=google
GOOGLE_GENERATIVE_AI_API_KEY=...
```

The app validates these at startup and stops with a clear message if anything is
missing or if a secret key is placed in a public variable.

### 6. Run it

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

## Scripts

| Command             | What it does                        |
| ------------------- | ----------------------------------- |
| `npm run dev`       | Start the development server        |
| `npm run build`     | Production build                    |
| `npm run lint`      | ESLint                              |
| `npm run typecheck` | TypeScript, no emit                 |
| `npm test`          | Unit tests (Vitest)                 |
| `npm run test:e2e`  | End-to-end test (Playwright)        |
