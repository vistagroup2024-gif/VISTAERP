-- Expenses Filteration was built wrong in 440: CC Group/Cost Center and
-- Account Group/Account Name were two separate "families" a user could only
-- pick ONE of at a time — but the owner wants exactly what the button row
-- promises: any combination, freely, e.g. Cost Center AND Account Name
-- together (a cost centre's rows drilling into its own accounts). That
-- needs the SAME underlying rows taggable by BOTH cost centre and account
-- at once, not two separate per-dimension RPCs the client picked one of.
--
-- report_expense_matrix() is that one flat source: the finest grain this
-- report needs — one row per (cost centre, account, month) — carrying both
-- dimensions' ids, names and groups together. The client groups by
-- whichever of the four fields (cost_center_group, cost_center,
-- account_group, account) are toggled on, in that fixed order, nesting
-- only the ones actually selected — Cost Center + Account Name selected
-- means a 2-level tree (cost centre -> account), skipping the two group
-- levels entirely, rather than being stuck choosing one whole hierarchy.
-- Tag Area stays on its own report_tag_area_costing() call, unchanged — it
-- is a genuinely alternate dimension (a line's tag_area, not a level of
-- either the cost-centre or account hierarchy), so it stays the exclusive
-- fifth option it already was.
--
-- Same "expense" definition as 440's report_expense_by_account() (COGS
-- excluded, matching dashboard_metrics()'s Expenses card) — that function
-- is left in place (nothing else calls it, and dropping a function nothing
-- references is not worth its own migration risk) but the client no longer
-- calls it; report_expense_matrix() replaces it, and also replaces reading
-- report_cost_centre_costing() for this report's own "Cost Center Wise
-- Expenses" panel, so this screen now has one flat source for every
-- CC/Account-side figure instead of three.
create or replace function public.report_expense_matrix(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with exp as (
  select coalesce(l.cost_center, 'Unassigned') as cost_center, l.account_id, e.entry_date, (l.debit - l.credit) as amount
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
agg as (
  select cost_center, account_id, to_char(entry_date, 'YYYY-MM') as month, sum(amount) as amount
  from exp group by 1, 2, 3
)
select coalesce(jsonb_agg(jsonb_build_object(
    'cost_center_id', cc.id, 'cost_center', coalesce(cc.name, x.cost_center), 'cost_center_group', coalesce(cc.grp, x.cost_center),
    'account_id', x.account_id, 'account', ac.name, 'account_group', ac.grp,
    'month', x.month, 'amount', x.amount
  )), '[]'::jsonb)
from agg x
left join cc_lookup cc on cc.name = x.cost_center
join acc_lookup ac on ac.id = x.account_id;
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
