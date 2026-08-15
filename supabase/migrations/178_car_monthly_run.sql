-- 178 Car Sales — scheduled automation: monthly charge generation + accounting post.
--
-- Company-scoped helpers (no auth guard) power both the interactive buttons and a
-- cron job that runs across ALL companies. car_monthly_run() is called from the
-- /api/cron/car-sales route (guarded by CRON_SECRET) on a monthly schedule.
--
-- NOTE: run this against the DB (Supabase SQL editor or MCP).

-- Charge generation for one company (idempotent; same rules as migration 175).
create or replace function public.car_gen_charges_company(p_company uuid, p_asof date default current_date)
returns int language plpgsql security definer set search_path to 'public' as $$
declare m date; v_end date; n int := 0; v_rec record;
begin
  v_end := date_trunc('month', p_asof)::date;
  for v_rec in
    select id, purchase_date, coalesce(monthly_charge,1000) as amt, current_customer_id, contract_id
    from car_vehicles where company_id = p_company and ownership = 'vista' and purchase_date is not null
  loop
    m := date_trunc('month', v_rec.purchase_date)::date;
    while m <= v_end loop
      insert into car_service_charges(company_id, vehicle_id, contract_id, customer_id, charge_month, due_date, amount)
      values (p_company, v_rec.id, v_rec.contract_id, v_rec.current_customer_id, m, (m + interval '1 month')::date, v_rec.amt)
      on conflict (vehicle_id, charge_month) do nothing;
      if found then n := n + 1; end if;
      m := (m + interval '1 month')::date;
    end loop;
  end loop;
  return n;
end $$;

-- Accounting post for one company (idempotent; same postings as migration 177).
create or replace function public.car_sync_company(p_company uuid)
returns int language plpgsql security definer set search_path to 'public' as $$
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
  for r in select id, charge_month, amount from car_service_charges where company_id = p_company loop
    if car_post_entry(p_company, r.charge_month, 'Monthly service charge', 'car_scharge', r.id::text,
        jsonb_build_array(jsonb_build_object('code','1170','debit',r.amount), jsonb_build_object('code','4300','credit',r.amount))) then n := n + 1; end if;
  end loop;
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
end $$;

-- Interactive wrappers now delegate to the company helpers.
create or replace function public.car_generate_service_charges(p_asof date default current_date)
returns int language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := auth_company_id(); n int;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  n := car_gen_charges_company(v_company, p_asof);
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_company, auth.uid(), 'car_service_charges_generated', 'car_service_charge', null, jsonb_build_object('created', n));
  return n;
end $$;
revoke all on function public.car_generate_service_charges(date) from anon;
grant execute on function public.car_generate_service_charges(date) to authenticated;

create or replace function public.car_accounting_sync()
returns int language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := auth_company_id(); n int;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  n := car_sync_company(v_company);
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_company, auth.uid(), 'car_accounting_sync', 'car', null, jsonb_build_object('posted', n));
  return n;
end $$;
revoke all on function public.car_accounting_sync() from anon;
grant execute on function public.car_accounting_sync() to authenticated;

-- Cron entry point: generate charges + post accounting across every company.
create or replace function public.car_monthly_run()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare c uuid; v_companies int := 0; v_charges int := 0; v_posted int := 0;
begin
  for c in select distinct company_id from car_vehicles loop
    v_companies := v_companies + 1;
    v_charges := v_charges + car_gen_charges_company(c);
    v_posted := v_posted + car_sync_company(c);
  end loop;
  return jsonb_build_object('companies', v_companies, 'charges_created', v_charges, 'journals_posted', v_posted);
end $$;
