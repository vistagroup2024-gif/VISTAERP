-- 400 — acct_tree() is what the Chart of Accounts screen reads; it needs to
-- carry the cost_center_id migration 399 added, or an account group's own
-- Edit dialog has no way to know what is already set on it.

create or replace function public.acct_tree(p_company uuid)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'code', a.code, 'name', a.name, 'name_ar', a.name_ar,
    'nature', a.type, 'is_group', a.is_group, 'is_postable', a.is_postable,
    'parent_id', a.parent_id, 'path', a.path, 'currency', a.currency,
    'subtype', a.subtype, 'status', a.status, 'sort_order', a.sort_order,
    'cost_center_id', a.cost_center_id,
    'party_type', pt.party_type,
    'party', case when pt.id is null then null else jsonb_build_object(
      'id', pt.id, 'code', pt.code, 'phone', pt.phone, 'email', pt.email,
      'currency', pt.currency, 'credit_limit', pt.credit_limit,
      'credit_days', pt.credit_days, 'sales_target', pt.sales_target,
      'is_active', pt.is_active) end,
    'own_debit', coalesce(s.debit,0), 'own_credit', coalesce(s.credit,0)
  ) order by a.path), '[]'::jsonb)
  from accounts a
  left join parties pt on pt.id = a.party_id
  left join (
    select l.account_id, sum(l.debit) debit, sum(l.credit) credit
    from journal_lines l join journal_entries e on e.id = l.entry_id
    where e.company_id = p_company and e.status = 'posted'
    group by l.account_id
  ) s on s.account_id = a.id
  where a.company_id = p_company;
$function$;
revoke all on function public.acct_tree(uuid) from public, anon;
grant execute on function public.acct_tree(uuid) to authenticated;

do $chk$
declare v_def text;
begin
  select pg_get_functiondef('public.acct_tree(uuid)'::regprocedure) into v_def;
  if v_def not like '%cost_center_id%' then
    raise exception 'acct_tree does not carry cost_center_id';
  end if;
end $chk$;
