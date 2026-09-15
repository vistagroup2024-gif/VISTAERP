-- Dashboard cards open a report, cardwise (1/1 for this batch) — Car Customer
-- Balances.
--
-- The three car-sales reports under /car-sales/reports (Outstanding, Aging,
-- Customer Summary) summed only car_installments: no advance leg, no monthly
-- service charge, "due"/"overdue" not disjoint (due_date <= today overlaps
-- due_date < today), and no ledger balance. dashboard_metrics()'s car_money
-- CTE was fixed to all of that in migration 387 — these report pages were
-- never brought along, so the dashboard card and its own drill-down would
-- have shown two different numbers for "what this customer owes", exactly
-- the trap CLAUDE.md keeps finding.
--
-- car_customer_balances() is car_money's per-customer twin: same three
-- sources (car_installments, the advance leg via car_receipt_allocations,
-- car_service_charges), same disjoint split (overdue = month ended,
-- due_this_month = arrived and month not ended), same ledger balance off
-- the customer's own account. The Outstanding report reads it instead of
-- re-deriving its own numbers, so the card and the report agree by
-- construction, not by coincidence.
create or replace function public.car_customer_balances()
returns jsonb
language sql stable security invoker set search_path to 'public' as $function$
  with
    co as (select auth_company_id() as id),
    bounds as (
      select date_trunc('month', current_date)::date as month_start, current_date as today
    ),
    due_items as (
      select c.customer_id, i.due_date as due,
             greatest(i.amount - i.paid_amount, 0) as amt, coalesce(i.paid_amount, 0) as paid
        from car_installments i
        join car_contracts c on c.id = i.contract_id
       where c.company_id = (select id from co)
      union all
      select c.customer_id, coalesce(c.advance_due_date, c.contract_date),
             greatest(coalesce(c.advance, 0) - coalesce(adv.paid, 0), 0), coalesce(adv.paid, 0)
        from car_contracts c
        left join lateral (
          select coalesce(sum(al.amount), 0) as paid
            from car_receipt_allocations al
            join car_receipts r on r.id = al.receipt_id
           where r.contract_id = c.id and al.target_type = 'advance') adv on true
       where c.company_id = (select id from co) and coalesce(c.advance, 0) > 0
      union all
      select s.customer_id, s.due_date, greatest(s.amount - s.paid_amount, 0), coalesce(s.paid_amount, 0)
        from car_service_charges s
       where s.company_id = (select id from co)
    ),
    per_customer as (
      select customer_id,
        coalesce(sum(amt) filter (where due < (select month_start from bounds)), 0) as overdue,
        coalesce(sum(amt) filter (where due >= (select month_start from bounds)
                                    and due <= (select today from bounds)), 0) as due_this_month,
        coalesce(sum(paid), 0) as collected
      from due_items group by customer_id
    ),
    contracts as (
      select customer_id, count(*) as cars,
             coalesce(sum(net_payable), 0) as value, coalesce(sum(advance), 0) as advance
        from car_contracts
       where company_id = (select id from co) and status <> 'cancelled' and customer_id is not null
       group by customer_id
    ),
    bal as (
      select a.party_id as customer_id, coalesce(sum(l.debit - l.credit), 0) as balance
        from accounts a
        join journal_lines l on l.account_id = a.id
        join journal_entries e on e.id = l.entry_id and e.status = 'posted'
       where a.company_id = (select id from co) and a.party_id is not null
       group by a.party_id
    )
  select coalesce(jsonb_agg(jsonb_build_object(
      'customer_id', p.id, 'name', p.name, 'phone', p.phone,
      'cars', ct.cars, 'value', ct.value, 'advance', ct.advance,
      'due', coalesce(pc.due_this_month, 0), 'overdue', coalesce(pc.overdue, 0),
      'total_due', coalesce(pc.due_this_month, 0) + coalesce(pc.overdue, 0),
      'collected', coalesce(pc.collected, 0), 'balance', coalesce(b.balance, 0)
    ) order by coalesce(b.balance, 0) desc), '[]'::jsonb)
  from parties p
  join contracts ct on ct.customer_id = p.id
  left join per_customer pc on pc.customer_id = p.id
  left join bal b on b.customer_id = p.id;
$function$;

revoke all on function public.car_customer_balances() from public, anon;
grant execute on function public.car_customer_balances() to authenticated;

do $chk$
declare
  v_admin uuid := 'edf3fa71-27e2-4cb1-af62-9afd685abefe';
  v_result jsonb;
  v_card jsonb;
  v_rows_sum_due numeric; v_rows_sum_overdue numeric; v_rows_sum_balance numeric;
begin
  if not exists (select 1 from profiles where id = v_admin) then
    raise exception 'car_customer_balances self-check: reference admin profile not found';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);

  select public.dashboard_metrics() -> 'car_balances' into v_card;
  select public.car_customer_balances() into v_result;

  select coalesce(sum((r->>'due')::numeric), 0), coalesce(sum((r->>'overdue')::numeric), 0),
         coalesce(sum((r->>'balance')::numeric), 0)
    into v_rows_sum_due, v_rows_sum_overdue, v_rows_sum_balance
  from jsonb_array_elements(v_result) r;

  -- The per-customer rows must foot to exactly the dashboard card's own
  -- totals — that agreement is the entire point of this migration.
  if abs(v_rows_sum_due - (v_card->>'due_this_month')::numeric) > 0.01 then
    raise exception 'car_customer_balances self-check: due % does not match card due_this_month %',
      v_rows_sum_due, v_card->>'due_this_month';
  end if;
  if abs(v_rows_sum_overdue - (v_card->>'overdue')::numeric) > 0.01 then
    raise exception 'car_customer_balances self-check: overdue % does not match card overdue %',
      v_rows_sum_overdue, v_card->>'overdue';
  end if;
  if abs(v_rows_sum_balance - (v_card->>'balance')::numeric) > 0.01 then
    raise exception 'car_customer_balances self-check: balance % does not match card balance %',
      v_rows_sum_balance, v_card->>'balance';
  end if;

  raise notice 'car_customer_balances self-check passed: % customers, due=%, overdue=%, balance=%',
    jsonb_array_length(v_result), v_rows_sum_due, v_rows_sum_overdue, v_rows_sum_balance;
end;
$chk$;
