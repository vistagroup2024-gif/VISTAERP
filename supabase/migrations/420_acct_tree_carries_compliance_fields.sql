-- acct_tree() feeds the Chart of Accounts screen's Party Details modal; it
-- needs the 4 new compliance columns (migration 419) on the party object or
-- the modal has nothing to show/prefill.
create or replace function public.acct_tree(p_company uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
      'is_active', pt.is_active,
      'iqama_no', pt.iqama_no, 'iqama_expiry', pt.iqama_expiry,
      'driver_card_expiry', pt.driver_card_expiry, 'driver_license_expiry', pt.driver_license_expiry) end,
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
