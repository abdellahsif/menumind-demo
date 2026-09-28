-- Creates a pending order and its lines in one transaction.
--
-- Replaces the application-side "insert order, insert lines, delete order on
-- failure" sequence. Prices are snapshotted from menu_items inside the same
-- transaction, and unknown or unavailable items abort the whole call, so an
-- order can never exist without its lines.

create function public.create_pending_order(p_table_number integer, p_items jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_missing  text;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'p_items must be a non-empty array'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Validate every requested item before writing anything.
  select string_agg(req.item_id, ', ')
    into v_missing
    from jsonb_to_recordset(p_items) as req(item_id text, qty integer)
    left join public.menu_items m on m.id = req.item_id
   where m.id is null or not m.available;

  if v_missing is not null then
    raise exception 'unknown or unavailable menu items: %', v_missing
      using errcode = 'check_violation';
  end if;

  -- Status is not supplied: the default and the lifecycle trigger make it pending.
  insert into public.orders (table_number)
  values (p_table_number)
  returning id into v_order_id;

  insert into public.order_items (order_id, item_id, qty, unit_price_snapshot)
  select v_order_id, req.item_id, sum(req.qty), m.price
    from jsonb_to_recordset(p_items) as req(item_id text, qty integer)
    join public.menu_items m on m.id = req.item_id
   group by req.item_id, m.price;

  return v_order_id;
end;
$$;

-- Only the server (service role) may call it; browsers cannot create orders.
revoke execute on function public.create_pending_order(integer, jsonb) from public, anon, authenticated;
grant execute on function public.create_pending_order(integer, jsonb) to service_role;
