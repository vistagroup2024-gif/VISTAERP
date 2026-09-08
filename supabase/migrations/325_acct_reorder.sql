-- An account can be moved WITHIN its group, not only into another one.
--
-- Move only ever asked "which group does this belong to". But a chart of
-- accounts has an order as well as a shape, and the order is the one people
-- read it in: the main bank first, the rarely-used suspense account last. There
-- was no way to say that. Siblings came out in code order, and the only way to
-- put an account first was to renumber it — which changes its code, and a code
-- is how the account is referred to everywhere else.
--
-- accounts.sort_order has been on the table all along and acct_tree has been
-- returning it all along; nothing has ever set it or read it. This is what sets
-- it.
--
-- RENUMBERING, THEN MOVING. Every sort_order in the group is rewritten as
-- 10, 20, 30 … before the move, for two reasons. Everything today is 0, so
-- without it there would be nothing to move between; and once the gaps are
-- even, a move is just a swap of two numbers rather than an attempt to find
-- room between two neighbours that have none.
--
-- The order is by (sort_order, code), so a group nobody has touched still comes
-- out in code order exactly as it does today, and one account being lifted to
-- the top does not scramble the rest.

create or replace function acct_reorder(p_account uuid, p_dir text)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_co uuid := auth_company_id();
  a accounts;
  v_ids uuid[];
  v_pos int;
  v_to  int;
  i int;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  perform staff_require_doc('coa', 'edit');
  if p_dir not in ('up','down','top','bottom') then
    raise exception 'Move it up, down, to the top or to the bottom — not "%".', p_dir;
  end if;

  select * into a from accounts where id = p_account and company_id = v_co;
  if not found then raise exception 'That account is not in this chart of accounts.'; end if;

  -- Its siblings, in the order they are shown in.
  select array_agg(s.id order by coalesce(s.sort_order, 0), s.code)
    into v_ids
  from accounts s
  where s.company_id = v_co and s.parent_id is not distinct from a.parent_id;

  if coalesce(array_length(v_ids, 1), 0) < 2 then
    return jsonb_build_object('moved', false, 'reason', 'nothing to move it past');
  end if;

  v_pos := array_position(v_ids, p_account);
  v_to := case p_dir
            when 'up'     then greatest(1, v_pos - 1)
            when 'down'   then least(array_length(v_ids, 1), v_pos + 1)
            when 'top'    then 1
            else array_length(v_ids, 1)
          end;

  if v_to = v_pos then
    return jsonb_build_object('moved', false, 'reason',
      case when p_dir in ('up','top') then 'already first' else 'already last' end);
  end if;

  -- Take it out and put it back at the new place, then renumber the lot. Doing
  -- it as a rebuild rather than a swap is what makes 'top' and 'bottom' the
  -- same operation as 'up' and 'down'.
  v_ids := v_ids[1:v_pos-1] || v_ids[v_pos+1:array_length(v_ids,1)];
  v_ids := v_ids[1:v_to-1] || array[p_account] || v_ids[v_to:array_length(v_ids,1)];

  for i in 1..array_length(v_ids, 1) loop
    update accounts set sort_order = i * 10 where id = v_ids[i] and company_id = v_co;
  end loop;

  return jsonb_build_object('moved', true, 'from', v_pos, 'to', v_to,
                            'of', array_length(v_ids, 1));
end $function$;

revoke all on function acct_reorder(uuid, text) from public, anon;
grant execute on function acct_reorder(uuid, text) to authenticated;

-- Accounts moved into a group land at the END of it rather than inheriting
-- whatever sort_order they had in the group they came from, which would have
-- dropped them into the middle of their new siblings for no reason anybody
-- could see.
create or replace function acct_move_many(p_accounts uuid[], p_parent uuid)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_co uuid := auth_company_id();
  v_parent accounts;
  a uuid;
  v_bad text;
  v_moved int := 0;
  v_next int;
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

  select string_agg(x::text, ', ') into v_bad
  from unnest(p_accounts) x
  where not exists (select 1 from accounts a2 where a2.id = x and a2.company_id = v_co);
  if v_bad is not null then raise exception 'Account not found: %', v_bad; end if;

  -- Moving a group into its own subtree would cut that subtree off the chart.
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

  select coalesce(max(coalesce(sort_order, 0)), 0) into v_next
  from accounts where company_id = v_co and parent_id is not distinct from p_parent;

  foreach a in array p_accounts loop
    v_next := v_next + 10;
    update accounts set parent_id = p_parent, sort_order = v_next
     where id = a and company_id = v_co and parent_id is distinct from p_parent;
    if found then v_moved := v_moved + 1; else v_next := v_next - 10; end if;
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
