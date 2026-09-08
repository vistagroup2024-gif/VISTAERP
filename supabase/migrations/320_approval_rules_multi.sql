-- One authorisation rule can name several voucher types, cost centres and people.
--
-- A rule held ONE voucher type, ONE cost centre and ONE person. So "hold every
-- Receipt and every Payment over 5,000 in either car cost centre, whoever
-- raises it" was six rules that had to be kept in step by hand — and the first
-- time one of them was edited and the others were not, the rule stopped meaning
-- what it said.
--
-- The three columns become arrays. Empty (or null) keeps its old meaning:
--
--     doc_types    empty  ->  no rule; a rule must say which vouchers it holds
--     cost_centers empty  ->  any cost centre
--     created_bys  empty  ->  anyone
--
-- WHAT DECIDES WHICH RULE WINS IS UNCHANGED. acct_rule_for still picks the most
-- specific match — naming a person beats naming a cost centre, which beats an
-- amount alone, and between rules of the same shape the higher threshold wins.
-- All that changes is that "names a person" is now "names this person among
-- others" rather than "names exactly this person".
--
-- The singular columns are kept and written alongside the arrays, holding the
-- FIRST element. Nothing reads them any more, but a rule saved today still
-- looks like a rule to anything that has not been redeployed yet, and the
-- rollback has something to go back to.

alter table acct_approval_rules add column if not exists doc_types    text[];
alter table acct_approval_rules add column if not exists cost_centers text[];
alter table acct_approval_rules add column if not exists created_bys  uuid[];

-- Every rule that exists becomes a one-element rule, which matches exactly what
-- it matched before.
update acct_approval_rules
   set doc_types    = coalesce(doc_types,    array[doc_type]),
       cost_centers = coalesce(cost_centers, case when cost_center is null then null else array[cost_center] end),
       created_bys  = coalesce(created_bys,  case when created_by  is null then null else array[created_by]  end)
 where doc_types is null;

comment on column acct_approval_rules.doc_types is
  'The voucher types this rule holds. A rule with none holds nothing.';
comment on column acct_approval_rules.cost_centers is
  'Empty means any cost centre — the same convention the rest of the access model uses.';
comment on column acct_approval_rules.created_bys is
  'Empty means anyone raised it.';

-- ------------------------------------------------------------- the match ----

create or replace function acct_rule_for(p_company uuid, p_doc_type text, p_amount numeric,
                                         p_cost_center text default null, p_created_by uuid default null)
returns uuid language sql stable set search_path to 'public' as $function$
  select r.id from acct_approval_rules r
  where r.company_id = p_company
    and r.active
    and p_doc_type = any (coalesce(r.doc_types, array[r.doc_type]))
    and r.min_amount <= coalesce(p_amount, 0)
    -- No cost centre named = any. Named = one of them has to be this one, and
    -- the comparison is on the trimmed upper case, as it always was, because a
    -- cost centre is stored on a voucher as text rather than as a reference.
    and (coalesce(array_length(r.cost_centers, 1), 0) = 0
         or upper(btrim(coalesce(p_cost_center, ''))) = any (
              select upper(btrim(x)) from unnest(r.cost_centers) x))
    and (coalesce(array_length(r.created_bys, 1), 0) = 0
         or p_created_by = any (r.created_bys))
  order by (coalesce(array_length(r.created_bys, 1), 0) > 0) desc,
           (coalesce(array_length(r.cost_centers, 1), 0) > 0) desc,
           r.min_amount desc
  limit 1;
$function$;

-- -------------------------------------------------------------- the list ----

create or replace function acct_rules_list()
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'name', r.name,
    'doc_type', r.doc_type,
    'doc_types', to_jsonb(coalesce(r.doc_types, array[r.doc_type])),
    'min_amount', r.min_amount,
    'cost_center', r.cost_center,
    'cost_centers', to_jsonb(coalesce(r.cost_centers, '{}'::text[])),
    'created_by', r.created_by,
    'created_bys', to_jsonb(coalesce(r.created_bys, '{}'::uuid[])),
    'created_by_names', coalesce((select jsonb_agg(coalesce(pr.full_name, pr.email) order by pr.full_name)
                                  from profiles pr where pr.id = any (coalesce(r.created_bys, '{}'::uuid[]))), '[]'::jsonb),
    'created_by_name', (select coalesce(pr.full_name, pr.email) from profiles pr where pr.id = r.created_by),
    'approvals_needed', r.approvals_needed, 'active', r.active,
    'approvers', coalesce((select jsonb_agg(jsonb_build_object(
        'user_id', ra.user_id,
        'name', (select coalesce(pr.full_name, pr.email) from profiles pr where pr.id = ra.user_id)))
      from acct_approval_rule_approvers ra where ra.rule_id = r.id), '[]'::jsonb)
  ) order by r.name nulls last, r.min_amount), '[]'::jsonb)
  from acct_approval_rules r
  where r.company_id = auth_company_id() and is_staff();
$function$;

-- -------------------------------------------------------------- the save ----

create or replace function acct_rule_save(p_id uuid, p_rule jsonb, p_approvers uuid[])
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare
  v_co uuid := auth_company_id(); v_id uuid; u uuid;
  v_types text[]; v_ccs text[]; v_users uuid[];
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  perform staff_require_doc('auth_rules', case when p_id is null then 'create' else 'edit' end);

  -- Arrays if they were sent, otherwise the single values, so a screen that has
  -- not been redeployed still saves a working rule.
  select array_agg(distinct btrim(x)) into v_types
  from jsonb_array_elements_text(coalesce(p_rule->'doc_types', '[]'::jsonb)) x
  where btrim(x) <> '';
  if v_types is null and nullif(btrim(coalesce(p_rule->>'doc_type','')),'') is not null then
    v_types := array[btrim(p_rule->>'doc_type')];
  end if;
  if coalesce(array_length(v_types, 1), 0) = 0 then
    raise exception 'Choose at least one voucher type';
  end if;

  select array_agg(distinct btrim(x)) into v_ccs
  from jsonb_array_elements_text(coalesce(p_rule->'cost_centers', '[]'::jsonb)) x
  where btrim(x) <> '';
  if v_ccs is null and nullif(btrim(coalesce(p_rule->>'cost_center','')),'') is not null then
    v_ccs := array[btrim(p_rule->>'cost_center')];
  end if;

  select array_agg(distinct x::uuid) into v_users
  from jsonb_array_elements_text(coalesce(p_rule->'created_bys', '[]'::jsonb)) x
  where btrim(x) <> '';
  if v_users is null and nullif(btrim(coalesce(p_rule->>'created_by','')),'') is not null then
    v_users := array[(p_rule->>'created_by')::uuid];
  end if;

  if p_id is null then
    insert into acct_approval_rules(company_id, doc_type, doc_types, name, min_amount,
                                    cost_center, cost_centers, created_by, created_bys,
                                    approvals_needed, active)
    values (v_co, v_types[1], v_types, nullif(btrim(coalesce(p_rule->>'name','')),''),
            coalesce(nullif(p_rule->>'min_amount','')::numeric, 0),
            v_ccs[1], v_ccs, v_users[1], v_users,
            greatest(1, coalesce(nullif(p_rule->>'approvals_needed','')::int, 1)),
            coalesce((p_rule->>'active')::boolean, true))
    returning id into v_id;
  else
    update acct_approval_rules set
      doc_type = v_types[1], doc_types = v_types,
      name = nullif(btrim(coalesce(p_rule->>'name','')),''),
      min_amount = coalesce(nullif(p_rule->>'min_amount','')::numeric, 0),
      cost_center = v_ccs[1], cost_centers = v_ccs,
      created_by = v_users[1], created_bys = v_users,
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
