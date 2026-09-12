-- Rollback of 362 — puts the five duplicate suppliers back.
--
-- There is no reason to run this. 362 removed five supplier records that were
-- the second copy of a supplier already in the chart, none of them referenced
-- by anything. Re-creating them re-creates the duplicate.
--
-- It is here because the deletion was real and a reversal should be written
-- down rather than described. The five come back as parties under HOTELS
-- SUPPLIERS, through acct_create, so each gets its ledger account with it —
-- the same door 361 used. Their CODES will not be the ones they had:
-- acct_create numbers a new child from the highest number already under that
-- parent, and 2-01-01-24-12 and the rest are now free but no longer next.

begin;

do $rb$
declare v_admin uuid; v_co uuid; v_parent uuid; nm text; v_n int := 0;
begin
  select ur.user_id into v_admin from user_roles ur join profiles p on p.id = ur.user_id
   where ur.role = 'admin' limit 1;
  select company_id into v_co from profiles where id = v_admin;
  select id into v_parent from accounts where company_id = v_co and code = '2-01-01-24';
  if v_parent is null then
    raise exception '362 rollback: HOTELS SUPPLIERS (2-01-01-24) is not in the chart';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  foreach nm in array array['SHAHID BRN','RIAZ BRN','TRAVEL DOOR BRN',
                            'JAZEERA TAIBA','TRAVEL GATEWAY']
  loop
    if exists (select 1 from accounts a where a.company_id = v_co
                and a.parent_id = v_parent and upper(a.name) = nm) then
      continue;
    end if;
    perform acct_create(v_co, v_parent, nm, null, false, 'Payable',
                        null::account_type, 'SAR', 0, true, null, 'supplier');
    v_n := v_n + 1;
  end loop;

  perform set_config('role', 'postgres', true);
  raise notice '362 rollback: restored % supplier(s) under HOTELS SUPPLIERS', v_n;
end $rb$;

commit;
