-- Sales Report Phase 2: report_cost_center_targets() gains cost_center_group
-- (the leaf's parent group — UMRAH PACKAGE, TRADING, TRANSPORT, SERVICE
-- CHARGES, RENTAL, MAINS all already exist as real groups in the chart, per
-- the spec's own example list) so Target vs Actual can roll up by group as
-- well as by cost centre — purely additive, every existing consumer
-- (Targets & Budget, Sales Report's own chart) is unaffected.
-- report_sales()'s by_customer gains account_id (the ledger account behind
-- the party) so a customer row can drill to /accounting/customers/[id].
create or replace function public.report_cost_center_targets(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE sql STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'cost_center', cc.name, 'cost_center_group', coalesce(pg.name, cc.name),
    'target', cc.sales_target, 'actual', coalesce(a.actual,0),
    'variance', coalesce(a.actual,0) - cc.sales_target) order by cc.name), '[]'::jsonb)
  from acct_cost_centers cc
  left join acct_cost_centers pg on pg.id = cc.parent_id
  left join (
    select l.cost_center, sum(l.credit - l.debit) actual
    from journal_lines l join journal_entries e on e.id = l.entry_id join accounts ac on ac.id = l.account_id
    where e.company_id = auth_company_id() and e.status = 'posted' and ac.type = 'income'
      and (p_from is null or e.entry_date >= p_from) and (p_to is null or e.entry_date <= p_to)
    group by l.cost_center) a on a.cost_center = cc.name
  where cc.company_id = auth_company_id() and cc.is_group = false;
$function$;

create or replace function public.report_sales(p_company uuid, p_from date, p_to date)
 RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
with sales_docs as (
  select d.doc_date as sdate, d.total, d.party_id as customer_id, d.cost_center, d.id as doc_id, true as is_trade
    from trade_documents d
   where d.company_id = p_company
     and d.doc_type in ('sales_invoice','air_ticket_invoice','visa_invoice','transport_invoice','hotel_invoice')
     and d.gl_entry is not null
     and d.doc_date between coalesce(p_from, '0001-01-01') and coalesce(p_to, '9999-12-31')
  union all
  select c.contract_date, c.net_payable, c.customer_id, c.cost_center, c.id, false
    from car_contracts c
   where c.company_id = p_company and c.status in ('active', 'completed')
     and c.contract_date between coalesce(p_from, '0001-01-01') and coalesce(p_to, '9999-12-31')
),
by_month as (
  select to_char(sdate, 'YYYY-MM') as month, sum(total) as amount, count(*) as txns
  from sales_docs group by 1
),
by_cc as (
  select coalesce(cost_center, 'Unassigned') as name, sum(total) as amount, count(*) as txns
  from sales_docs group by 1
),
by_customer as (
  select coalesce(p.name, 'Unspecified') as name, acc.id as account_id, sum(sd.total) as amount, count(*) as txns
  from sales_docs sd left join parties p on p.id = sd.customer_id
  left join accounts acc on acc.party_id = p.id
  group by 1, 2
),
by_product_raw as (
  select coalesce(l.item_name, ap.name, 'Item') as name, sum(l.quantity) as qty, sum(l.amount) as amount
  from sales_docs sd
  join trade_document_lines l on l.doc_id = sd.doc_id and sd.is_trade
  left join acct_products ap on ap.id = l.product_id
  group by 1
  union all
  select coalesce(ap.name, nullif(trim(concat_ws(' ', v.model_year::text, v.make, v.model, v.variant)), ''), 'Car Sale') as name,
    1 as qty, sd.total as amount
  from sales_docs sd
  join car_contracts c on c.id = sd.doc_id and not sd.is_trade
  left join car_vehicles v on v.id = c.vehicle_id
  left join acct_products ap on ap.id = v.product_id
),
by_product as (
  select name, sum(qty) as qty, sum(amount) as amount from by_product_raw group by 1
)
select jsonb_build_object(
  'total', (select coalesce(sum(total), 0) from sales_docs),
  'txns', (select count(*) from sales_docs),
  'monthly', (select coalesce(jsonb_agg(jsonb_build_object('month', month, 'amount', amount, 'txns', txns) order by month), '[]'::jsonb) from by_month),
  'by_cost_centre', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'amount', amount, 'txns', txns) order by amount desc), '[]'::jsonb) from by_cc),
  'by_customer', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'account_id', account_id, 'amount', amount, 'txns', txns) order by amount desc), '[]'::jsonb) from by_customer),
  'by_product', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'qty', qty, 'amount', amount) order by amount desc), '[]'::jsonb) from by_product)
);
$function$;

revoke all on function public.report_cost_center_targets(date, date) from public, anon;
grant execute on function public.report_cost_center_targets(date, date) to authenticated;
revoke all on function public.report_sales(uuid, date, date) from public, anon;
grant execute on function public.report_sales(uuid, date, date) to authenticated;

do $chk$
declare
  v_company uuid := '96f6b539-b491-4df7-91a2-80c7c8e7491d';
  v_admin uuid := 'edf3fa71-27e2-4cb1-af62-9afd685abefe';
  v_sales jsonb; v_targets jsonb;
  v_bp_sum numeric; v_total numeric; v_bc_sum numeric;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);

  select public.report_sales(v_company, '2000-01-01', current_date) into v_sales;
  select coalesce(sum((r->>'amount')::numeric), 0) into v_bp_sum from jsonb_array_elements(v_sales->'by_product') r;
  select coalesce(sum((r->>'amount')::numeric), 0) into v_bc_sum from jsonb_array_elements(v_sales->'by_customer') r;
  v_total := (v_sales->>'total')::numeric;
  if abs(v_bp_sum - v_total) > 0.01 then raise exception 'by_product sum % != total %', v_bp_sum, v_total; end if;
  if abs(v_bc_sum - v_total) > 0.01 then raise exception 'by_customer sum % != total %', v_bc_sum, v_total; end if;

  select public.report_cost_center_targets('2000-01-01', current_date) into v_targets;
  if exists (select 1 from jsonb_array_elements(v_targets) r where r->>'cost_center_group' is null) then
    raise exception 'cost_center_group has null entries';
  end if;

  raise notice 'phase 2 sales self-check passed: total=%, by_customer_sum=%', v_total, v_bc_sum;
end;
$chk$;
