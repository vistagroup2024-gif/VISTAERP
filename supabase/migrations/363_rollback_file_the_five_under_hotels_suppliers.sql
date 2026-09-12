-- Rollback of 363: the five go back to sitting loose directly under SUPPLIERS.
--
-- Through acct_move_many again, the same routine, with 2-01-01 as the target
-- instead of 2-01-01-24. Their codes never moved either way, so this really
-- does return them to where 362 left them.

begin;

do $rb$
declare v_admin uuid; v_co uuid; v_parent uuid; v_ids uuid[]; v_res jsonb;
begin
  select ur.user_id into v_admin from user_roles ur join profiles p on p.id = ur.user_id
   where ur.role = 'admin' limit 1;
  select company_id into v_co from profiles where id = v_admin;

  select id into v_parent from accounts
   where company_id = v_co and code = '2-01-01' and is_group;
  if v_parent is null then raise exception '363 rollback: SUPPLIERS (2-01-01) is not a group'; end if;

  select array_agg(a.id order by a.code) into v_ids from accounts a
   where a.company_id = v_co
     and a.code = any(array['2-01-01-004','2-01-01-005','2-01-01-006',
                            '2-01-01-010','2-01-01-013']);
  if coalesce(array_length(v_ids,1),0) <> 5 then
    raise exception '363 rollback: found % of the five', coalesce(array_length(v_ids,1),0);
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  v_res := acct_move_many(v_ids, v_parent);
  perform set_config('role', 'postgres', true);
  raise notice '363 rollback: moved % back to %', v_res->>'moved', v_res->>'into';
end $rb$;

commit;
