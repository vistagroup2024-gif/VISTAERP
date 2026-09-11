-- The monthly service charge starts when the customer HAS the car, is prorated
-- for the month they got it, and reaches the ledger as ONE voucher a month.
--
-- Three separate things were wrong, and each of them charged the wrong money.
--
-- 1. IT BILLED FROM THE WRONG DATE. Charges were generated from
--    car_vehicles.purchase_date — the day VISTA bought the car, not the day the
--    customer received it. A car sitting in the yard for two months therefore
--    arrived at its new owner with two months of service charge already against
--    it. It now runs from the delivery confirmed on the Delivery Note
--    (migration 347), and a car that has not been delivered is not charged at
--    all, because nobody has it yet.
--
-- 2. THE FIRST MONTH WAS ALWAYS A FULL MONTH. A car handed over on the 28th was
--    billed the same 1,000 as one handed over on the 1st. The rule now:
--
--        delivered 1st – 4th    full charge      (they had essentially all of it)
--        delivered 5th – 15th   half charge
--        delivered 16th – 31st  nothing this month; billing starts next month
--
--    Only the first month is prorated. Every month after it is the full charge.
--    A zero month is not written as a zero row — a row saying "we charged you
--    nothing" is something a customer can be shown and queried; an absent row
--    is simply a month that was not billed.
--
--    The halves and fulls come from the VEHICLE's own monthly_charge rather
--    than from the literal 1000, so a car on a different rate prorates to half
--    of ITS rate. 1000/500 is what that works out to at the standard rate.
--
-- 3. EVERY CUSTOMER GOT THEIR OWN JOURNAL ENTRY. Thirty customers meant thirty
--    vouchers a month, all identical but for a name. It is one voucher now, with
--    a debit line per customer and a single credit for the month's revenue — the
--    way a billing run reads in any ledger.
--
-- AND THE DOUBLE POST THAT WAS ALREADY THERE. car_sync_company — a backfill that
-- walks everything and posts it by ACCOUNT CODE — had its own service-charge
-- loop, debiting the 1170 control account. car_post_charge debits the CUSTOMER,
-- as "car money belongs to the customer, not to a bucket" requires. Both are
-- keyed ('car_scharge', id), so whichever ran first won and the other silently
-- no-opped: which account a charge landed in depended on call order. With the
-- new monthly voucher under a different key, they would no longer collide — they
-- would both post, and every charge would be counted twice. The loop is removed.

begin;

-- ── the rule, in one place ─────────────────────────────────────────────────
-- Returns what to bill for p_month given the delivery. Null month or no
-- delivery means nothing to bill. Kept as a function rather than inlined so the
-- generator, any report and anyone checking a customer's argument all read the
-- same rule.
create or replace function public.car_charge_for_month(
  p_month date, p_delivered date, p_full numeric)
returns numeric
language sql
immutable
as $f$
  select case
    when p_delivered is null or p_month is null then 0
    -- before the car was handed over
    when date_trunc('month', p_month) < date_trunc('month', p_delivered) then 0
    -- every month after the first is whole
    when date_trunc('month', p_month) > date_trunc('month', p_delivered) then coalesce(p_full, 0)
    -- the month of delivery, by the day of it
    when extract(day from p_delivered) <= 4  then coalesce(p_full, 0)
    when extract(day from p_delivered) <= 15 then round(coalesce(p_full, 0) / 2, 2)
    else 0
  end;
$f$;
comment on function public.car_charge_for_month(date, date, numeric) is
  'Monthly service charge for one vehicle-month: full if delivered 1st-4th, half if 5th-15th, nothing if 16th onward. Only the delivery month is prorated.';

-- ── generate from the delivery, not from the purchase ──────────────────────
create or replace function public.car_gen_charges_company(p_company uuid, p_asof date default current_date)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare m date; v_end date; n int := 0; v_rec record; v_amt numeric; v_delivered date;
begin
  v_end := date_trunc('month', p_asof)::date;
  for v_rec in
    select v.id, coalesce(v.monthly_charge, 1000) as amt, v.current_customer_id, v.contract_id
      from car_vehicles v
     where v.company_id = p_company
       and v.ownership = 'vista'
       and v.contract_id is not null
  loop
    -- When did this customer actually get the car? One routine answers it, so
    -- the charge run and the screens cannot arrive at different dates.
    v_delivered := car_contract_delivered_on(v_rec.contract_id);
    continue when v_delivered is null;          -- not handed over: nothing to bill

    m := date_trunc('month', v_delivered)::date;
    while m <= v_end loop
      v_amt := car_charge_for_month(m, v_delivered, v_rec.amt);
      -- A zero month is skipped rather than written as a zero row. "We charged
      -- you nothing" is a line a customer can query; a month that was not billed
      -- simply is not there.
      if v_amt > 0 then
        insert into car_service_charges(company_id, vehicle_id, contract_id, customer_id, charge_month, due_date, amount, notes)
        values (p_company, v_rec.id, v_rec.contract_id, v_rec.current_customer_id, m,
                (m + interval '1 month')::date, v_amt,
                case when date_trunc('month', m) = date_trunc('month', v_delivered)
                       and v_amt < v_rec.amt
                     then 'Part month — delivered ' || to_char(v_delivered, 'DD-MM-YY')
                end)
        on conflict (vehicle_id, charge_month) do nothing;
        if found then n := n + 1; end if;
      end if;
      m := (m + interval '1 month')::date;
    end loop;
  end loop;
  return n;
end $function$;

-- ── one voucher a month, every customer on it ──────────────────────────────
-- A debit line per customer and one credit for the month's revenue. Keyed on
-- the month, so running the job twice cannot raise it twice; car_post_entry
-- refuses a repeat of the same (source, reference).
create or replace function public.car_post_charges_month(p_company uuid, p_month date)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_lines jsonb := '[]'::jsonb; v_total numeric := 0; r record; v_acct uuid; v_month date;
begin
  v_month := date_trunc('month', p_month)::date;
  perform car_ensure_accounts(p_company);

  for r in
    select c.customer_id,
           sum(c.amount) as amt,
           min(car_cost_center(c.vehicle_id)) as cc,
           min(car_tag_area(c.vehicle_id))    as ta,
           count(*) as cars
      from car_service_charges c
     where c.company_id = p_company
       and c.charge_month = v_month
       and c.amount > 0
     group by c.customer_id
     order by c.customer_id
  loop
    -- The customer's OWN account, because car money belongs to the customer. A
    -- charge with no customer at all still has to land somewhere, and that is
    -- what the 1170 control account is for.
    v_acct := coalesce(car_party_account(r.customer_id), acct(p_company, '1170'));
    if v_acct is null then continue; end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', v_acct, 'debit', r.amt, 'credit', 0,
      'description', 'Service charge ' || to_char(v_month, 'Mon YYYY')
                     || case when r.cars > 1 then ' (' || r.cars || ' vehicles)' else '' end,
      'cost_center', r.cc, 'tag_area', r.ta));
    v_total := v_total + r.amt;
  end loop;

  if v_total <= 0 then return false; end if;

  v_lines := v_lines || jsonb_build_array(jsonb_build_object(
    'code', '4300', 'debit', 0, 'credit', v_total,
    'description', 'Monthly service charges ' || to_char(v_month, 'Mon YYYY')));

  return car_post_entry(p_company, v_month,
    'Monthly service charges ' || to_char(v_month, 'Mon YYYY'),
    'car_scharge_month', p_company::text || '-' || to_char(v_month, 'YYYY-MM'),
    v_lines);
end $function$;

-- ── the backfill stops posting service charges ─────────────────────────────
-- Its loop debited the 1170 control account under the key car_post_charge also
-- uses, so which account a charge landed in came down to which ran first. With
-- the monthly voucher keyed differently they would both post and every charge
-- would be counted twice. The monthly voucher is the only thing that posts a
-- service charge now.
create or replace function public.car_sync_company(p_company uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare r record; n int := 0;
begin
  perform car_ensure_accounts(p_company);
  for r in select vehicle_no, purchase_date, total_cost from car_vehicles where company_id = p_company and total_cost > 0 and status <> 'cancelled' loop
    if car_post_entry(p_company, r.purchase_date, 'Vehicle purchase ' || r.vehicle_no, 'car_purchase', r.vehicle_no,
        jsonb_build_array(jsonb_build_object('code','1160','debit',r.total_cost), jsonb_build_object('code','2100','credit',r.total_cost))) then n := n + 1; end if;
  end loop;
  for r in select contract_no, contract_date, sale_price, advance, purchase_cost from car_contracts where company_id = p_company and status in ('active','completed') loop
    if car_post_entry(p_company, r.contract_date, 'Vehicle sale ' || r.contract_no, 'car_sale', r.contract_no,
        jsonb_build_array(jsonb_build_object('code','1150','debit',r.sale_price), jsonb_build_object('code','4200','credit',r.sale_price),
                          jsonb_build_object('code','5100','debit',r.purchase_cost), jsonb_build_object('code','1160','credit',r.purchase_cost))) then n := n + 1; end if;
    if coalesce(r.advance,0) > 0 then
      if car_post_entry(p_company, r.contract_date, 'Advance ' || r.contract_no, 'car_advance', r.contract_no,
          jsonb_build_array(jsonb_build_object('code','1000','debit',r.advance), jsonb_build_object('code','1150','credit',r.advance))) then n := n + 1; end if;
    end if;
  end loop;
  for r in select receipt_no, receipt_date, amount, method from car_receipts where company_id = p_company loop
    if car_post_entry(p_company, r.receipt_date, 'Installment receipt ' || r.receipt_no, 'car_receipt', r.receipt_no,
        jsonb_build_array(jsonb_build_object('code', case when r.method='cash' then '1000' else '1010' end, 'debit', r.amount),
                          jsonb_build_object('code','1150','credit', r.amount))) then n := n + 1; end if;
  end loop;
  -- (the service-charge loop that used to sit here is gone — see above)
  for r in select p.id, p.pay_date, p.amount, p.method from car_service_charge_payments p join car_service_charges c on c.id = p.charge_id where c.company_id = p_company loop
    if car_post_entry(p_company, r.pay_date, 'Service charge payment', 'car_scharge_pay', r.id::text,
        jsonb_build_array(jsonb_build_object('code', case when r.method='cash' then '1000' else '1010' end, 'debit', r.amount),
                          jsonb_build_object('code','1170','credit', r.amount))) then n := n + 1; end if;
  end loop;
  for r in select cm.amount, ct.contract_no from car_commissions cm join car_contracts ct on ct.id = cm.contract_id where cm.company_id = p_company and cm.amount > 0 loop
    if car_post_entry(p_company, current_date, 'Commission ' || r.contract_no, 'car_commission', r.contract_no,
        jsonb_build_array(jsonb_build_object('code','6300','debit',r.amount), jsonb_build_object('code','2110','credit',r.amount))) then n := n + 1; end if;
  end loop;
  return n;
end $function$;

-- ── the monthly job raises the month's voucher ─────────────────────────────
create or replace function public.car_monthly_run(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare c uuid; v_companies int := 0; v_charges int := 0; v_posted int := 0; v_vouchers int := 0;
        m date;
begin
  if p_secret is null or p_secret <> (select secret from cron_config) then
    raise exception 'Bad cron secret';
  end if;
  for c in select distinct company_id from car_vehicles loop
    v_companies := v_companies + 1;
    v_charges := v_charges + car_gen_charges_company(c);
    v_posted := v_posted + car_sync_company(c);
    -- Every month that has charges and has not been raised yet. Past months are
    -- included on purpose: a job that failed to run in March must still raise
    -- March, and the key makes re-raising it impossible.
    for m in select distinct charge_month from car_service_charges
              where company_id = c and amount > 0 order by 1
    loop
      if car_post_charges_month(c, m) then v_vouchers := v_vouchers + 1; end if;
    end loop;
  end loop;
  return jsonb_build_object('companies', v_companies, 'charges_created', v_charges,
                            'journals_posted', v_posted, 'monthly_vouchers', v_vouchers);
end $function$;
revoke all on function public.car_monthly_run(text) from public;
grant execute on function public.car_monthly_run(text) to anon, authenticated;

do $chk$
begin
  -- the proration rule, stated as a test rather than as a comment
  if car_charge_for_month('2026-09-01', '2026-09-01', 1000) <> 1000 then raise exception '350: 1st should be full'; end if;
  if car_charge_for_month('2026-09-01', '2026-09-04', 1000) <> 1000 then raise exception '350: 4th should be full'; end if;
  if car_charge_for_month('2026-09-01', '2026-09-05', 1000) <>  500 then raise exception '350: 5th should be half'; end if;
  if car_charge_for_month('2026-09-01', '2026-09-15', 1000) <>  500 then raise exception '350: 15th should be half'; end if;
  if car_charge_for_month('2026-09-01', '2026-09-16', 1000) <>    0 then raise exception '350: 16th should be nothing'; end if;
  if car_charge_for_month('2026-09-01', '2026-09-30', 1000) <>    0 then raise exception '350: 30th should be nothing'; end if;
  if car_charge_for_month('2026-10-01', '2026-09-16', 1000) <> 1000 then raise exception '350: the month after is always full'; end if;
  if car_charge_for_month('2026-08-01', '2026-09-01', 1000) <>    0 then raise exception '350: before delivery is nothing'; end if;
  if car_charge_for_month('2026-09-01', null, 1000)         <>    0 then raise exception '350: undelivered is nothing'; end if;
  -- and the double post is gone
  if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='car_sync_company') like '%car_scharge''%' then
    raise exception '350: car_sync_company still posts service charges';
  end if;
end $chk$;

commit;
