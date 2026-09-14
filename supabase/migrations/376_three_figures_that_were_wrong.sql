-- ============================================================
-- 376 — Three figures that were wrong
--
-- 1. THE BALANCE SHEET REPORT WAS DOUBLE. trial_balance() counted an entry as
--    "opening" whenever no from-date was given (p_from is null made the
--    opening filter true for every line) AND as "period", and closing is
--    opening + period. The Balance Sheet passes no from-date, so every line on
--    it was twice the ledger: 246,000 of assets against a real 123,000. The
--    dashboard card reads the ledger directly and was right. Opening is now
--    what falls BEFORE the from-date, and nothing when there is none; and only
--    posted entries of the company are counted at all (the old left join let
--    a draft or another company's lines through under the same null filter).
--
-- 2. "DELIVERED" DID NOT REACH THE DASHBOARD. A Delivery Note says the goods
--    were dispatched; the Delivered tick on it (migration 347) says the
--    customer received them. The Delivery Status card counts vehicles by
--    car_vehicles.status, and the only thing that ever set that to
--    'delivered' was the old Car Sales delivery screen, which is hidden. So a
--    car could be ticked delivered and the card still called it undelivered.
--    The tick now moves the vehicle to 'delivered' (and back on un-tick), and
--    raises the first service charge there and then.
--
-- 3. THE FIRST SERVICE CHARGE IGNORED THE RULE. Migration 350 made the monthly
--    generator bill from the delivery and prorate the first month — but
--    activating a Car Invoice fires car_contract_autocharge, which called the
--    OLD per-vehicle generator: a full month, from the purchase date, no
--    delivery asked. CAR-000005 was delivered on the 13th and got 1,000 for
--    September where the rule says 500. The per-vehicle generator now follows
--    the same rule as the monthly one (so activation writes nothing until the
--    car is delivered), and that one row is corrected — it is unpaid and its
--    month has not been posted.
-- ============================================================
begin;

-- ── 1. trial balance ────────────────────────────────────────────────────────
create or replace function public.trial_balance(p_company uuid, p_from date, p_to date)
returns jsonb
language sql stable security definer
set search_path to 'public'
as $function$
  with posted as (
    select l.account_id, l.debit, l.credit, e.entry_date
    from journal_lines l
    join journal_entries e on e.id = l.entry_id
    where e.company_id = p_company and e.status = 'posted'
  ),
  agg as (
    select a.id, a.code, a.name, a.type as nature,
      -- Before the period. With no from-date there is no "before": everything
      -- is the period, and counting it here as well is how the report doubled.
      coalesce(sum(x.debit - x.credit) filter (where p_from is not null and x.entry_date < p_from), 0) as opening_net,
      coalesce(sum(x.debit)  filter (where (p_from is null or x.entry_date >= p_from) and (p_to is null or x.entry_date <= p_to)), 0) as period_debit,
      coalesce(sum(x.credit) filter (where (p_from is null or x.entry_date >= p_from) and (p_to is null or x.entry_date <= p_to)), 0) as period_credit
    from accounts a
    left join posted x on x.account_id = a.id
    where a.company_id = p_company and a.is_postable
      and (staff_scope_ids('account') is null or a.id = any(staff_scope_ids('account')))
    group by a.id, a.code, a.name, a.type
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'code', code, 'name', name, 'nature', nature,
    'opening_debit',  case when opening_net > 0 then opening_net else 0 end,
    'opening_credit', case when opening_net < 0 then -opening_net else 0 end,
    'period_debit', period_debit, 'period_credit', period_credit,
    'closing_net', opening_net + period_debit - period_credit
  ) order by code), '[]'::jsonb)
  from agg
  where opening_net <> 0 or period_debit <> 0 or period_credit <> 0;
$function$;

-- ── 3. the per-vehicle generator follows the rule ───────────────────────────
-- Same loop as car_gen_charges_company, for one vehicle: from the month the
-- customer got the car, prorated for that month, nothing before it and
-- nothing at all until it is delivered. Internal — the activation trigger and
-- the Delivered tick call it; nothing in the app does.
create or replace function public.car_gen_charges_vehicle(
  p_vehicle uuid, p_asof date default current_date, p_contract uuid default null, p_customer uuid default null)
returns integer
language plpgsql security definer
set search_path to 'public'
as $function$
declare m date; v_end date; n int := 0; v car_vehicles%rowtype; v_contract uuid; v_delivered date; v_amt numeric; v_full numeric;
begin
  select * into v from car_vehicles where id = p_vehicle and ownership = 'vista';
  if not found then return 0; end if;
  v_contract := coalesce(p_contract, v.contract_id);
  if v_contract is null then return 0; end if;
  v_delivered := car_contract_delivered_on(v_contract);
  if v_delivered is null then return 0; end if;
  v_full := coalesce(v.monthly_charge, 1000);
  v_end := date_trunc('month', p_asof)::date;
  m := date_trunc('month', v_delivered)::date;
  while m <= v_end loop
    v_amt := car_charge_for_month(m, v_delivered, v_full);
    if v_amt > 0 then
      insert into car_service_charges(company_id, vehicle_id, contract_id, customer_id, charge_month, due_date, amount, notes)
      values (v.company_id, v.id, v_contract, coalesce(p_customer, v.current_customer_id), m,
              (m + interval '1 month')::date, v_amt,
              case when date_trunc('month', m) = date_trunc('month', v_delivered) and v_amt < v_full
                   then 'Part month — delivered ' || to_char(v_delivered, 'DD-MM-YY') end)
      on conflict (vehicle_id, charge_month) do nothing;
      if found then n := n + 1; end if;
    end if;
    m := (m + interval '1 month')::date;
  end loop;
  return n;
end $function$;
revoke all on function public.car_gen_charges_vehicle(uuid, date, uuid, uuid) from public, anon, authenticated;

-- ── 2. the Delivered tick reaches the vehicle ───────────────────────────────
create or replace function public.trade_doc_mark_delivered(p_id uuid, p_delivered boolean, p_date date default null)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $function$
declare d trade_documents; v_co uuid; v_date date; v_vehicle uuid; v_charges int := 0;
begin
  if not is_staff() then raise exception 'Not signed in'; end if;
  v_co := auth_company_id();
  select * into d from trade_documents where id = p_id and company_id = v_co;
  if not found then raise exception 'Document not found'; end if;
  if d.doc_type <> 'delivery_note' then
    raise exception 'Only a Delivery Note records a delivery';
  end if;
  perform staff_require_trade_right(p_id, 'edit');
  if p_delivered then
    v_date := coalesce(p_date, d.delivered_date, current_date);
    if v_date > current_date then
      raise exception 'A delivery cannot be dated in the future';
    end if;
    if v_date < d.doc_date then
      raise exception 'The goods cannot have arrived before the note that sent them (%)', d.doc_date;
    end if;
    update trade_documents
       set delivered = true, delivered_date = v_date,
           delivered_by = auth.uid(), delivered_at = now(), updated_at = now()
     where id = p_id;
  else
    update trade_documents
       set delivered = false, delivered_date = null,
           delivered_by = null, delivered_at = null, updated_at = now()
     where id = p_id;
  end if;

  -- A car: the vehicle's own status is what the dashboard counts, and the
  -- first service charge is billed from this date, so both happen here.
  if d.source_car_contract is not null then
    select vehicle_id into v_vehicle from car_contracts where id = d.source_car_contract;
    if v_vehicle is not null then
      if p_delivered then
        update car_vehicles set status = 'delivered'
         where id = v_vehicle and status in ('sold', 'reserved', 'held');
        v_charges := car_gen_charges_vehicle(v_vehicle, current_date, d.source_car_contract, null);
      else
        -- Back to sold unless the old delivery screen also recorded it. And
        -- the charges this delivery raised go with it — only the ones nothing
        -- has happened to: unpaid, and in a month whose voucher is not posted.
        update car_vehicles
           set status = case when exists (select 1 from car_deliveries where vehicle_id = v_vehicle)
                             then 'delivered' else 'sold' end
         where id = v_vehicle and status = 'delivered';
        delete from car_service_charges s
         where s.vehicle_id = v_vehicle and s.contract_id = d.source_car_contract
           and coalesce(s.paid_amount, 0) = 0
           and not exists (select 1 from journal_entries e
                            where e.company_id = s.company_id and e.source = 'car_scharge_month'
                              and e.reference = s.company_id::text || '-' || to_char(s.charge_month, 'YYYY-MM'));
      end if;
    end if;
  end if;

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_co, auth.uid(),
          case when p_delivered then 'delivery_confirmed' else 'delivery_unconfirmed' end,
          'trade_document', p_id,
          jsonb_build_object('doc_no', d.doc_no, 'delivered_date', v_date,
                             'car_contract', d.source_car_contract, 'vehicle', v_vehicle, 'charges_raised', v_charges));
  return jsonb_build_object('ok', true, 'delivered', p_delivered, 'delivered_date', v_date, 'charges_raised', v_charges);
end $function$;

-- ── the data ────────────────────────────────────────────────────────────────
-- Vehicles whose Delivery Note is ticked delivered read as delivered.
update car_vehicles v
   set status = 'delivered'
  from car_contracts c
 where c.id = v.contract_id
   and v.status in ('sold', 'reserved', 'held')
   and exists (select 1 from trade_documents d where d.source_car_contract = c.id and d.delivered);

-- The first-month charge the old generator got wrong: re-read off the rule.
-- Only an unpaid charge in a month whose voucher has not been posted.
update car_service_charges s
   set amount = car_charge_for_month(s.charge_month, car_contract_delivered_on(s.contract_id), coalesce(v.monthly_charge, 1000)),
       notes  = 'Part month — delivered ' || to_char(car_contract_delivered_on(s.contract_id), 'DD-MM-YY')
  from car_vehicles v
 where v.id = s.vehicle_id
   and s.contract_id is not null
   and car_contract_delivered_on(s.contract_id) is not null
   and date_trunc('month', s.charge_month) = date_trunc('month', car_contract_delivered_on(s.contract_id))
   and coalesce(s.paid_amount, 0) = 0
   and s.amount <> car_charge_for_month(s.charge_month, car_contract_delivered_on(s.contract_id), coalesce(v.monthly_charge, 1000))
   and not exists (select 1 from journal_entries e
                    where e.company_id = s.company_id and e.source = 'car_scharge_month'
                      and e.reference = s.company_id::text || '-' || to_char(s.charge_month, 'YYYY-MM'));
-- A first month the rule says is nothing (delivered 16th or later) is not a
-- row at all.
delete from car_service_charges s
 using car_vehicles v
 where v.id = s.vehicle_id and s.contract_id is not null
   and car_contract_delivered_on(s.contract_id) is not null
   and coalesce(s.paid_amount, 0) = 0
   and car_charge_for_month(s.charge_month, car_contract_delivered_on(s.contract_id), coalesce(v.monthly_charge, 1000)) = 0
   and not exists (select 1 from journal_entries e
                    where e.company_id = s.company_id and e.source = 'car_scharge_month'
                      and e.reference = s.company_id::text || '-' || to_char(s.charge_month, 'YYYY-MM'));

-- ── post-conditions ─────────────────────────────────────────────────────────
do $chk$
declare v_co uuid; v_card jsonb; v_a numeric; v_l numeric; v_p numeric; v_bad int; v_auth boolean;
begin
  perform set_config('request.jwt.claims', '{"sub":"edf3fa71-27e2-4cb1-af62-9afd685abefe","role":"authenticated"}', true);
  v_co := auth_company_id();
  v_card := dashboard_metrics()->'balance_sheet';
  select sum(closing_net) filter (where nature = 'asset'),
         -sum(closing_net) filter (where nature = 'liability'),
         -sum(closing_net) filter (where nature in ('income', 'expense'))
    into v_a, v_l, v_p
    from jsonb_to_recordset(trial_balance(v_co, null, null)) as t(nature text, closing_net numeric);
  if coalesce(v_a, 0) <> (v_card->>'assets')::numeric or coalesce(v_l, 0) <> (v_card->>'liabilities')::numeric
     or coalesce(v_p, 0) <> (v_card->>'profit')::numeric then
    raise exception '376: balance sheet report (% / % / %) still disagrees with the card %', v_a, v_l, v_p, v_card;
  end if;
  -- A from-date on the first of the year must give the same closing figures.
  select sum(closing_net) filter (where nature = 'asset') into v_a
    from jsonb_to_recordset(trial_balance(v_co, date_trunc('year', current_date)::date, null)) as t(nature text, closing_net numeric);
  if coalesce(v_a, 0) <> (v_card->>'assets')::numeric then
    raise exception '376: closing with a from-date (%) differs from without', v_a;
  end if;

  -- Every first-month charge now agrees with the rule.
  select count(*) into v_bad
    from car_service_charges s join car_vehicles v on v.id = s.vehicle_id
   where s.contract_id is not null and car_contract_delivered_on(s.contract_id) is not null
     and s.amount <> car_charge_for_month(s.charge_month, car_contract_delivered_on(s.contract_id), coalesce(v.monthly_charge, 1000));
  if v_bad > 0 then raise exception '376: % service charge(s) still break the first-month rule', v_bad; end if;

  -- A delivered car reads delivered.
  select count(*) into v_bad
    from car_vehicles v join car_contracts c on c.id = v.contract_id
   where exists (select 1 from trade_documents d where d.source_car_contract = c.id and d.delivered)
     and v.status <> 'delivered';
  if v_bad > 0 then raise exception '376: % delivered vehicle(s) not marked delivered', v_bad; end if;

  select has_function_privilege('authenticated', p.oid, 'execute') into v_auth
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'car_gen_charges_vehicle';
  if v_auth then raise exception '376: car_gen_charges_vehicle is callable by authenticated'; end if;
  raise notice '376 ok: balance sheet %, charges and delivered statuses agree', v_card;
end $chk$;

commit;
