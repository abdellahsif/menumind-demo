-- MenuMind Demo: core schema.
--
-- Safety model: the application enforces the order lifecycle in code, and this
-- migration enforces it again in the database so that no code path (including a
-- bug or a misbehaving model) can skip the human confirmation step.

-------------------------------------------------------------------------------
-- Types
-------------------------------------------------------------------------------

create type public.order_status as enum ('pending', 'confirmed', 'cancelled', 'preparing', 'ready');

-------------------------------------------------------------------------------
-- menu_items
-------------------------------------------------------------------------------

create table public.menu_items (
  id          text primary key
              check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name        text not null unique
              check (length(btrim(name)) > 0),
  price       numeric(10, 2) not null
              check (price >= 0),
  description text not null default '',
  available   boolean not null default true,
  -- NULL means "unknown". The app must never infer allergen safety from NULL.
  -- Shape: { "contains": [...], "may_contain": [...], "last_reviewed": "YYYY-MM-DD" }
  allergens   jsonb,
  ingredients text[] not null default '{}',

  constraint menu_items_allergens_shape check (
    allergens is null
    or (
      jsonb_typeof(allergens) = 'object'
      and (
        not (allergens ? 'contains')
        or (
          jsonb_typeof(allergens -> 'contains') = 'array'
          and (allergens -> 'contains') <@ '["gluten","crustaceans","eggs","fish","peanuts","soybeans","milk","tree_nuts","celery","mustard","sesame","sulphites","lupin","molluscs"]'::jsonb
        )
      )
      and (
        not (allergens ? 'may_contain')
        or (
          jsonb_typeof(allergens -> 'may_contain') = 'array'
          and (allergens -> 'may_contain') <@ '["gluten","crustaceans","eggs","fish","peanuts","soybeans","milk","tree_nuts","celery","mustard","sesame","sulphites","lupin","molluscs"]'::jsonb
        )
      )
    )
  )
);

comment on column public.menu_items.allergens is
  'EU-14 allergen codes. NULL or missing keys = incomplete data; the assistant must refer guests to the kitchen.';

-------------------------------------------------------------------------------
-- orders
-------------------------------------------------------------------------------

create table public.orders (
  id               uuid primary key default gen_random_uuid(),
  table_number     integer not null
                   check (table_number between 1 and 999),
  status           public.order_status not null default 'pending',
  discount_percent integer not null default 0
                   check (discount_percent between 0 and 20),
  created_at       timestamptz not null default now()
);

create index orders_status_created_at_idx on public.orders (status, created_at);

-------------------------------------------------------------------------------
-- order_items
-------------------------------------------------------------------------------

create table public.order_items (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references public.orders (id) on delete cascade,
  item_id             text not null references public.menu_items (id),
  qty                 integer not null
                      check (qty between 1 and 50),
  unit_price_snapshot numeric(10, 2) not null
                      check (unit_price_snapshot >= 0),

  -- One line per menu item per order; quantity changes update the line.
  constraint order_items_order_item_unique unique (order_id, item_id)
);

create index order_items_order_id_idx on public.order_items (order_id);

-------------------------------------------------------------------------------
-- tool_audit_log
-------------------------------------------------------------------------------

create table public.tool_audit_log (
  id         bigint generated always as identity primary key,
  order_id   uuid references public.orders (id) on delete set null,
  tool_name  text not null,
  input      jsonb not null,
  output     jsonb,
  created_at timestamptz not null default now()
);

create index tool_audit_log_created_at_idx on public.tool_audit_log (created_at desc);

-------------------------------------------------------------------------------
-- Lifecycle guards (defense in depth)
-------------------------------------------------------------------------------

-- Orders: always born pending; status may only move along the allowed graph;
-- table and discount are frozen once the order leaves "pending".
create function public.enforce_order_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then
      raise exception 'orders must be created with status pending, got %', new.status
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status <> 'pending' then
      raise exception 'only pending orders can be deleted (order % is %)', old.id, old.status
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  -- UPDATE
  if new.id <> old.id or new.created_at <> old.created_at then
    raise exception 'order id and created_at are immutable'
      using errcode = 'check_violation';
  end if;

  if old.status <> 'pending'
     and (new.table_number, new.discount_percent) is distinct from (old.table_number, old.discount_percent) then
    raise exception 'order % is %; only pending orders can be edited', old.id, old.status
      using errcode = 'check_violation';
  end if;

  if new.status <> old.status and not (
       (old.status = 'pending'   and new.status in ('confirmed', 'cancelled'))
    or (old.status = 'confirmed' and new.status = 'preparing')
    or (old.status = 'preparing' and new.status = 'ready')
  ) then
    raise exception 'invalid status transition % -> % for order %', old.status, new.status, old.id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger orders_enforce_lifecycle
  before insert or update or delete on public.orders
  for each row execute function public.enforce_order_lifecycle();

-- Order items: may only change while the parent order is pending.
create function public.enforce_order_items_pending()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_status public.order_status;
  target_order  uuid;
begin
  if tg_op = 'DELETE' then
    target_order := old.order_id;
  else
    target_order := new.order_id;
  end if;

  select o.status into parent_status from public.orders o where o.id = target_order;

  -- Parent already gone: this is the cascade from deleting a pending order.
  if parent_status is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if parent_status <> 'pending' then
    raise exception 'order % is %; its items can no longer change', target_order, parent_status
      using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE' and new.order_id <> old.order_id then
    raise exception 'order items cannot move between orders'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger order_items_enforce_pending
  before insert or update or delete on public.order_items
  for each row execute function public.enforce_order_items_pending();

-- Audit log is append-only.
create function public.reject_audit_log_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'tool_audit_log is append-only'
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger tool_audit_log_append_only
  before update or delete on public.tool_audit_log
  for each row execute function public.reject_audit_log_mutation();

-------------------------------------------------------------------------------
-- Row Level Security
--
-- Browser clients use the anon key and can only READ:
--   * the menu,
--   * orders that a human has already confirmed (for the live kitchen board).
-- All writes go through server-side code using the service role key, which
-- bypasses RLS. Pending orders and the audit log are never exposed to anon.
-------------------------------------------------------------------------------

alter table public.menu_items     enable row level security;
alter table public.orders         enable row level security;
alter table public.order_items    enable row level security;
alter table public.tool_audit_log enable row level security;

-- Belt and braces: remove default write grants from browser roles.
revoke insert, update, delete, truncate on public.menu_items     from anon, authenticated;
revoke insert, update, delete, truncate on public.orders         from anon, authenticated;
revoke insert, update, delete, truncate on public.order_items    from anon, authenticated;
revoke all                              on public.tool_audit_log from anon, authenticated;

create policy "Menu is publicly readable"
  on public.menu_items for select
  to anon, authenticated
  using (true);

create policy "Board can read confirmed orders"
  on public.orders for select
  to anon, authenticated
  using (status in ('confirmed', 'preparing', 'ready'));

create policy "Board can read items of confirmed orders"
  on public.order_items for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and o.status in ('confirmed', 'preparing', 'ready')
    )
  );

-- No policies on tool_audit_log: only the service role can read or write it.

-------------------------------------------------------------------------------
-- Realtime (live board)
-------------------------------------------------------------------------------

alter publication supabase_realtime add table public.orders, public.order_items;
