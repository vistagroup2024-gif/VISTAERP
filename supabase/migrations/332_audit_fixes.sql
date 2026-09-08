-- What the ERP-wide sweep turned up, less the cron gate.
--
-- Four things, none of them related except that they all came out of the same
-- audit. The cron routines are NOT closed here — that needs CRON_SECRET agreed
-- between Vercel and the database first, and closing them before that would
-- stop the jobs rather than protect them.
--
-- 1. TWO SCREENS IGNORED THEIR OWN RIGHTS. Visa Invoice and the Chart of
--    Accounts are both in DOC_TREE, so an admin can untick create, edit or
--    delete on them — and the routines behind them checked only is_staff(), so
--    the tick did nothing. Editing a visa invoice unposts and reposts its
--    ledger entry; deleting an account takes a party with it. This is the same
--    gap Car Expense had, in the last two places that still had it.
--
--    The guard is inserted into the LIVE definition rather than retyped:
--    acct_create alone is five thousand characters, and copying it by hand to
--    add one line is how a body gets silently altered. Each patch checks that
--    it actually changed something and refuses if the anchor has moved.
--
-- 2. ELEVEN FUNCTIONS HAD A MUTABLE search_path. Every other routine in the
--    schema pins it to 'public'; these were written without it. A definer
--    function with a loose search_path can be pointed at objects the caller
--    controls. `alter function ... set search_path` fixes it without touching
--    a body.
--
-- 3. A PARTY WITH NO LEDGER ACCOUNT. `TEST`, a b2b_agent, existed in `parties`
--    with nothing in the chart behind it — the split this schema is built to
--    prevent. Nothing anywhere referenced it: no account, no trade document, no
--    group, no portal login, no rate, no contract. It goes.
--
-- 4. EIGHTEEN backup_* TABLES from old cleanups, 198 rows between them, with no
--    foreign key, no routine and no line of application code referring to any
--    of them. They go too.

-- ------------------------------------------------- 1. the two missing gates --

do $$
declare r record; v_def text; v_new text;
  anchor constant text := 'if not is_staff() then raise exception ''Not authorized''; end if;';
begin
  for r in
    select 'visa_invoice_save'   as fn, 'visa_invoice' as doc, 'edit'   as rt
    union all select 'visa_invoice_delete', 'visa_invoice', 'delete'
    union all select 'acct_create',         'coa',          'create'
    union all select 'acct_delete',         'coa',          'delete'
    union all select 'acct_party_save',     'coa',          'edit'
  loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn;
    if v_def is null then
      raise exception 'Cannot gate %: it is not there.', r.fn;
    end if;
    -- Already gated? Then this migration has run before; leave it be.
    if v_def ~* ('staff_require_doc\(''' || r.doc || '''') then
      raise notice '% already carries its % right.', r.fn, r.rt;
      continue;
    end if;
    if position(anchor in v_def) = 0 then
      raise exception 'Cannot gate %: the is_staff() line it is anchored to has moved.', r.fn;
    end if;
    v_new := replace(v_def, anchor,
      anchor || E'\n  perform staff_require_doc(''' || r.doc || ''', ''' || r.rt || ''');');
    if v_new = v_def then
      raise exception 'Cannot gate %: nothing changed.', r.fn;
    end if;
    execute v_new;
    raise notice 'Gated % with %/%.', r.fn, r.doc, r.rt;
  end loop;
end $$;

-- ------------------------------------------------- 2. pin the search_path ---

do $$
declare r record; n int := 0;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and p.proname in ('car_service_charge_status','is_car_cost_center','transport_route_origin',
                         'transport_route_dest','hotel_agent_status','car_installment_status',
                         'acct_set_path','fa_monthly','acct_is_manual_voucher',
                         'trade_doc_car_return_guard','staff_doc_key')
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c
                        where c like 'search_path=%')
  loop
    execute format('alter function %s set search_path to %L', r.sig, 'public');
    n := n + 1;
  end loop;
  raise notice 'Pinned search_path on % function(s).', n;
end $$;

-- ------------------------------------------------------- 3. the stray party --

do $$
declare v_id uuid; v_name text;
begin
  select id, name into v_id, v_name from parties
   where name = 'TEST' and party_type = 'b2b_agent'
     and not exists (select 1 from accounts a where a.party_id = parties.id);
  if v_id is null then
    raise notice 'No stray TEST party to remove.';
    return;
  end if;
  -- Refuse rather than cascade if anything has started using it since.
  if exists (select 1 from trade_documents where party_id = v_id)
  or exists (select 1 from umrah_groups where agent_id = v_id)
  or exists (select 1 from b2b_agent_users where agent_id = v_id)
  or exists (select 1 from transport_agent_rates where agent_id = v_id)
  or exists (select 1 from car_contracts where customer_id = v_id) then
    raise exception 'The TEST party is spoken for now — not deleting it.';
  end if;
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  select company_id, null, 'party_deleted', 'party', v_id,
         jsonb_build_object('name', v_name, 'why', 'stray party with no ledger account')
    from parties where id = v_id;
  delete from parties where id = v_id;
  raise notice 'Removed the stray party %.', v_name;
end $$;

-- ------------------------------------------------------ 4. the old backups --

drop table if exists backup_bill_lines_removed;
drop table if exists backup_bill_links_removed;
drop table if exists backup_bills_removed;
drop table if exists backup_clean_car_commissions;
drop table if exists backup_clean_car_contracts;
drop table if exists backup_clean_car_installments;
drop table if exists backup_clean_car_po_items;
drop table if exists backup_clean_car_purchase_orders;
drop table if exists backup_clean_car_service_charges;
drop table if exists backup_clean_car_vehicles;
drop table if exists backup_clean_journal_entries;
drop table if exists backup_clean_journal_lines;
drop table if exists backup_journal_entries_removed;
drop table if exists backup_journal_lines_removed;
drop table if exists backup_payment_entries_removed;
drop table if exists backup_payment_lines_removed;
drop table if exists backup_payments_removed;
drop table if exists backup_transport_entry_fix;
