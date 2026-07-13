-- ============================================================
-- VISTA ERP - 015 BRN Inventory & Umrah Group amendments
-- - BRN supplier + rate + auto Accounts Payable bill
-- - City-aware per-night allocation (Madinah night 1, Makkah rest)
-- - Visa Issued status with BRN lock + audit log
-- (Applied to the remote DB via Supabase MCP; kept here for history.)
-- ============================================================

-- ---- BRN purchase/supplier fields ----
alter table brn_inventory add column if not exists supplier_id  uuid references parties(id) on delete set null;
alter table brn_inventory add column if not exists rate_per_bed  numeric(18,2) not null default 0;
alter table brn_inventory add column if not exists cost_currency char(3) references currencies(code) default 'SAR';
alter table brn_inventory add column if not exists bill_id       uuid references bills(id) on delete set null;

-- ---- Umrah group visa-issued audit fields ----
alter table umrah_groups add column if not exists visa_issued_at timestamptz;
alter table umrah_groups add column if not exists visa_issued_by uuid references auth.users(id) on delete set null;

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  action text not null, entity text, entity_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_log_entity on audit_log(entity, entity_id);
alter table audit_log enable row level security;
create policy audit_log_staff on audit_log for select to authenticated
  using (company_id = auth_company_id() and is_staff());

-- ---- add_brn: insert BRN + auto AP bill (beds * rate) ----
create or replace function add_brn(
  p_hotel_name text, p_brn text, p_city text, p_check_in date, p_check_out date, p_beds integer,
  p_supplier_id uuid default null, p_rate_per_bed numeric default 0,
  p_cost_currency char(3) default 'SAR', p_remarks text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_brn_id uuid; v_bill_id uuid; v_total numeric(18,2); v_bill_no text;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if p_check_out <= p_check_in then raise exception 'Check-out must be after check-in'; end if;
  if p_beds <= 0 then raise exception 'Beds must be greater than zero'; end if;
  v_company := auth_company_id();
  insert into brn_inventory(company_id, hotel_name, brn, city, check_in, check_out, beds,
                            supplier_id, rate_per_bed, cost_currency, remarks)
  values (v_company, p_hotel_name, p_brn, p_city, p_check_in, p_check_out, p_beds,
          p_supplier_id, coalesce(p_rate_per_bed,0), coalesce(p_cost_currency,'SAR'), p_remarks)
  returning id into v_brn_id;
  if p_supplier_id is not null and coalesce(p_rate_per_bed,0) > 0 then
    v_total := round(p_beds * p_rate_per_bed, 2);
    v_bill_no := next_doc_number(v_company, 'bill');
    insert into bills(company_id, bill_no, supplier_id, bill_date, currency, fx_rate,
                      subtotal, tax_amount, total, status, notes)
    values (v_company, v_bill_no, p_supplier_id, current_date, coalesce(p_cost_currency,'SAR'), 1,
            v_total, 0, v_total, 'issued',
            'BRN '||p_brn||' — '||p_hotel_name||' ('||p_beds||' beds @ '||p_rate_per_bed||')')
    returning id into v_bill_id;
    insert into bill_lines(bill_id, description, qty, unit_price, line_total)
    values (v_bill_id, 'Hotel beds '||p_brn||' — '||p_hotel_name, p_beds, p_rate_per_bed, v_total);
    perform post_bill_expense(v_bill_id);
    update brn_inventory set bill_id = v_bill_id where id = v_brn_id;
  end if;
  return v_brn_id;
end;
$$;
revoke all on function add_brn(text,text,text,date,date,integer,uuid,numeric,char,text) from anon, public;
grant execute on function add_brn(text,text,text,date,date,integer,uuid,numeric,char,text) to authenticated;

-- ---- City-aware per-night allocation ----
-- Rule: night 1 = Madinah IF Madinah can cover the whole group that night,
-- otherwise the entire stay falls back to Makkah. Remaining nights = Makkah.
create or replace function allocate_group_brns(p_group uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  grp umrah_groups%rowtype; n date; seg_city text; need integer;
  rec record; take integer; run record; v_cons uuid;
  v_mad_avail integer; v_night1_city text;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into grp from umrah_groups where id = p_group for update;
  if not found then raise exception 'Group not found'; end if;
  if grp.visa_status = 'issued' then raise exception 'Visa already issued — reopen the group to change allocation'; end if;
  if grp.brn_status = 'allocated' then raise exception 'Group % already has BRNs allocated', grp.group_no; end if;

  -- Madinah availability on the arrival night; if it can't cover all pax, use all-Makkah.
  select coalesce(sum(inv.beds - coalesce((
            select sum(c.beds) from brn_consumption c
            where c.brn_id = inv.id and c.check_in <= grp.arrival_date and c.check_out > grp.arrival_date), 0)), 0)
    into v_mad_avail
  from brn_inventory inv
  where inv.company_id = grp.company_id and inv.city = 'Madinah'
    and inv.check_in <= grp.arrival_date and inv.check_out > grp.arrival_date;
  if v_mad_avail >= grp.pax then v_night1_city := 'Madinah'; else v_night1_city := 'Makkah'; end if;

  drop table if exists _alloc;
  create temp table _alloc(brn_id uuid, night date, beds int) on commit drop;

  for n in select d::date from generate_series(grp.arrival_date, grp.departure_date - interval '1 day', interval '1 day') d loop
    if n = grp.arrival_date then seg_city := v_night1_city; else seg_city := 'Makkah'; end if;
    need := grp.pax;
    for rec in
      select inv.id,
        (inv.beds
          - coalesce((select sum(c.beds) from brn_consumption c where c.brn_id = inv.id and c.check_in <= n and c.check_out > n), 0)
          - coalesce((select sum(a.beds) from _alloc a where a.brn_id = inv.id and a.night = n), 0)) as avail,
        (select 1 from _alloc a2 where a2.brn_id = inv.id and a2.night = n - 1 limit 1) as active_prev
      from brn_inventory inv
      where inv.company_id = grp.company_id and inv.city = seg_city
        and inv.check_in <= n and inv.check_out > n
      order by active_prev desc nulls last, avail desc
    loop
      exit when need <= 0;
      if rec.avail is null or rec.avail <= 0 then continue; end if;
      take := least(need, rec.avail);
      insert into _alloc values (rec.id, n, take);
      need := need - take;
    end loop;
    if need > 0 then
      raise exception 'Insufficient % inventory on %: short by % bed(s) for group %',
        seg_city, to_char(n, 'DD Mon YYYY'), need, grp.group_no;
    end if;
  end loop;

  for rec in select distinct brn_id from _alloc loop
    for run in
      select min(night) as start_night, max(night) as end_night, beds
      from (select night, beds, night - (dense_rank() over (partition by beds order by night))::int as island
            from _alloc where brn_id = rec.brn_id) s
      group by beds, island order by 1
    loop
      v_cons := consume_brn(rec.brn_id, run.start_night, run.end_night + 1, run.beds, grp.group_no, 'Auto-allocated');
      insert into group_brn_allocation(company_id, group_id, brn_id, consumption_id, beds)
      values (grp.company_id, p_group, rec.brn_id, v_cons, run.beds);
    end loop;
  end loop;

  drop table if exists _alloc;
  update umrah_groups set brn_status = 'allocated' where id = p_group;
  return grp.pax;
end;
$$;

create or replace function deallocate_group_brns(p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
declare g umrah_groups%rowtype;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into g from umrah_groups where id = p_group;
  if g.visa_status = 'issued' then raise exception 'BRNs are locked — visa already issued. Reopen the group first.'; end if;
  delete from brn_consumption where id in (
    select consumption_id from group_brn_allocation where group_id = p_group and consumption_id is not null);
  delete from group_brn_allocation where group_id = p_group;
  update umrah_groups set brn_status = 'pending' where id = p_group;
end;
$$;

create or replace function mark_visa_issued(p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
declare g umrah_groups%rowtype;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into g from umrah_groups where id = p_group for update;
  if not found then raise exception 'Group not found'; end if;
  if g.brn_status <> 'allocated' then raise exception 'Allocate BRNs before issuing the visa'; end if;
  update umrah_groups set visa_status = 'issued', visa_issued_at = now(), visa_issued_by = auth.uid() where id = p_group;
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (g.company_id, auth.uid(), 'visa_issued', 'umrah_group', p_group, jsonb_build_object('group_no', g.group_no));
end;
$$;

create or replace function reopen_group(p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
declare g umrah_groups%rowtype;
begin
  if not has_role('admin') then raise exception 'Only an admin can reopen an issued group'; end if;
  select * into g from umrah_groups where id = p_group for update;
  if not found then raise exception 'Group not found'; end if;
  update umrah_groups set visa_status = 'pending', visa_issued_at = null, visa_issued_by = null where id = p_group;
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (g.company_id, auth.uid(), 'group_reopened', 'umrah_group', p_group, jsonb_build_object('group_no', g.group_no));
end;
$$;

revoke all on function mark_visa_issued(uuid) from anon, public;
revoke all on function reopen_group(uuid) from anon, public;
grant execute on function mark_visa_issued(uuid) to authenticated;
grant execute on function reopen_group(uuid) to authenticated;
