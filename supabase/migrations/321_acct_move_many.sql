-- Move several accounts into a group in one go.
--
-- The tree could only move one account at a time, and it did it by writing
-- parent_id straight from the browser and then calling acct_rebuild_paths.
-- Reorganising a chart of accounts is not a one-at-a-time job, and doing it a
-- row at a time through the browser has two problems beyond the tedium: each
-- move is its own transaction, so a run that fails half way leaves the tree
-- half moved; and nothing checks that the destination is a GROUP or that it is
-- not inside the very subtree being moved — which would detach a whole branch
-- from the chart and leave acct_rebuild_paths unable to reach it.
--
-- acct_move_many does the lot in one transaction, refuses what cannot be done,
-- and rebuilds the paths once at the end.
--
-- WHAT IT REFUSES
--   * a destination that is not a group, or is not postable-parent material
--   * moving a group INTO ITSELF or into one of its own descendants
--   * an account from another company
--
-- Ordinary edit rights on the Chart of Accounts are what it takes — this is
-- reorganising the chart, not reaching into posted vouchers, and the postings
-- do not move with it: an account keeps its id, so its ledger is untouched.

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

  -- The destination. A null parent means the top of the chart, which is allowed.
  if p_parent is not null then
    select * into v_parent from accounts where id = p_parent and company_id = v_co;
    if not found then raise exception 'That group is not in this chart of accounts.'; end if;
    if not v_parent.is_group then
      raise exception '% is an account, not a group. Accounts sit inside groups.', v_parent.name;
    end if;
  end if;

  -- Everything named has to be ours.
  select string_agg(x::text, ', ') into v_bad
  from unnest(p_accounts) x
  where not exists (select 1 from accounts a2 where a2.id = x and a2.company_id = v_co);
  if v_bad is not null then raise exception 'Account not found: %', v_bad; end if;

  -- Moving a group into its own subtree would cut that subtree off the chart.
  -- Walk up from the destination: if we meet one of the accounts being moved,
  -- the move is a loop.
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
    -- Already there: nothing to do, and it should not count as a move.
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
