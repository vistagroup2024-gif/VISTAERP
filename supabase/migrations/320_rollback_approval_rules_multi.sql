-- ROLLBACK for 320_approval_rules_multi.sql.
--
-- Puts a rule back to one voucher type, one cost centre and one person.
--
-- READ THIS BEFORE RUNNING IT. The array columns are NOT dropped, so nothing is
-- destroyed — but the singular columns hold only the FIRST element, and it is
-- those the restored routines read. So a rule naming three voucher types goes
-- back to holding one, and the other two stop being held. Check what would
-- narrow:
--
--     select name, doc_types, cost_centers, created_bys
--       from acct_approval_rules
--      where coalesce(array_length(doc_types,1),0) > 1
--         or coalesce(array_length(cost_centers,1),0) > 1
--         or coalesce(array_length(created_bys,1),0) > 1;
--
-- An empty result means this is a clean reversal. Otherwise split those rules
-- into one-per-combination first, while 320 is still in place.
--
-- Drop the columns by hand once you are sure:
--     alter table acct_approval_rules
--       drop column doc_types, drop column cost_centers, drop column created_bys;

create or replace function acct_rule_for(p_company uuid, p_doc_type text, p_amount numeric,
                                         p_cost_center text default null, p_created_by uuid default null)
returns uuid language sql stable set search_path to 'public' as $function$
  select r.id from acct_approval_rules r
  where r.company_id = p_company
    and r.doc_type = p_doc_type
    and r.active
    and r.min_amount <= coalesce(p_amount, 0)
    and (r.cost_center is null
         or upper(btrim(r.cost_center)) = upper(btrim(coalesce(p_cost_center, ''))))
    and (r.created_by is null or r.created_by = p_created_by)
  order by (r.created_by is not null) desc,
           (r.cost_center is not null) desc,
           r.min_amount desc
  limit 1;
$function$;

create or replace function acct_rules_list()
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'name', r.name, 'doc_type', r.doc_type,
    'min_amount', r.min_amount, 'cost_center', r.cost_center,
    'created_by', r.created_by,
    'created_by_name', (select coalesce(pr.full_name, pr.email) from profiles pr where pr.id = r.created_by),
    'approvals_needed', r.approvals_needed, 'active', r.active,
    'approvers', coalesce((select jsonb_agg(jsonb_build_object(
        'user_id', ra.user_id,
        'name', (select coalesce(pr.full_name, pr.email) from profiles pr where pr.id = ra.user_id)))
      from acct_approval_rule_approvers ra where ra.rule_id = r.id), '[]'::jsonb)
  ) order by r.doc_type, r.min_amount), '[]'::jsonb)
  from acct_approval_rules r
  where r.company_id = auth_company_id() and is_staff();
$function$;

create or replace function acct_rule_save(p_id uuid, p_rule jsonb, p_approvers uuid[])
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare v_co uuid := auth_company_id(); v_id uuid; u uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if nullif(btrim(coalesce(p_rule->>'doc_type','')),'') is null then
    raise exception 'Choose the voucher type';
  end if;

  if p_id is null then
    insert into acct_approval_rules(company_id, doc_type, name, min_amount, cost_center,
                                    created_by, approvals_needed, active)
    values (v_co, p_rule->>'doc_type', nullif(btrim(coalesce(p_rule->>'name','')),''),
            coalesce(nullif(p_rule->>'min_amount','')::numeric, 0),
            nullif(btrim(coalesce(p_rule->>'cost_center','')),''),
            nullif(p_rule->>'created_by','')::uuid,
            greatest(1, coalesce(nullif(p_rule->>'approvals_needed','')::int, 1)),
            coalesce((p_rule->>'active')::boolean, true))
    returning id into v_id;
  else
    update acct_approval_rules set
      doc_type = p_rule->>'doc_type',
      name = nullif(btrim(coalesce(p_rule->>'name','')),''),
      min_amount = coalesce(nullif(p_rule->>'min_amount','')::numeric, 0),
      cost_center = nullif(btrim(coalesce(p_rule->>'cost_center','')),''),
      created_by = nullif(p_rule->>'created_by','')::uuid,
      approvals_needed = greatest(1, coalesce(nullif(p_rule->>'approvals_needed','')::int, 1)),
      active = coalesce((p_rule->>'active')::boolean, true)
    where id = p_id and company_id = v_co
    returning id into v_id;
    if v_id is null then raise exception 'Rule not found'; end if;
  end if;

  delete from acct_approval_rule_approvers where rule_id = v_id;
  if p_approvers is not null then
    foreach u in array p_approvers loop
      insert into acct_approval_rule_approvers(rule_id, user_id) values (v_id, u)
      on conflict do nothing;
    end loop;
  end if;
  return v_id;
end $function$;

revoke all on function acct_rule_for(uuid, text, numeric, text, uuid) from public, anon;
revoke all on function acct_rules_list()                              from public, anon;
revoke all on function acct_rule_save(uuid, jsonb, uuid[])            from public, anon;
grant execute on function acct_rule_for(uuid, text, numeric, text, uuid) to authenticated;
grant execute on function acct_rules_list()                              to authenticated;
grant execute on function acct_rule_save(uuid, jsonb, uuid[])            to authenticated;
