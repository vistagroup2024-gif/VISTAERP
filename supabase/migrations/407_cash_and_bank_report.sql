-- The Cash & Bank dashboard card's detail screen. Grouped by Cash in Hand vs
-- Bank (the two account groups 406 gave one parent), balance AS OF a date —
-- opening balance plus every posted journal line up to and including that
-- date, the same closing-balance shape trial_balance already uses, scoped to
-- the account SUBTREE under CASH & BANK exactly the way dashboard_metrics()
-- now reads it, so the two can never quietly drift apart again.
create or replace function public.report_cash_bank(p_company uuid, p_as_of date, p_account_ids uuid[] default null)
 RETURNS jsonb
 LANGUAGE sql STABLE
 SET search_path TO 'public'
AS $function$
with
  cash_grp as (select path from accounts where company_id = p_company and code = '1-02'),
  bank_grp as (select path from accounts where company_id = p_company and code = '1-03'),
  bal as (
    select a.id, a.code, a.name,
      (a.opening_balance * case when a.opening_is_debit then 1 else -1 end)
        + coalesce((select sum(l.debit - l.credit) from journal_lines l
                     join journal_entries e on e.id = l.entry_id
                    where l.account_id = a.id and e.status = 'posted' and e.entry_date <= p_as_of), 0) as balance,
      case when a.path like (select path from cash_grp) || '/%' then 'cash'
           when a.path like (select path from bank_grp) || '/%' then 'bank' end as grp
    from accounts a
    where a.company_id = p_company and a.is_postable
      and (a.path like (select path from cash_grp) || '/%' or a.path like (select path from bank_grp) || '/%')
      and (p_account_ids is null or a.id = any(p_account_ids))
  ),
  totals as (select coalesce(sum(abs(balance)), 0) as grand from bal)
select coalesce(jsonb_agg(jsonb_build_object(
    'key', grp, 'label', case grp when 'cash' then 'Cash in Hand' else 'Bank' end,
    'rows', rows, 'subtotal', jsonb_build_object('balance', sub_balance)
  ) order by grp desc), '[]'::jsonb)
from (
  select grp,
    jsonb_agg(jsonb_build_object(
      'account_id', id, 'code', code, 'name', name, 'balance', balance,
      'share', case when (select grand from totals) <> 0
               then round(abs(balance) / (select grand from totals) * 100, 2) else 0 end
    ) order by name) as rows,
    sum(balance) as sub_balance
  from bal group by grp
) g
$function$;

revoke all on function public.report_cash_bank(uuid, date, uuid[]) from public, anon;
grant execute on function public.report_cash_bank(uuid, date, uuid[]) to authenticated;

do $chk$
declare
  v_company uuid := '96f6b539-b491-4df7-91a2-80c7c8e7491d';
  v_admin   uuid := 'edf3fa71-27e2-4cb1-af62-9afd685abefe';
  v_result  jsonb;
  v_rows_total numeric;
  v_card_balance numeric;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);

  select public.report_cash_bank(v_company, current_date) into v_result;
  select coalesce(sum((r->'subtotal'->>'balance')::numeric), 0) into v_rows_total
    from jsonb_array_elements(v_result) r;

  select (public.dashboard_metrics() -> 'cash_bank' ->> 'balance')::numeric into v_card_balance;

  if abs(v_rows_total - v_card_balance) > 0.01 then
    raise exception 'report_cash_bank self-check: rows total % does not match dashboard card balance %',
      v_rows_total, v_card_balance;
  end if;

  raise notice 'report_cash_bank self-check passed: total=%, groups=%', v_rows_total, jsonb_array_length(v_result);
end;
$chk$;
