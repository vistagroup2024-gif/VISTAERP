-- Cash & Bank becomes a complete report: four groups (Driver Cash Accounts,
-- Other Cash Accounts, Bank PKR, Bank) reading the SAME chart-of-accounts
-- hierarchy that already exists (1-02 CASH IN HAND's children named
-- "...DRIVER..." vs not, and 1-03-01 BANK PKR is already its own subgroup
-- under 1-03 BANK — nothing invented, just read). Each account now carries
-- Debit Balance / Credit Balance (which column a normally-debit cash/bank
-- balance sits in — negative means overdrawn, shown as a credit balance,
-- never a raw negative number) alongside the existing Net Balance and
-- Share %. A cost-centre filter reads the SAME "nearest tagged ancestor
-- group" inheritance rule accounts already follow (no accounts carry one
-- yet — the filter is wired for when they do, not fabricating data).
drop function if exists public.report_cash_bank(uuid, date, uuid[]);

create or replace function public.report_cash_bank(p_company uuid, p_as_of date, p_account_ids uuid[] default null, p_cost_center_ids uuid[] default null)
 RETURNS jsonb
 LANGUAGE sql STABLE
 SET search_path TO 'public'
AS $function$
with
  cash_grp as (select path from accounts where company_id = p_company and code = '1-02'),
  bank_grp as (select path from accounts where company_id = p_company and code = '1-03'),
  pkr_grp as (select path from accounts where company_id = p_company and code = '1-03-01'),
  bal as (
    select a.id, a.code, a.name, a.path,
      (a.opening_balance * case when a.opening_is_debit then 1 else -1 end)
        + coalesce((select sum(l.debit - l.credit) from journal_lines l
                     join journal_entries e on e.id = l.entry_id
                    where l.account_id = a.id and e.status = 'posted' and e.entry_date <= p_as_of), 0) as balance,
      case
        when a.path like (select path from pkr_grp) || '/%' then 'bank_pkr'
        when a.path like (select path from bank_grp) || '/%' then 'bank'
        when a.path like (select path from cash_grp) || '/%' and a.name ilike '%driver%' then 'cash_driver'
        when a.path like (select path from cash_grp) || '/%' then 'cash_other'
      end as grp
    from accounts a
    where a.company_id = p_company and a.is_postable
      and (a.path like (select path from cash_grp) || '/%' or a.path like (select path from bank_grp) || '/%')
      and (p_account_ids is null or a.id = any(p_account_ids))
  ),
  ancestors as (
    select b.id as account_id, anc.cost_center_id, array_position(string_to_array(b.path, '/'), anc.code) as depth
    from bal b
    join accounts anc on anc.company_id = p_company and anc.code = any(string_to_array(b.path, '/'))
  ),
  effective_cc as (
    select account_id, cost_center_id from (
      select account_id, cost_center_id, row_number() over (partition by account_id order by depth desc) as rn
      from ancestors where cost_center_id is not null
    ) x where rn = 1
  ),
  bal_scoped as (
    select b.* from bal b
    where p_cost_center_ids is null
       or exists (select 1 from effective_cc ec where ec.account_id = b.id and ec.cost_center_id = any(p_cost_center_ids))
  ),
  totals as (select coalesce(sum(abs(balance)), 0) as grand from bal_scoped)
select coalesce(jsonb_agg(jsonb_build_object(
    'key', grp, 'label', case grp
      when 'cash_driver' then 'Driver Cash Accounts'
      when 'cash_other' then 'Other Cash Accounts'
      when 'bank_pkr' then 'Bank PKR'
      else 'Bank' end,
    'rows', rows, 'subtotal', jsonb_build_object('debit_balance', sub_debit, 'credit_balance', sub_credit, 'balance', sub_balance)
  ) order by case grp when 'cash_driver' then 1 when 'cash_other' then 2 when 'bank_pkr' then 3 else 4 end), '[]'::jsonb)
from (
  select grp,
    jsonb_agg(jsonb_build_object(
      'account_id', id, 'code', code, 'name', name,
      'debit_balance', greatest(balance,0), 'credit_balance', greatest(-balance,0), 'balance', balance,
      'share', case when (select grand from totals) <> 0
               then round(abs(balance) / (select grand from totals) * 100, 2) else 0 end
    ) order by name) as rows,
    sum(greatest(balance,0)) as sub_debit, sum(greatest(-balance,0)) as sub_credit, sum(balance) as sub_balance
  from bal_scoped group by grp
) g
$function$;

revoke all on function public.report_cash_bank(uuid, date, uuid[], uuid[]) from public, anon;
grant execute on function public.report_cash_bank(uuid, date, uuid[], uuid[]) to authenticated;

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
