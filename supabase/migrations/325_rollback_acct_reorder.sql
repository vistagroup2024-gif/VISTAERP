-- ROLLBACK for 325_acct_reorder.sql.
--
-- Takes away the reordering. acct_move_many goes back to leaving sort_order
-- alone when it moves an account.
--
-- sort_order values already set are NOT reset. They are harmless: the tree
-- sorts by (sort_order, code), and once the screen is rolled back to sorting by
-- code alone they are simply not read. If you want the chart genuinely back to
-- untouched:
--
--     update accounts set sort_order = 0 where company_id = '<company>';

drop function if exists acct_reorder(uuid, text);

create or replace function acct_move_many(p_accounts uuid[], p_parent uuid)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_co uuid := auth_company_id();
  v_parent accounts;
  a uuid;
  v_bad text;
  v_moved int := 0;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  perform staff_require_doc('coa', 'edit');

  if p_accounts is null or array_length(p_accounts, 1) is null then
    raise exception 'Nothing selected to move.';
  end if;

  if p_parent is not null then
    select * into v_parent from accounts where id = p_parent and company_id = v_co;
    if not found then raise exception 'That group is not in this chart of accounts.'; end if;
    if not v_parent.is_group then
      raise exception '% is an account, not a group. Accounts sit inside groups.', v_parent.name;
    end if;
  end if;

  select string_agg(x::text, ', ') into v_bad
  from unnest(p_accounts) x
  where not exists (select 1 from accounts a2 where a2.id = x and a2.company_id = v_co);
  if v_bad is not null then raise exception 'Account not found: %', v_bad; end if;

  if p_parent is not null then
    declare v_walk uuid := p_parent; i int := 0;
    begin
      while v_walk is not null and i < 100 loop
        i := i + 1;
        if v_walk = any (p_accounts) then
          select name into v_bad from accounts where id = v_walk;
          raise exception 'You cannot move % into itself or into something inside it.', coalesce(v_bad, 'a group');
        end if;
        select parent_id into v_walk from accounts where id = v_walk and company_id = v_co;
      end loop;
    end;
  end if;

  foreach a in array p_accounts loop
    update accounts set parent_id = p_parent
     where id = a and company_id = v_co and parent_id is distinct from p_parent;
    if found then v_moved := v_moved + 1; end if;
  end loop;

  perform acct_rebuild_paths(v_co);

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_co, auth.uid(), 'accounts_moved', 'account', p_parent,
          jsonb_build_object('moved', v_moved, 'accounts', to_jsonb(p_accounts),
                             'into', coalesce(v_parent.name, 'top of the chart')));

  return jsonb_build_object('moved', v_moved,
                            'into', coalesce(v_parent.name, 'top of the chart'));
end $function$;

revoke all on function acct_move_many(uuid[], uuid) from public, anon;
grant execute on function acct_move_many(uuid[], uuid) to authenticated;
