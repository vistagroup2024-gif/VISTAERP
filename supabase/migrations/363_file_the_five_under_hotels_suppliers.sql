-- The five kept suppliers move into HOTELS SUPPLIERS, where the Excel files them.
--
-- These are the survivors of migration 362 — Jazeera Taiba, RIAZ BRN, SHAHID
-- BRN, TRAVEL DOOR BRN and Travel Gateway — which sat loose directly under
-- SUPPLIERS because that is where they were before the import, and 362 kept
-- them there on the grounds that where they belong is a judgement rather than a
-- duplicate to fix. Asked and answered: they belong under HOTELS SUPPLIERS.
--
-- It goes through acct_move_many, which is the routine the Account Tree's Move
-- button calls. Nothing here does anything the operator could not have done on
-- the screen; it is written down as a migration so the chart's history says why
-- five suppliers changed parent.
--
-- THEIR CODES DO NOT FOLLOW, and that is acct_move_many's behaviour, not an
-- oversight: it re-parents and re-sorts, and leaves the code alone. So
-- 2-01-01-010 Jazeera Taiba sits inside 2-01-01-24 HOTELS SUPPLIERS. That is
-- the same cosmetic mismatch migration 361 left on 29 customer accounts and it
-- is harmless for the same reason — a code here is a label, and the routines
-- that fetch an account by code fetch 1160, 5100 and 9-01. Recoding a live
-- party account to tidy a label is a bigger risk than the untidy label.
--
-- Two of the five carry real hotel purchases (Jazeera Taiba one, Travel Gateway
-- two). A move does not touch party_id, so those purchases follow their
-- supplier; the check at the end proves it rather than assuming it.

begin;

do $mv$
declare v_admin uuid; v_co uuid; v_parent uuid; v_ids uuid[]; v_res jsonb; v_n int;
        v_codes text[] := array['2-01-01-004','2-01-01-005','2-01-01-006',
                                '2-01-01-010','2-01-01-013'];
begin
  select ur.user_id into v_admin from user_roles ur join profiles p on p.id = ur.user_id
   where ur.role = 'admin' limit 1;
  select company_id into v_co from profiles where id = v_admin;

  select id into v_parent from accounts
   where company_id = v_co and code = '2-01-01-24' and is_group;
  if v_parent is null then
    raise exception '363: HOTELS SUPPLIERS (2-01-01-24) is not a group in this chart';
  end if;

  -- exactly these five, each still a Payable party, each still where 362 left it
  select array_agg(a.id order by a.code) into v_ids
    from accounts a where a.company_id = v_co and a.code = any(v_codes);
  if coalesce(array_length(v_ids, 1), 0) <> 5 then
    raise exception '363: expected the 5 kept suppliers, found % — refusing',
      coalesce(array_length(v_ids, 1), 0);
  end if;

  select count(*) into v_n from accounts a
   where a.id = any(v_ids)
     and (a.party_id is null or a.subtype <> 'Payable' or a.is_group);
  if v_n <> 0 then
    raise exception '363: % of the five is not a Payable supplier account — refusing', v_n;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  v_res := acct_move_many(v_ids, v_parent);

  perform set_config('role', 'postgres', true);
  raise notice '363: moved % into %', v_res->>'moved', v_res->>'into';
  if (v_res->>'moved')::int <> 5 then
    raise exception '363: acct_move_many moved % of 5', v_res->>'moved';
  end if;
end $mv$;

do $chk$
declare v_co uuid; v_n int; v_t text;
begin
  select company_id into v_co from profiles p
    join user_roles ur on ur.user_id = p.id where ur.role='admin' limit 1;

  -- all five now sit under HOTELS SUPPLIERS, and their path says so too
  for v_t in select unnest(array['2-01-01-004','2-01-01-005','2-01-01-006',
                                 '2-01-01-010','2-01-01-013']) loop
    if not exists (
      select 1 from accounts a
       where a.company_id = v_co and a.code = v_t
         and a.parent_id = (select id from accounts where company_id=v_co and code='2-01-01-24')
         and a.path like (select path from accounts where company_id=v_co and code='2-01-01-24') || '/%'
    ) then
      raise exception '363: % is not under HOTELS SUPPLIERS, or its path was not rebuilt', v_t;
    end if;
  end loop;

  -- they kept their party, so their bookings kept their supplier
  select count(*) into v_n from accounts a
   where a.company_id = v_co
     and a.code = any(array['2-01-01-004','2-01-01-005','2-01-01-006','2-01-01-010','2-01-01-013'])
     and a.party_id is null;
  if v_n <> 0 then raise exception '363: % of the five lost its party record', v_n; end if;

  if (select count(*) from hotel_purchase_bookings h
       join accounts a on a.party_id = h.supplier_id
      where a.code = '2-01-01-010') <> 1
     or (select count(*) from hotel_purchase_bookings h
          join accounts a on a.party_id = h.supplier_id
         where a.code = '2-01-01-013') <> 2
  then raise exception '363: a hotel purchase lost its supplier in the move'; end if;

  select count(*) into v_n from hotel_purchase_bookings h
   where h.supplier_id is not null
     and not exists (select 1 from parties p where p.id = h.supplier_id);
  if v_n <> 0 then raise exception '363: % hotel purchase(s) point at no party', v_n; end if;

  -- nothing left loose under SUPPLIERS that should have gone, and the tree holds
  select count(*) into v_n from accounts a
   where a.company_id = v_co
     and a.parent_id = (select id from accounts where company_id=v_co and code='2-01-01')
     and not a.is_group and a.party_id is not null;
  raise notice '363: % party account(s) still sit directly under SUPPLIERS', v_n;

  select count(*) into v_n from accounts a
   where a.company_id = v_co and a.parent_id is not null
     and not exists (select 1 from accounts p where p.id = a.parent_id);
  if v_n <> 0 then raise exception '363: % orphaned account(s)', v_n; end if;

  select count(*) into v_n from parties p
   where not exists (select 1 from accounts a where a.party_id = p.id);
  if v_n <> 0 then raise exception '363: % party(ies) without an account', v_n; end if;

  select count(*) into v_n from journal_entries;
  if v_n <> 0 then raise exception '363: % journal entry(ies) appeared', v_n; end if;

  raise notice '363: HOTELS SUPPLIERS now holds % account(s)',
    (select count(*) from accounts a
      where a.path like (select path from accounts where company_id=v_co and code='2-01-01-24') || '/%');
end $chk$;

commit;
