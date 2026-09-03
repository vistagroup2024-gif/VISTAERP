-- 283 Second pass on access control.
--
-- Two things:
--
-- 1. USER ADMINISTRATION IS DELEGABLE, AND STRICT. Editing another user's
--    restrictions, rights and login window was admin-only. It is now the admin
--    OR whoever the admin grants the matching users.* permission to. The check
--    is deliberately STRICT: unlike staff_has_perm(), an empty permissions map
--    does NOT pass. Empty means "unrestricted" for ordinary screens, but it
--    must never mean "may hand out access", or a brand-new account with nothing
--    ticked could administer everybody.
--    A user can also no longer write their own profile row at all — the
--    self-update policy is gone, so name and phone are an admin edit too.
--
-- 2. THE REMAINING SCREEN RIGHTS ARE ENFORCED. Create / Edit / Delete were
--    honoured by the two shared voucher components; now the database refuses
--    them as well, and the two rights that had nowhere to bite —
--    "edit documents entered by other users" and "edit documents already
--    authorised" — are wired to created_by and to the approval record.

-- ── strict permission read ──────────────────────────────────────────────────
-- staff_has_perm() treats an empty map as unrestricted. This does not: the key
-- must be explicitly granted, or the caller must be an admin. Use it for
-- anything that hands out access to somebody else.
create or replace function public.staff_perm_strict(p_key text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select is_staff()
     and (has_role('admin')
          or coalesce((select (permissions ->> p_key)::boolean from profiles where id = auth.uid()), false));
$$;

-- Guard used by every user-administration routine below: the caller must hold
-- the permission, must not be reaching for their own row unless they are an
-- admin, and must not be reaching for an admin's row unless they are one too.
create or replace function public.staff_admin_guard(p_target uuid, p_key text)
returns void language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not staff_perm_strict(p_key) then
    raise exception 'You do not have permission to manage users (% required)', p_key;
  end if;
  if p_target is null then return; end if;
  if not exists (select 1 from profiles where id = p_target and company_id = auth_company_id()) then
    raise exception 'User not found';
  end if;
  if not has_role('admin') then
    if p_target = auth.uid() then
      raise exception 'You cannot change your own access — ask an administrator.';
    end if;
    if exists (select 1 from user_roles r where r.user_id = p_target and r.role = 'admin') then
      raise exception 'Only an administrator can change an administrator''s account.';
    end if;
  end if;
end $$;

-- ── a user no longer writes their own profile row ───────────────────────────
-- The trigger from 282 stays as a second line of defence in case a policy is
-- ever added back.
drop policy if exists profiles_self_update on profiles;

-- ── user administration, delegable ──────────────────────────────────────────
create or replace function public.update_staff_user(
  p_id uuid, p_full_name text, p_email text, p_phone text, p_department text,
  p_designation text, p_is_active boolean, p_roles text[], p_permissions jsonb)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  perform staff_admin_guard(p_id, 'users.edit');
  -- Handing out module permissions is the manage_roles right, not plain edit.
  if p_permissions is distinct from (select permissions from profiles where id = p_id) then
    perform staff_admin_guard(p_id, 'users.manage_roles');
  end if;
  update profiles set full_name = p_full_name, email = nullif(p_email,''), phone = nullif(p_phone,''),
    department = nullif(p_department,''), designation = nullif(p_designation,''),
    is_active = p_is_active, permissions = coalesce(p_permissions,'{}'::jsonb)
  where id = p_id;
  -- Intentionally does NOT modify user_roles (permissions govern access; the
  -- admin role is never stripped by an ordinary profile edit).
end $function$;

create or replace function public.reset_staff_password(p_id uuid, p_password text)
returns void language plpgsql security definer set search_path to 'public', 'extensions' as $function$
begin
  perform staff_admin_guard(p_id, 'users.reset_password');
  if length(coalesce(p_password,'')) < 6 then raise exception 'Password must be at least 6 characters'; end if;
  update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now() where id = p_id;
  delete from auth.sessions where user_id = p_id;              -- log out all devices
end $function$;

create or replace function public.delete_staff_user(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  perform staff_admin_guard(p_id, 'users.delete');
  if p_id = auth.uid() then raise exception 'You cannot delete your own account.'; end if;
  delete from user_roles where user_id = p_id;
  delete from auth.users where id = p_id;   -- profiles + identities cascade
end $function$;

create or replace function public.create_staff_user_v2(
  p_username text, p_password text, p_full_name text, p_email text, p_phone text,
  p_department text, p_designation text, p_roles text[], p_permissions jsonb)
returns uuid language plpgsql security definer set search_path to 'public', 'extensions' as $function$
declare v_email text; v_user_id uuid;
begin
  perform staff_admin_guard(null, 'users.create');
  -- Only an admin can mint another admin; a delegated user manager cannot use
  -- a new account to give itself the role it does not have.
  if not has_role('admin') and coalesce(array_position(p_roles, 'admin'), 0) > 0 then
    raise exception 'Only an administrator can create an administrator.';
  end if;
  if p_permissions is not null and p_permissions <> '{}'::jsonb and not staff_perm_strict('users.manage_roles') then
    raise exception 'You do not have permission to set a user''s access (users.manage_roles required)';
  end if;
  v_email := lower(trim(p_username)) || '@vista.local';

  insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, aud, role, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, email_change_confirm_status, reauthentication_token)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', v_email,
    crypt(p_password, gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', p_full_name), 'authenticated', 'authenticated', now(), now(),
    '', '', '', '', '', 0, '')
  returning id into v_user_id;

  insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_user_id,
    jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', true),
    'email', v_user_id::text, now(), now(), now());

  insert into profiles(id, company_id, full_name, email, phone, department, designation, permissions, is_active)
  values (v_user_id, auth_company_id(), p_full_name, nullif(p_email,''), nullif(p_phone,''),
    nullif(p_department,''), nullif(p_designation,''), coalesce(p_permissions,'{}'::jsonb), true)
  on conflict (id) do update set full_name = excluded.full_name, company_id = excluded.company_id,
    email = excluded.email, phone = excluded.phone, department = excluded.department,
    designation = excluded.designation, permissions = excluded.permissions;

  if p_roles is not null and array_length(p_roles,1) is not null then
    insert into user_roles(user_id, role) select v_user_id, unnest(p_roles)::app_role on conflict do nothing;
  end if;
  return v_user_id;
end $function$;

-- Reading and writing one user's restrictions / rights / window: manage_roles.
create or replace function public.staff_user_access(p_id uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'doc_rights',    coalesce(p.doc_rights, '{}'::jsonb),
    'scope_exclude', coalesce(p.scope_exclude, '{}'::jsonb),
    'login_date_from', p.login_date_from, 'login_date_to', p.login_date_to,
    'login_time_from', p.login_time_from, 'login_time_to', p.login_time_to,
    'scopes', coalesce((
      select jsonb_object_agg(kind, ids) from (
        select kind, jsonb_agg(ref_id) as ids from staff_scopes where user_id = p.id group by kind
      ) s), '{}'::jsonb)
  )
  from profiles p
  where p.id = p_id and p.company_id = auth_company_id() and staff_perm_strict('users.manage_roles');
$$;

create or replace function public.staff_user_set_access(
  p_id uuid, p_doc_rights jsonb, p_scopes jsonb, p_scope_exclude jsonb,
  p_login_date_from date, p_login_date_to date,
  p_login_time_from time, p_login_time_to time)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_kind text; v_id uuid;
begin
  perform staff_admin_guard(p_id, 'users.manage_roles');

  update profiles set
    doc_rights      = coalesce(p_doc_rights, '{}'::jsonb),
    scope_exclude   = coalesce(p_scope_exclude, '{}'::jsonb),
    login_date_from = p_login_date_from,
    login_date_to   = p_login_date_to,
    login_time_from = p_login_time_from,
    login_time_to   = p_login_time_to
  where id = p_id;

  delete from staff_scopes where user_id = p_id;
  for v_kind in select jsonb_object_keys(coalesce(p_scopes, '{}'::jsonb)) loop
    if v_kind not in ('account', 'product', 'cost_center', 'tag_area') then
      raise exception 'Unknown restriction %', v_kind;
    end if;
    for v_id in select (jsonb_array_elements_text(p_scopes -> v_kind))::uuid loop
      insert into staff_scopes(user_id, kind, ref_id) values (p_id, v_kind, v_id)
      on conflict do nothing;
    end loop;
  end loop;
end $$;

-- ── screen rights, enforced in the database ─────────────────────────────────
-- The screen a journal voucher belongs to. An unmapped source returns null,
-- which means "not a rights-managed screen" and is allowed: a module's own
-- automatic posting must never be blocked by a data-entry right.
create or replace function public.staff_doc_key(p_source text)
returns text language sql immutable as $$
  select case p_source
    when 'gl_receipt' then 'receipt'
    when 'gl_payment' then 'payment'
    when 'gl_contra'  then 'contra'
    when 'gl_petty'   then 'petty_cash'
    when 'gl_journal' then 'journal'
    when 'gl_invoice' then 'invoice_bill'
    when 'gl_party_invoice' then 'invoice_bill'
    else null
  end;
$$;

create or replace function public.staff_require_doc(p_doc text, p_right text)
returns void language plpgsql stable security definer set search_path to 'public' as $$
begin
  if p_doc is null then return; end if;
  if not staff_doc_right(p_doc, p_right) then
    raise exception 'You do not have % rights on this screen.', p_right;
  end if;
end $$;

-- Edit / delete of an existing journal voucher: the right itself, then whether
-- this particular document is somebody else's or has been authorised.
create or replace function public.staff_require_journal_right(p_entry uuid, p_right text)
returns void language plpgsql stable security definer set search_path to 'public' as $$
declare v_doc text; v_by uuid; v_auth boolean;
begin
  select staff_doc_key(e.source), e.created_by,
         exists (select 1 from pending_vouchers pv where pv.posted_entry_id = e.id)
    into v_doc, v_by, v_auth
  from journal_entries e where e.id = p_entry;
  if v_doc is null then return; end if;

  perform staff_require_doc(v_doc, p_right);
  if v_by is not null and v_by <> auth.uid() and not staff_doc_right(v_doc, 'edit_others') then
    raise exception 'This voucher was entered by another user and you may not change it.';
  end if;
  if v_auth and not staff_doc_right(v_doc, 'edit_authorized') then
    raise exception 'This voucher has been authorised and you may not change it.';
  end if;
end $$;

create or replace function public.staff_require_trade_right(p_id uuid, p_right text)
returns void language plpgsql stable security definer set search_path to 'public' as $$
declare v_doc text; v_by uuid; v_auth boolean;
begin
  select d.doc_type, d.created_by,
         exists (select 1 from pending_vouchers pv where pv.payload->>'doc_id' = d.id::text)
    into v_doc, v_by, v_auth
  from trade_documents d where d.id = p_id and d.company_id = auth_company_id();
  if v_doc is null then return; end if;

  perform staff_require_doc(v_doc, p_right);
  if v_by is not null and v_by <> auth.uid() and not staff_doc_right(v_doc, 'edit_others') then
    raise exception 'This document was entered by another user and you may not change it.';
  end if;
  if v_auth and not staff_doc_right(v_doc, 'edit_authorized') then
    raise exception 'This document has been authorised and you may not change it.';
  end if;
end $$;

-- ── the journal voucher choke point carries the right ───────────────────────
-- Both gl_voucher_update and gl_voucher_void go through this one guard, so the
-- right they need becomes an argument to it. The old one-argument signature is
-- dropped so a bare call cannot stay ambiguous.
drop function if exists public.acct_voucher_guard(uuid);
create or replace function public.acct_voucher_guard(p_entry uuid, p_right text default 'edit')
 returns journal_entries language plpgsql security definer set search_path to 'public'
as $function$
declare e journal_entries%rowtype; v_closed date;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into e from journal_entries where id = p_entry and company_id = auth_company_id();
  if not found then raise exception 'Voucher not found'; end if;
  perform staff_require_journal_right(p_entry, p_right);
  if e.status <> 'posted' then raise exception 'Only a posted voucher can be changed (this one is %).', e.status; end if;
  if not acct_is_manual_voucher(e.source) then
    raise exception 'This voucher was generated by another module and cannot be edited here.';
  end if;
  select closed_through into v_closed from acct_settings where company_id = e.company_id;
  if v_closed is not null and e.entry_date <= v_closed then
    raise exception 'The period is closed through % — this voucher cannot be changed.', v_closed;
  end if;
  if exists (select 1 from allocations where settle_entry_id = e.id) then
    raise exception 'This voucher has bill allocations against it — remove them first.';
  end if;
  return e;
end $function$;

-- Void asks for Delete, not Edit.
create or replace function public.gl_voucher_void(p_entry uuid, p_reason text default null)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare e journal_entries%rowtype;
begin
  e := acct_voucher_guard(p_entry, 'delete');
  update journal_entries set status = 'void',
    memo = coalesce(memo,'') || case when p_reason is not null and btrim(p_reason) <> '' then ' [VOID: ' || p_reason || ']' else ' [VOID]' end
  where id = p_entry;
  perform acct_log(e.company_id, 'voided', e.source, e.entry_no, jsonb_build_object('entry_id', p_entry, 'reason', p_reason));
  return jsonb_build_object('entry_id', p_entry, 'entry_no', e.entry_no, 'voided', true);
end $function$;

grant execute on function public.acct_voucher_guard(uuid, text) to authenticated;

-- ── trade documents ─────────────────────────────────────────────────────────
create or replace function trade_doc_save(p_type text, p_prefix text, p_id uuid, p_header jsonb, p_lines jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_co uuid := auth_company_id(); v_id uuid := p_id; v_no text; ln jsonb; i int := 0;
        v_sub numeric(18,2) := 0; v_round numeric(18,2); v_src uuid; v_car uuid;
        v_status text; v_posted jsonb;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  -- Access tab: Create for a new document, Edit for an existing one, plus the
  -- two rights that decide whether somebody else's or an authorised document
  -- may be touched at all.
  if p_id is null then
    perform staff_require_doc(p_type, 'create');
  else
    perform staff_require_trade_right(p_id, 'edit');
  end if;
  v_round := round(coalesce((p_header->>'round_off')::numeric, 0), 2);
  v_src := nullif(p_header->>'source_doc_id','')::uuid;
  v_car := nullif(p_header->>'source_car_contract','')::uuid;
  select coalesce(sum(round(coalesce((x->>'amount')::numeric,0),2)), 0) into v_sub
    from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) x;

  if p_type = 'sales_invoice' and is_car_cost_center(p_header->>'cost_center') then
    raise exception 'A car sale is invoiced in Car Sales, not with a Sales Invoice.';
  end if;

  if v_id is not null then
    select status into v_status from trade_documents where id = v_id and company_id = v_co;
    if v_status = 'awaiting_approval' then
      raise exception 'This voucher is awaiting authorisation and cannot be changed.';
    end if;
  end if;

  if v_src is not null and exists (
      select 1 from trade_documents t
      where t.company_id = v_co and t.doc_type = p_type and t.source_doc_id = v_src
        and (v_id is null or t.id <> v_id)) then
    raise exception 'That document has already been loaded into another %.', p_type;
  end if;
  if v_car is not null and exists (
      select 1 from trade_documents t
      where t.company_id = v_co and t.doc_type = p_type and t.source_car_contract = v_car
        and (v_id is null or t.id <> v_id)) then
    raise exception 'That Car Invoice has already been loaded into another %.', p_type;
  end if;

  if v_id is null then
    insert into doc_sequences(company_id, doc_type, prefix)
      values (v_co, 'trade_'||p_type, coalesce(nullif(p_prefix,''), upper(left(p_type,3))||'-'))
      on conflict (company_id, doc_type) do nothing;
    v_no := next_doc_number(v_co, 'trade_'||p_type);
    insert into trade_documents(company_id, doc_type, doc_no, doc_date, party_id, cost_center, tag_area, reference,
      narration, terms, mode_of_payment, due_date, delivery_date, currency, round_off, subtotal, total, status, meta,
      source_doc_id, source_car_contract, created_by)
    values (v_co, p_type, v_no,
      coalesce(nullif(p_header->>'doc_date','')::date, current_date), nullif(p_header->>'party_id','')::uuid,
      nullif(p_header->>'cost_center',''), nullif(p_header->>'tag_area',''), nullif(p_header->>'reference',''),
      nullif(p_header->>'narration',''), nullif(p_header->>'terms',''), nullif(p_header->>'mode_of_payment',''),
      nullif(p_header->>'due_date','')::date, nullif(p_header->>'delivery_date','')::date,
      coalesce(nullif(p_header->>'currency',''),'SAR'), v_round, v_sub, v_sub + v_round,
      coalesce(nullif(p_header->>'status',''),'open'), coalesce(p_header->'meta','{}'::jsonb), v_src, v_car, auth.uid())
    returning id, doc_no into v_id, v_no;
  else
    update trade_documents set
      doc_date = coalesce(nullif(p_header->>'doc_date','')::date, current_date), party_id = nullif(p_header->>'party_id','')::uuid,
      cost_center = nullif(p_header->>'cost_center',''), tag_area = nullif(p_header->>'tag_area',''), reference = nullif(p_header->>'reference',''),
      narration = nullif(p_header->>'narration',''), terms = nullif(p_header->>'terms',''), mode_of_payment = nullif(p_header->>'mode_of_payment',''),
      due_date = nullif(p_header->>'due_date','')::date, delivery_date = nullif(p_header->>'delivery_date','')::date,
      currency = coalesce(nullif(p_header->>'currency',''),'SAR'), round_off = v_round, subtotal = v_sub, total = v_sub + v_round,
      meta = coalesce(p_header->'meta','{}'::jsonb),
      source_doc_id = coalesce(v_src, source_doc_id), source_car_contract = coalesce(v_car, source_car_contract),
      updated_at = now()
    where id = v_id and company_id = v_co;
    if not found then raise exception 'Document not found'; end if;
    select doc_no into v_no from trade_documents where id = v_id;
    delete from trade_document_lines where doc_id = v_id;
  end if;

  for ln in select * from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) loop
    i := i + 1;
    if coalesce(nullif(ln->>'item_name',''), nullif(ln->>'product_id','')) is null and round(coalesce((ln->>'amount')::numeric,0),2) = 0 then continue; end if;
    insert into trade_document_lines(doc_id, sort, product_id, item_name, units, quantity, rate, amount, link1, meta)
    values (v_id, i, nullif(ln->>'product_id','')::uuid, nullif(ln->>'item_name',''), nullif(ln->>'units',''),
      round(coalesce((ln->>'quantity')::numeric,0),3), round(coalesce((ln->>'rate')::numeric,0),2),
      round(coalesce((ln->>'amount')::numeric,0),2), nullif(ln->>'link1',''), coalesce(ln->'meta','{}'::jsonb));
  end loop;

  -- The warehouse has to be on the document before the stock moves.
  if p_header ? 'warehouse_id' and nullif(p_header->>'warehouse_id','') is not null then
    update trade_documents set warehouse_id = (p_header->>'warehouse_id')::uuid where id = v_id;
  end if;

  -- Post it, or hand it to the approvers. Paperwork types (quotation, order,
  -- MRN, delivery note) have no GL side and simply save.
  if p_type in ('purchase_voucher','purchase_return','sales_return','sales_invoice') then
    v_posted := trade_doc_post(v_id);
  end if;

  return coalesce(v_posted, '{}'::jsonb) || jsonb_build_object('id', v_id, 'doc_no', v_no);
end $function$;;

create or replace function public.trade_doc_delete(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_gl uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  perform staff_require_trade_right(p_id, 'delete');
  select gl_entry into v_gl from trade_documents where id = p_id and company_id = auth_company_id();
  if not found then raise exception 'Document not found'; end if;
  if v_gl is not null then
    raise exception 'This document is posted to the General Ledger and cannot be deleted.';
  end if;
  delete from trade_documents where id = p_id and company_id = auth_company_id();
end $$;
grant execute on function public.trade_doc_delete(uuid) to authenticated;

-- ── the remaining hand-typed vouchers ───────────────────────────────────────
-- Each of these is the only way into its screen (nothing else in the database
-- calls them), so the screen's right goes straight at the top. party_invoice is
-- deliberately NOT among them: the Visa and Hotel modules raise invoices
-- through it, so it stays an engine and gets a screen wrapper instead.

create or replace function pdc_create(
  p_company uuid, p_direction text, p_party_account uuid, p_bank_account uuid,
  p_cheque_no text, p_bank_name text, p_amount numeric, p_cheque_date date, p_narration text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb := null; v_chq uuid; v_id uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  perform staff_require_doc('pdc', 'create');
  if coalesce(p_amount,0) <= 0 then raise exception 'Amount must be positive'; end if;
  if p_direction = 'received' then
    select id into v_chq from accounts where company_id = p_company and code = '1-02-02';
    v := gl_post(p_company, current_date, coalesce(p_narration,'PDC received ')||coalesce(p_cheque_no,''), 'gl_pdc', 'pdc_in', p_cheque_no,
      jsonb_build_array(
        jsonb_build_object('account_id', v_chq::text, 'debit', round(p_amount,2), 'credit', 0, 'description', 'Cheque in hand'),
        jsonb_build_object('account_id', p_party_account::text, 'debit', 0, 'credit', round(p_amount,2), 'description', p_narration)));
    perform allocate_fifo(p_company, p_party_account, (v->>'entry_id')::uuid, p_amount, 'PDC');
  end if;
  insert into pdc_register(company_id, direction, party_account_id, bank_account_id, cheque_no, bank_name,
                           amount_base, cheque_date, narration, in_entry_id, created_by)
  values (p_company, p_direction, p_party_account, p_bank_account, p_cheque_no, p_bank_name,
          round(p_amount,2), p_cheque_date, p_narration, (v->>'entry_id')::uuid, auth.uid())
  returning id into v_id;
  perform acct_log(p_company, 'pdc_created', 'gl_pdc', p_cheque_no, jsonb_build_object('id', v_id, 'dir', p_direction));
  return jsonb_build_object('id', v_id);
end $$;

create or replace function pdc_update(p_company uuid, p_pdc uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p pdc_register%rowtype; v jsonb; v_chq uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  perform staff_require_doc('pdc', 'edit');
  select * into p from pdc_register where id = p_pdc and company_id = p_company;
  if not found then raise exception 'PDC not found'; end if;
  select id into v_chq from accounts where company_id = p_company and code = '1-02-02';

  if p_status = 'deposited' then
    update pdc_register set status = 'deposited' where id = p_pdc;
  elsif p_status = 'cleared' then
    if p.direction = 'received' then
      v := gl_post(p_company, current_date, 'PDC cleared '||coalesce(p.cheque_no,''), 'gl_pdc', 'pdc_clear', p.cheque_no,
        jsonb_build_array(
          jsonb_build_object('account_id', p.bank_account_id::text, 'debit', p.amount_base, 'credit', 0, 'description', 'Cheque cleared'),
          jsonb_build_object('account_id', v_chq::text, 'debit', 0, 'credit', p.amount_base, 'description', 'Cheque in hand')));
    else
      -- issued: pay the supplier now (Dr supplier, Cr bank) and allocate.
      v := gl_post(p_company, current_date, 'PDC issued cleared '||coalesce(p.cheque_no,''), 'gl_pdc', 'pdc_clear', p.cheque_no,
        jsonb_build_array(
          jsonb_build_object('account_id', p.party_account_id::text, 'debit', p.amount_base, 'credit', 0, 'description', p.narration),
          jsonb_build_object('account_id', p.bank_account_id::text, 'debit', 0, 'credit', p.amount_base, 'description', 'Cheque paid')));
      perform allocate_fifo(p_company, p.party_account_id, (v->>'entry_id')::uuid, p.amount_base, 'PDC issued');
    end if;
    update pdc_register set status = 'cleared', clear_entry_id = (v->>'entry_id')::uuid where id = p_pdc;
  elsif p_status = 'bounced' then
    if p.direction = 'received' then
      -- reverse the receipt (Dr customer, Cr cheque-in-hand) and undo its allocations.
      v := gl_post(p_company, current_date, 'PDC bounced '||coalesce(p.cheque_no,''), 'gl_pdc', 'pdc_bounce', p.cheque_no,
        jsonb_build_array(
          jsonb_build_object('account_id', p.party_account_id::text, 'debit', p.amount_base, 'credit', 0, 'description', 'Cheque bounced'),
          jsonb_build_object('account_id', v_chq::text, 'debit', 0, 'credit', p.amount_base, 'description', 'Cheque in hand')));
      update open_items o set outstanding_base = outstanding_base + a.amt, status = 'open'
        from (select open_item_id, sum(amount_base) amt from allocations where settle_entry_id = p.in_entry_id group by open_item_id) a
        where o.id = a.open_item_id;
      delete from allocations where settle_entry_id = p.in_entry_id;
    end if;
    update pdc_register set status = 'bounced', clear_entry_id = (v->>'entry_id')::uuid where id = p_pdc;
  elsif p_status = 'cancelled' then
    update pdc_register set status = 'cancelled' where id = p_pdc;
  else
    raise exception 'Unknown PDC status %', p_status;
  end if;
  perform acct_log(p_company, 'pdc_'||p_status, 'gl_pdc', p.cheque_no, jsonb_build_object('id', p_pdc));
  return jsonb_build_object('status', p_status);
end $$;

create or replace function bank_create_entry(p_company uuid, p_line uuid, p_contra uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare bl bank_lines%rowtype; v jsonb; lines jsonb; v_ll uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  perform staff_require_doc('bank_rec', 'create');
  select * into bl from bank_lines where id = p_line and company_id = p_company;
  if not found then raise exception 'Line not found'; end if;
  if bl.amount >= 0 then
    lines := jsonb_build_array(
      jsonb_build_object('account_id', bl.bank_account_id::text, 'debit', bl.amount, 'credit', 0, 'description', bl.description),
      jsonb_build_object('account_id', p_contra::text, 'debit', 0, 'credit', bl.amount, 'description', bl.description));
  else
    lines := jsonb_build_array(
      jsonb_build_object('account_id', p_contra::text, 'debit', -bl.amount, 'credit', 0, 'description', bl.description),
      jsonb_build_object('account_id', bl.bank_account_id::text, 'debit', 0, 'credit', -bl.amount, 'description', bl.description));
  end if;
  v := gl_post(p_company, coalesce(bl.line_date, current_date), coalesce(bl.description,'Bank entry'), 'gl_journal', 'bank_rec', bl.ref, lines);
  select id into v_ll from journal_lines where entry_id = (v->>'entry_id')::uuid and account_id = bl.bank_account_id limit 1;
  update bank_lines set matched_line_id = v_ll, status = 'matched' where id = p_line;
  return jsonb_build_object('entry_no', v->>'entry_no');
end $$;

create or replace function payroll_generate(p_year int, p_month int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_co uuid := auth_company_id(); v_run uuid; v_status text; e employees%rowtype; n int := 0;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  perform staff_require_doc('payroll', 'create');
  select id, status into v_run, v_status from payroll_runs where company_id = v_co and period_year = p_year and period_month = p_month;
  if v_run is null then
    insert into payroll_runs(company_id, period_year, period_month, created_by) values (v_co, p_year, p_month, auth.uid())
      returning id into v_run;
  elsif v_status = 'posted' then
    raise exception 'Payroll for this period is already posted';
  end if;
  delete from payslips where run_id = v_run;
  for e in select * from employees where company_id = v_co and status = 'active' loop
    insert into payslips(run_id, employee_id, basic, allowances, deductions, net)
    values (v_run, e.id, e.basic_salary, e.allowances, e.deductions, e.basic_salary + e.allowances - e.deductions);
    n := n + 1;
  end loop;
  return jsonb_build_object('run_id', v_run, 'employees', n);
end $$;

create or replace function payroll_post(p_run uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_co uuid := auth_company_id(); r payroll_runs%rowtype; v_needed int; v_id uuid;
        v_amt numeric(18,2); v_label text;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  perform staff_require_doc('payroll', 'edit');
  select * into r from payroll_runs where id = p_run and company_id = v_co;
  if not found then raise exception 'Run not found'; end if;
  if r.status = 'posted' then raise exception 'Already posted'; end if;
  if r.status = 'awaiting_approval' then raise exception 'This payroll run is already awaiting authorisation.'; end if;
  -- The gross is what the rule is measured against, the same figure the entry debits.
  select coalesce(sum(basic + allowances), 0) into v_amt from payslips where run_id = p_run;
  v_label := r.period_year || '-' || lpad(r.period_month::text, 2, '0');

  v_needed := acct_approvals_needed(v_co, 'gl_payroll', v_amt);
  if v_needed >= 1 then
    v_id := acct_hold_document(v_co, 'gl_payroll', make_date(r.period_year, r.period_month, 1),
                               'Payroll ' || v_label, 'PR-' || r.period_year || lpad(r.period_month::text, 2, '0'),
                               v_amt, v_needed, 'payroll_post_now', p_run);
    update payroll_runs set status = 'awaiting_approval' where id = p_run;
    return jsonb_build_object('pending', true, 'pending_id', v_id, 'amount', v_amt);
  end if;

  return payroll_post_now(p_run) || jsonb_build_object('pending', false);
end $$;

create or replace function stock_raise_indent(
  p_wh uuid default null, p_items uuid[] default null, p_narration text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_co uuid := auth_company_id(); v_no text; v_id uuid; r jsonb; i int;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  perform staff_require_doc('stock_indents', 'create');

  r := stock_reorder_report(p_wh);
  if p_items is not null then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into r
      from jsonb_array_elements(r) x where (x->>'item_id')::uuid = any(p_items);
  end if;
  if jsonb_array_length(r) = 0 then raise exception 'Nothing is below its reorder level'; end if;

  insert into doc_sequences(company_id, doc_type, prefix, padding)
    values (v_co, 'stock_indent', 'IND-', 4) on conflict (company_id, doc_type) do nothing;
  v_no := next_doc_number(v_co, 'stock_indent');

  insert into stock_indents(company_id, doc_no, warehouse_id, narration, created_by)
    values (v_co, v_no, p_wh, p_narration, auth.uid()) returning id into v_id;

  insert into stock_indent_lines(indent_id, item_id, qty, balance_qty, reorder_level, sort)
  select v_id, (x.v->>'item_id')::uuid, (x.v->>'suggested')::numeric,
         (x.v->>'qty')::numeric, (x.v->>'reorder_level')::numeric, x.ord::int
  from jsonb_array_elements(r) with ordinality as x(v, ord);

  select count(*) into i from stock_indent_lines where indent_id = v_id;
  return jsonb_build_object('id', v_id, 'doc_no', v_no, 'lines', i);
end $$;


-- The Invoice / Bill screen's own entry point. party_invoice stays the shared
-- engine the Visa and Hotel modules post through; this is the typed-by-hand
-- door, and it is the one that asks for the right.
create or replace function public.invoice_bill_save(
  p_company uuid, p_party uuid, p_kind text, p_date date, p_due date, p_narration text,
  p_amount numeric, p_income_expense_account uuid, p_tax numeric, p_reference text,
  p_override_credit boolean default false, p_cost_center text default null, p_salesperson uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  perform staff_require_doc('invoice_bill', 'create');
  return party_invoice(p_company, p_party, p_kind, p_date, p_due, p_narration, p_amount,
                       p_income_expense_account, p_tax, p_reference, p_override_credit,
                       p_cost_center, p_salesperson);
end $$;
grant execute on function public.invoice_bill_save(uuid, uuid, text, date, date, text, numeric, uuid, numeric, text, boolean, text, uuid) to authenticated;
revoke all on function public.invoice_bill_save(uuid, uuid, text, date, date, text, numeric, uuid, numeric, text, boolean, text, uuid) from anon;
