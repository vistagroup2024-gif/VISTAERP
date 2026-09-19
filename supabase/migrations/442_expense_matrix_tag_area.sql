-- "make tag area also we can see tag area with whome we want" — Tag Area
-- was left as the one exclusive alternate in 441 (picking it cleared the
-- other four, picking any of the other four cleared it), reasoning it was
-- a genuinely different dimension from the cost-centre/account hierarchy.
-- The owner wants full flexibility instead: Tag Area combines with any of
-- CC Group / Cost Center / Account Group / Account Name too, same as they
-- already combine with each other. report_expense_matrix() (441) already
-- proved this shape works for two independent dimensions on the same row
-- (cost centre and account); this extends it to a third (tag area), the
-- same single-level parent_id join cost_center_group/account_group
-- already use, off acct_tag_areas the same way report_tag_area_costing()
-- reads it.
create or replace function public.report_expense_matrix(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with exp as (
  select coalesce(l.cost_center, 'Unassigned') as cost_center, l.account_id,
    coalesce(l.tag_area, 'Unassigned') as tag_area, e.entry_date, (l.debit - l.credit) as amount
  from journal_lines l
  join journal_entries e on e.id = l.entry_id
  join accounts a on a.id = l.account_id
  where e.company_id = auth_company_id() and e.status = 'posted'
    and a.type = 'expense' and coalesce(a.subtype, '') <> 'COGS'
    and (p_from is null or e.entry_date >= p_from) and (p_to is null or e.entry_date <= p_to)
),
cc_lookup as (
  select cc.id, cc.name, coalesce(pg.name, cc.name) as grp
  from acct_cost_centers cc left join acct_cost_centers pg on pg.id = cc.parent_id
  where cc.company_id = auth_company_id() and cc.is_group = false
),
acc_lookup as (
  select ac.id, ac.name, coalesce(pg.name, ac.name) as grp
  from accounts ac left join accounts pg on pg.id = ac.parent_id
  where ac.company_id = auth_company_id() and ac.type = 'expense' and ac.is_postable
),
ta_lookup as (
  select ta.id, ta.name, coalesce(pg.name, ta.name) as grp
  from acct_tag_areas ta left join acct_tag_areas pg on pg.id = ta.parent_id
  where ta.company_id = auth_company_id() and ta.is_group = false
),
agg as (
  select cost_center, account_id, tag_area, to_char(entry_date, 'YYYY-MM') as month, sum(amount) as amount
  from exp group by 1, 2, 3, 4
)
select coalesce(jsonb_agg(jsonb_build_object(
    'cost_center_id', cc.id, 'cost_center', coalesce(cc.name, x.cost_center), 'cost_center_group', coalesce(cc.grp, x.cost_center),
    'account_id', x.account_id, 'account', ac.name, 'account_group', ac.grp,
    'tag_area_id', ta.id, 'tag_area', coalesce(ta.name, x.tag_area), 'tag_area_group', coalesce(ta.grp, x.tag_area),
    'month', x.month, 'amount', x.amount
  )), '[]'::jsonb)
from agg x
left join cc_lookup cc on cc.name = x.cost_center
join acc_lookup ac on ac.id = x.account_id
left join ta_lookup ta on ta.name = x.tag_area;
$function$;

revoke all on function public.report_expense_matrix(date, date) from public, anon;
grant execute on function public.report_expense_matrix(date, date) to authenticated;

do $chk$
declare
  v_admin   uuid := 'edf3fa71-27e2-4cb1-af62-9afd685abefe';
  v_year    int  := extract(year from current_date)::int;
  v_result  jsonb;
  v_matrix_total numeric;
  v_direct_total numeric;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);

  select public.report_expense_matrix(make_date(v_year,1,1), make_date(v_year,12,31)) into v_result;
  select coalesce(sum((r->>'amount')::numeric), 0) into v_matrix_total from jsonb_array_elements(v_result) r;

  select coalesce(sum(l.debit - l.credit), 0) into v_direct_total
  from journal_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id
  where e.company_id = '96f6b539-b491-4df7-91a2-80c7c8e7491d' and e.status = 'posted'
    and a.type = 'expense' and coalesce(a.subtype, '') <> 'COGS' and a.is_postable
    and e.entry_date between make_date(v_year,1,1) and make_date(v_year,12,31);

  if abs(v_matrix_total - v_direct_total) > 0.01 then
    raise exception 'report_expense_matrix self-check: total % does not match direct sum %', v_matrix_total, v_direct_total;
  end if;

  raise notice 'self-check passed: matrix total=%, rows=%', v_matrix_total, jsonb_array_length(v_result);
end;
$chk$;
