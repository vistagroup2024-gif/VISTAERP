-- ============================================================
-- VISTA ERP - 024 Company-based BRN inventory & allocation
-- - brn_inventory.group_company_id (mandatory via add_brn)
-- - allocation only uses BRNs of the group's own company
-- (Applied to remote DB via Supabase MCP; kept here for history.)
-- Active/Archived split, company filters and company-wise planning are
-- computed in the app layer (no schema change).
-- ============================================================

alter table brn_inventory add column if not exists group_company_id uuid references group_companies(id) on delete set null;
create index if not exists idx_brn_group_company on brn_inventory(group_company_id);
update brn_inventory set group_company_id = (select id from group_companies order by created_at limit 1)
where group_company_id is null;

drop function if exists add_brn(text,text,text,date,date,integer,uuid,numeric,char,text);
create or replace function add_brn(
  p_group_company_id uuid,
  p_hotel_name text, p_brn text, p_city text, p_check_in date, p_check_out date, p_beds integer,
  p_supplier_id uuid default null, p_rate_per_bed numeric default 0,
  p_cost_currency char(3) default 'SAR', p_remarks text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_brn_id uuid; v_bill_id uuid; v_total numeric(18,2); v_bill_no text;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if p_group_company_id is null then raise exception 'Company is required'; end if;
  if p_check_out <= p_check_in then raise exception 'Check-out must be after check-in'; end if;
  if p_beds <= 0 then raise exception 'Beds must be greater than zero'; end if;
  v_company := auth_company_id();
  insert into brn_inventory(company_id, group_company_id, hotel_name, brn, city, check_in, check_out, beds,
                            supplier_id, rate_per_bed, cost_currency, remarks)
  values (v_company, p_group_company_id, p_hotel_name, p_brn, p_city, p_check_in, p_check_out, p_beds,
          p_supplier_id, coalesce(p_rate_per_bed,0), coalesce(p_cost_currency,'SAR'), p_remarks)
  returning id into v_brn_id;
  if p_supplier_id is not null and coalesce(p_rate_per_bed,0) > 0 then
    v_total := round(p_beds * p_rate_per_bed, 2);
    v_bill_no := next_doc_number(v_company, 'bill');
    insert into bills(company_id, bill_no, supplier_id, bill_date, currency, fx_rate,
                      subtotal, tax_amount, total, status, notes)
    values (v_company, v_bill_no, p_supplier_id, current_date, coalesce(p_cost_currency,'SAR'), 1,
            v_total, 0, v_total, 'issued', 'BRN '||p_brn||' — '||p_hotel_name)
    returning id into v_bill_id;
    insert into bill_lines(bill_id, description, qty, unit_price, line_total)
    values (v_bill_id, 'Hotel beds '||p_brn||' — '||p_hotel_name, p_beds, p_rate_per_bed, v_total);
    perform post_bill_expense(v_bill_id);
    update brn_inventory set bill_id = v_bill_id where id = v_brn_id;
  end if;
  return v_brn_id;
end $$;
revoke all on function add_brn(uuid,text,text,text,date,date,integer,uuid,numeric,char,text) from anon, public;
grant execute on function add_brn(uuid,text,text,text,date,date,integer,uuid,numeric,char,text) to authenticated;

-- sim_plan and allocate_group_brns now filter BRNs by
--   inv.group_company_id is not distinct from grp.group_company_id
-- (full bodies applied via MCP; see functions in the database).
