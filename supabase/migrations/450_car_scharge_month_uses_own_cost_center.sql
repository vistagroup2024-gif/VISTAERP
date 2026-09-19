-- Monthly Service Charges income belongs to its own line of business, not
-- to whichever cost centre the sold vehicle happens to carry. Migration 448
-- split the credit line by car_cost_center(vehicle_id), inheriting
-- CAR SALES INSTALLMENT/CAR TRADING — wrong. The chart already has a
-- dedicated cost centre for exactly this (MONTHLY CAR SERVICE CHARGES,
-- under the SERVICE CHARGES group), so the credit line is a single line
-- fixed to it, the same way car_cost_center() itself hardcodes its own
-- fallback cost centre names.
create or replace function public.car_post_charges_month(p_company uuid, p_month date)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'description', 'Monthly service charges ' || to_char(v_month, 'Mon YYYY'),
    'cost_center', 'MONTHLY CAR SERVICE CHARGES'));

  return car_post_entry(p_company, v_month,
    'Monthly service charges ' || to_char(v_month, 'Mon YYYY'),
    'car_scharge_month', p_company::text || '-' || to_char(v_month, 'YYYY-MM'),
    v_lines);
end $function$;

-- Backfill: regenerate any car_scharge_month entry whose credit line isn't
-- yet on MONTHLY CAR SERVICE CHARGES, through the fixed routine.
do $backfill$
declare r record; v_month date;
begin
  for r in
    select distinct e.company_id, e.reference, e.entry_date
      from journal_entries e
      join journal_lines jl on jl.entry_id = e.id
     where e.source = 'car_scharge_month' and e.status = 'posted'
       and jl.credit > 0 and coalesce(jl.cost_center,'') <> 'MONTHLY CAR SERVICE CHARGES'
  loop
    v_month := date_trunc('month', r.entry_date)::date;
    delete from journal_lines where entry_id in (
      select id from journal_entries where company_id = r.company_id and source = 'car_scharge_month' and reference = r.reference);
    delete from journal_entries where company_id = r.company_id and source = 'car_scharge_month' and reference = r.reference;
    perform car_post_charges_month(r.company_id, v_month);
  end loop;
end $backfill$;
