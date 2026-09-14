-- ============================================================
-- 381 — Voucher numbering is the user's
--
-- Every number the ERP issues comes from doc_sequences (prefix, digits, next
-- number) through next_doc_number() — but the rows were only ever seeded by
-- migrations, so the business could not choose its own. Settings → Company →
-- Voucher Numbering is the screen now; these are its two doors:
--
--   doc_sequences_list()   every series of the company, with the last number
--                          issued, and the one setting below
--   doc_sequence_save()    prefix, digits and next number of one series. The
--                          next number moves FORWARD only: a number already
--                          issued is never issued again.
--
-- And one setting, ledger_uses_doc_no: when on, the ledger entry behind a
-- trade voucher carries the document's own number (PV-00003 posts as
-- PV-00003) instead of one from its own series (JPV-00004). There was never
-- an accounting reason for the two to differ; it is the business's choice.
--
-- The Car Invoice and Car Receipt were numbered by raw Postgres sequences
-- with 'CI-' and 'RCP-' written into the routine, outside the table and so
-- outside the screen. Their numbering line is replaced in place — the rest of
-- each routine is untouched — and a doc_sequences row is seeded from the
-- highest number already issued, so the series carries on where it was.
-- ============================================================
begin;

-- ── the list ───────────────────────────────────────────────────────────────
create or replace function public.doc_sequences_list()
returns jsonb
language sql stable security definer
set search_path to 'public'
as $function$
  select case when not is_staff() or not staff_has_perm('system.config') then null else
    jsonb_build_object(
      'rows', (select coalesce(jsonb_agg(jsonb_build_object(
                 'doc_type', s.doc_type, 'prefix', s.prefix, 'padding', s.padding, 'next_number', s.next_number,
                 'last_issued', case when s.next_number > 1
                   then s.prefix || lpad((s.next_number - 1)::text, greatest(coalesce(s.padding, 0), length((s.next_number - 1)::text)), '0') end)
                 order by s.doc_type), '[]'::jsonb)
               from doc_sequences s where s.company_id = auth_company_id()),
      'ledger_uses_doc_no', coalesce((select value = 'true' from erp_settings where key = 'ledger_uses_doc_no'), false))
  end;
$function$;
revoke all on function public.doc_sequences_list() from public, anon;
grant execute on function public.doc_sequences_list() to authenticated;

-- ── one series ─────────────────────────────────────────────────────────────
create or replace function public.doc_sequence_save(p_doc_type text, p_prefix text, p_padding int, p_next int)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $function$
declare v_co uuid := auth_company_id(); v_old doc_sequences; v_prefix text;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  -- Numbering is administration, so the key has to be ticked, not merely unrestricted.
  if not (has_role('admin') or staff_perm_strict('system.config')) then
    raise exception 'Only an administrator, or a user given Configuration, may change numbering';
  end if;
  if p_doc_type is null or p_doc_type !~ '^[a-z0-9_]{1,60}$' then raise exception 'Bad series key'; end if;
  v_prefix := btrim(coalesce(p_prefix, ''));
  if length(v_prefix) > 12 then raise exception 'A prefix is at most 12 characters'; end if;
  if v_prefix ~ '\s' then raise exception 'A prefix cannot contain spaces'; end if;
  if p_padding is null or p_padding < 0 or p_padding > 10 then raise exception 'Digits must be between 0 and 10'; end if;
  if p_next is null or p_next < 1 then raise exception 'The next number must be at least 1'; end if;

  select * into v_old from doc_sequences where company_id = v_co and doc_type = p_doc_type;
  if found and p_next < v_old.next_number then
    raise exception 'The next number cannot go below % — numbers up to % have already been issued', v_old.next_number, v_old.next_number - 1;
  end if;
  insert into doc_sequences(company_id, doc_type, prefix, padding, next_number)
  values (v_co, p_doc_type, v_prefix, p_padding, p_next)
  on conflict (company_id, doc_type) do update
    set prefix = excluded.prefix, padding = excluded.padding, next_number = excluded.next_number;

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_co, auth.uid(), 'doc_sequence_changed', 'doc_sequence', null,
          jsonb_build_object('doc_type', p_doc_type,
            'from', case when v_old.id is not null then jsonb_build_object('prefix', v_old.prefix, 'padding', v_old.padding, 'next', v_old.next_number) end,
            'to', jsonb_build_object('prefix', v_prefix, 'padding', p_padding, 'next', p_next)));
  return jsonb_build_object('doc_type', p_doc_type, 'prefix', v_prefix, 'padding', p_padding, 'next_number', p_next,
                            'will_read', v_prefix || lpad(p_next::text, greatest(p_padding, length(p_next::text)), '0'));
end $function$;
revoke all on function public.doc_sequence_save(text, text, int, int) from public, anon;
grant execute on function public.doc_sequence_save(text, text, int, int) to authenticated;

-- ── the setting ────────────────────────────────────────────────────────────
create or replace function public.doc_numbering_settings_save(p_ledger_uses_doc_no boolean)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $function$
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if not (has_role('admin') or staff_perm_strict('system.config')) then
    raise exception 'Only an administrator, or a user given Configuration, may change numbering';
  end if;
  insert into erp_settings(key, value, updated_at) values ('ledger_uses_doc_no', case when p_ledger_uses_doc_no then 'true' else 'false' end, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (auth_company_id(), auth.uid(), 'doc_numbering_setting', 'erp_setting', null,
          jsonb_build_object('ledger_uses_doc_no', p_ledger_uses_doc_no));
  return jsonb_build_object('ledger_uses_doc_no', p_ledger_uses_doc_no);
end $function$;
revoke all on function public.doc_numbering_settings_save(boolean) from public, anon;
grant execute on function public.doc_numbering_settings_save(boolean) to authenticated;

-- ── the ledger entry may carry the document's number ───────────────────────
create or replace function public.gl_post_internal(p_company uuid, p_date date, p_memo text, p_doc_type text, p_source text, p_reference text, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_entry uuid; v_no text; ln jsonb; d numeric(18,2); c numeric(18,2); v_closed date;
begin
  if p_company is null then raise exception 'gl_post_internal: no company'; end if;
  select closed_through into v_closed from acct_settings where company_id = p_company;
  if v_closed is not null and p_date <= v_closed then
    raise exception 'Period is closed through % — cannot post on %', v_closed, p_date;
  end if;
  perform gl_validate(p_company, p_lines);
  -- A trade document's entry carries the document's own number when the
  -- business has said so, and that number is free (an unposted document's
  -- old entry is gone before it re-posts, so it is).
  if p_doc_type like 'gl\_trade\_%' and nullif(p_reference, '') is not null
     and coalesce((select value = 'true' from erp_settings where key = 'ledger_uses_doc_no'), false)
     and not exists (select 1 from journal_entries where company_id = p_company and entry_no = p_reference) then
    v_no := p_reference;
  else
    v_no := next_doc_number(p_company, p_doc_type);
  end if;
  insert into journal_entries(company_id, entry_no, entry_date, memo, status, source, reference, created_by)
  values (p_company, v_no, p_date, p_memo, 'posted', p_source, p_reference, auth.uid())
  returning id into v_entry;
  for ln in select * from jsonb_array_elements(p_lines) loop
    d := round(coalesce((ln->>'debit')::numeric, 0), 2);
    c := round(coalesce((ln->>'credit')::numeric, 0), 2);
    if d = 0 and c = 0 then continue; end if;
    insert into journal_lines(entry_id, account_id, description, debit, credit, cost_center, tag_area)
    values (v_entry, (ln->>'account_id')::uuid, ln->>'description', d, c, ln->>'cost_center', ln->>'tag_area');
  end loop;
  return jsonb_build_object('entry_id', v_entry, 'entry_no', v_no);
end $function$;
revoke all on function public.gl_post_internal(uuid, date, text, text, text, text, jsonb) from public, anon, authenticated;

-- ── the Car Invoice and Car Receipt number from the table ──────────────────
insert into doc_sequences(company_id, doc_type, prefix, padding, next_number)
select c.id, 'car_contract', 'CI-', 6,
       greatest((select coalesce(max(substring(contract_no from '\d+$')::int), 0) + 1 from car_contracts where company_id = c.id),
                (select last_value + 1 from car_contract_seq))
  from companies c
on conflict (company_id, doc_type) do nothing;
insert into doc_sequences(company_id, doc_type, prefix, padding, next_number)
select c.id, 'car_receipt', 'RCP-', 6,
       greatest((select coalesce(max(substring(receipt_no from '\d+$')::int), 0) + 1 from car_receipts where company_id = c.id),
                (select last_value + 1 from car_receipt_seq))
  from companies c
on conflict (company_id, doc_type) do nothing;

do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'car_contract_save';
  if position($x$v_no := 'CI-' || lpad(nextval('car_contract_seq')::text, 6, '0')$x$ in v_def) = 0 then
    raise exception '381: car_contract_save does not carry the numbering line expected';
  end if;
  execute replace(v_def, $x$v_no := 'CI-' || lpad(nextval('car_contract_seq')::text, 6, '0')$x$,
                         $x$v_no := next_doc_number(v_company, 'car_contract')$x$);

  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'car_receipt_save';
  if position($x$v_no := 'RCP-' || lpad(nextval('car_receipt_seq')::text, 6, '0')$x$ in v_def) = 0 then
    raise exception '381: car_receipt_save does not carry the numbering line expected';
  end if;
  execute replace(v_def, $x$v_no := 'RCP-' || lpad(nextval('car_receipt_seq')::text, 6, '0')$x$,
                         $x$v_no := next_doc_number(v_company, 'car_receipt')$x$);
end $$;

-- ── post-conditions ────────────────────────────────────────────────────────
do $chk$
declare v_bad int; r jsonb; v_next int; v_co uuid;
begin
  select count(*) into v_bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('car_contract_save', 'car_receipt_save')
     and pg_get_functiondef(p.oid) like '%nextval(%';
  if v_bad > 0 then raise exception '381: a car routine still numbers from a raw sequence'; end if;
  select count(*) into v_bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('doc_sequences_list', 'doc_sequence_save', 'doc_numbering_settings_save')
     and (not has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'));
  if v_bad > 0 then raise exception '381: the numbering routines are granted wrongly'; end if;
  if (select next_number from doc_sequences where doc_type = 'car_contract') <= 5 then
    raise exception '381: the Car Invoice series does not continue past CI-000005';
  end if;

  -- As the Super Admin: the list reads, a series moves forward, and refuses to move back. Rolled back.
  begin
    perform set_config('request.jwt.claims', '{"sub":"edf3fa71-27e2-4cb1-af62-9afd685abefe","role":"authenticated"}', true);
    v_co := auth_company_id();
    r := doc_sequences_list();
    if r is null or jsonb_array_length(r->'rows') < 30 then raise exception '381 rehearsal: list is %', r; end if;
    select next_number into v_next from doc_sequences where company_id = v_co and doc_type = 'gl_payment';
    r := doc_sequence_save('gl_payment', 'PMT-', 5, v_next + 10);
    if r->>'will_read' <> 'PMT-' || lpad((v_next + 10)::text, 5, '0') then raise exception '381 rehearsal: save gave %', r; end if;
    if next_doc_number(v_co, 'gl_payment') <> r->>'will_read' then raise exception '381 rehearsal: the next number issued is not the one promised'; end if;
    begin
      perform doc_sequence_save('gl_payment', 'PMT-', 5, 1);
      raise exception '381 rehearsal: a backward move was accepted';
    exception when others then
      if sqlerrm not like 'The next number cannot go below%' then raise; end if;
    end;
    perform doc_numbering_settings_save(true);
    if not (doc_sequences_list()->>'ledger_uses_doc_no')::boolean then raise exception '381 rehearsal: setting did not stick'; end if;
    raise exception 'ROLLBACK_REHEARSAL';
  exception when others then
    if sqlerrm <> 'ROLLBACK_REHEARSAL' then raise; end if;
  end;
  raise notice '381 ok';
end $chk$;

commit;
