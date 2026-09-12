-- The five suppliers migration 361 created a second time.
--
-- Each of these already existed, loose directly under SUPPLIERS, and the Excel
-- files them under HOTELS SUPPLIERS. 361 matched names among the children of
-- the resolved parent — deliberately, so that Rehan the transport supplier and
-- Rehan the car customer stay two records — and that scoping is exactly why it
-- could not see these five: same name, different parent.
--
-- THE IMPORT'S COPY GOES, NOT THE ORIGINAL, and the data says which is which
-- rather than the date: the pre-existing Jazeera Taiba carries a hotel purchase
-- and the pre-existing Travel Gateway carries two. Delete those and a real
-- booking loses its supplier. The five copies made by the import carry nothing
-- at all — no purchase, no booking, no group, no journal line — which is what
-- makes them the safe half of each pair.
--
--   kept                                       deleted
--   2-01-01-010 Jazeera Taiba   (1 purchase)   2-01-01-24-35 JAZEERA TAIBA
--   2-01-01-005 RIAZ BRN                       2-01-01-24-16 RIAZ BRN
--   2-01-01-006 SHAHID BRN                     2-01-01-24-12 SHAHID BRN
--   2-01-01-004 TRAVEL DOOR BRN                2-01-01-24-18 TRAVEL DOOR BRN
--   2-01-01-013 Travel Gateway  (2 purchases)  2-01-01-24-39 TRAVEL GATEWAY
--
-- It deletes through acct_delete, not with a DELETE statement, because that is
-- the one routine that takes both halves — the ledger account and the parties
-- record — and it leans on delete_party, which already knows every place a
-- party can be spoken for. If any of these five turns out to be referenced
-- after all, acct_delete refuses and this whole migration rolls back rather
-- than leaving a party without its account.
--
-- The kept five stay where they are, loose under SUPPLIERS rather than under
-- HOTELS SUPPLIERS. Moving them is a judgement about the chart, not a fix for
-- a duplicate, and it is one click on the tree's Move button.

begin;

do $del$
declare v_admin uuid; v_co uuid; r record; v_n int; v_deleted int := 0;
        v_codes text[] := array['2-01-01-24-35','2-01-01-24-16','2-01-01-24-12',
                                '2-01-01-24-18','2-01-01-24-39'];
begin
  select ur.user_id into v_admin from user_roles ur join profiles p on p.id = ur.user_id
   where ur.role = 'admin' limit 1;
  select company_id into v_co from profiles where id = v_admin;

  -- Refuse before deleting anything if one of the five is not what this
  -- migration says it is: created by the import, a Payable party under HOTELS
  -- SUPPLIERS, and referenced by nothing.
  for r in select a.id, a.code, a.name, a.party_id, a.created_at,
                  (select p2.name from accounts p2 where p2.id = a.parent_id) as parent
             from accounts a where a.company_id = v_co and a.code = any(v_codes)
  loop
    if r.parent <> 'HOTELS SUPPLIERS' then
      raise exception '362: % is under "%", not HOTELS SUPPLIERS — refusing', r.code, r.parent;
    end if;
    if r.created_at <> '2026-09-12 17:33:35.87634+03' then
      raise exception '362: % was not created by migration 361 — refusing', r.code;
    end if;
    if r.party_id is null then
      raise exception '362: % has no party record — refusing', r.code;
    end if;
    select (select count(*) from hotel_purchase_bookings h where h.supplier_id = r.party_id)
         + (select count(*) from hotel_bookings h where h.agent_id = r.party_id)
         + (select count(*) from transport_bookings t where t.agent_id = r.party_id)
         + (select count(*) from umrah_groups g where g.agent_id = r.party_id)
         + (select count(*) from journal_lines l where l.account_id = r.id)
      into v_n;
    if v_n <> 0 then
      raise exception '362: % ("%") is referenced % time(s) — refusing', r.code, r.name, v_n;
    end if;
  end loop;

  select count(*) into v_n from accounts where company_id = v_co and code = any(v_codes);
  if v_n <> 5 then
    raise exception '362: expected the 5 doubled suppliers, found % — refusing', v_n;
  end if;

  -- and that the one being kept really is still there, for each pair
  for r in select unnest(array['2-01-01-010','2-01-01-005','2-01-01-006',
                               '2-01-01-004','2-01-01-013']) as code
  loop
    if not exists (select 1 from accounts where company_id = v_co and code = r.code) then
      raise exception '362: the copy being KEPT (%) is not there — refusing', r.code;
    end if;
  end loop;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  for r in select id, code, name from accounts
            where company_id = v_co and code = any(v_codes) order by code
  loop
    perform acct_delete(r.id);
    v_deleted := v_deleted + 1;
    raise notice '362: deleted % "%"', r.code, r.name;
  end loop;

  perform set_config('role', 'postgres', true);
  if v_deleted <> 5 then raise exception '362: deleted % of 5', v_deleted; end if;
end $del$;

do $chk$
declare v_co uuid; v_n int; v_t text;
begin
  select company_id into v_co from profiles p
    join user_roles ur on ur.user_id = p.id where ur.role='admin' limit 1;

  -- the five are gone
  select count(*) into v_n from accounts where company_id = v_co
    and code = any(array['2-01-01-24-35','2-01-01-24-16','2-01-01-24-12',
                         '2-01-01-24-18','2-01-01-24-39']);
  if v_n <> 0 then raise exception '362: % of the five survived', v_n; end if;

  -- the five kept are still there, still parties, still carrying their purchases
  for v_t in select unnest(array['2-01-01-010','2-01-01-005','2-01-01-006',
                                 '2-01-01-004','2-01-01-013']) loop
    if not exists (select 1 from accounts where company_id=v_co and code=v_t and party_id is not null) then
      raise exception '362: kept account % is gone or lost its party', v_t;
    end if;
  end loop;
  select count(*) into v_n from hotel_purchase_bookings h
   where h.supplier_id is not null
     and not exists (select 1 from parties p where p.id = h.supplier_id);
  if v_n <> 0 then raise exception '362: % hotel purchase(s) lost their supplier', v_n; end if;

  -- and no Payable party name is doubled any more
  select count(*) into v_n from (
    select upper(btrim(regexp_replace(regexp_replace(a.name,'[^A-Za-z0-9 ]',' ','g'),'\s+',' ','g'))) nm
      from accounts a where a.party_id is not null and a.subtype = 'Payable'
     group by 1 having count(*) > 1) d;
  if v_n <> 0 then raise exception '362: % supplier name(s) are still doubled', v_n; end if;

  -- nothing else was disturbed
  select count(*) into v_n from parties p
   where not exists (select 1 from accounts a where a.party_id = p.id);
  if v_n <> 0 then raise exception '362: % party(ies) left without an account', v_n; end if;
  select count(*) into v_n from accounts a
   where a.parent_id is not null and not exists (select 1 from accounts p where p.id = a.parent_id);
  if v_n <> 0 then raise exception '362: % orphaned account(s)', v_n; end if;
  select count(*) into v_n from journal_entries;
  if v_n <> 0 then raise exception '362: % journal entry(ies) appeared', v_n; end if;

  raise notice '362: five removed. % accounts, % parties',
    (select count(*) from accounts where company_id=v_co), (select count(*) from parties);
end $chk$;

commit;
