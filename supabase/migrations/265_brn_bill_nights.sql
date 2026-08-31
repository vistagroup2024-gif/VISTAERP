-- 265_brn_bill_nights.sql
-- The BRN supplier bill ignored the length of stay: it charged beds x rate, so a
-- 1-10 Sep booking of 10 beds at 2/night billed 20 instead of 180. A bed rate is
-- per night, so the cost is nights x beds x rate, where nights is the difference
-- between check-out and check-in (1 Sep -> 10 Sep = 9 nights).
--
-- The bill line now carries the nights in its quantity so the document shows how
-- the total was reached.

create or replace function add_brn(
  p_group_company_id uuid, p_hotel_name text, p_brn text, p_city text,
  p_check_in date, p_check_out date, p_beds integer, p_supplier_id uuid default null,
  p_rate_per_bed numeric default 0, p_cost_currency char(3) default 'SAR', p_remarks text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_brn_id uuid; v_bill_id uuid; v_total numeric(18,2); v_bill_no text; v_nights int;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if p_group_company_id is null then raise exception 'Company is required'; end if;
  if p_check_out <= p_check_in then raise exception 'Check-out must be after check-in'; end if;
  if p_beds <= 0 then raise exception 'Beds must be greater than zero'; end if;
  v_company := auth_company_id();
  v_nights := p_check_out - p_check_in;

  insert into brn_inventory(company_id, group_company_id, hotel_name, brn, city, check_in, check_out, beds,
                            supplier_id, rate_per_bed, cost_currency, remarks)
  values (v_company, p_group_company_id, p_hotel_name, p_brn, p_city, p_check_in, p_check_out, p_beds,
          p_supplier_id, coalesce(p_rate_per_bed,0), coalesce(p_cost_currency,'SAR'), p_remarks)
  returning id into v_brn_id;

  if p_supplier_id is not null and coalesce(p_rate_per_bed,0) > 0 then
    -- Bed rates are per night: nights x beds x rate.
    v_total := round(v_nights * p_beds * p_rate_per_bed, 2);
    v_bill_no := next_doc_number(v_company, 'bill');
    insert into bills(company_id, bill_no, supplier_id, bill_date, currency, fx_rate,
                      subtotal, tax_amount, total, status, notes)
    values (v_company, v_bill_no, p_supplier_id, current_date, coalesce(p_cost_currency,'SAR'), 1,
            v_total, 0, v_total, 'issued',
            'BRN '||p_brn||' — '||p_hotel_name||' ('||v_nights||' nights x '||p_beds||' beds @ '||p_rate_per_bed||')')
    returning id into v_bill_id;
    insert into bill_lines(bill_id, description, qty, unit_price, line_total)
    values (v_bill_id,
            'Hotel beds '||p_brn||' — '||p_hotel_name||' ('||v_nights||' nights x '||p_beds||' beds)',
            v_nights * p_beds, p_rate_per_bed, v_total);
    perform post_bill_expense(v_bill_id);
    update brn_inventory set bill_id = v_bill_id where id = v_brn_id;
  end if;
  return v_brn_id;
end $$;
revoke all on function add_brn(uuid,text,text,text,date,date,integer,uuid,numeric,char,text) from anon, public;
grant execute on function add_brn(uuid,text,text,text,date,date,integer,uuid,numeric,char,text) to authenticated;
