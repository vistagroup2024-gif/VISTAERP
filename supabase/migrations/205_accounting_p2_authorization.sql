-- ============================================================
-- VISTA ERP — Accounting rebuild, PHASE 2
-- Authorization / approval workflow + audit trail + notifications.
--
--   • Documents that need approval are saved PENDING and post the instant the
--     required number of authorizations is reached — never a manual post step.
--   • Maker–checker enforced (creator can't authorise their own, unless admin).
--   • Every submit / authorise / reject / post is written to acct_audit.
--   • gl_post stays the single ledger writer; approval just gates WHEN it runs.
-- ============================================================

-- Can the current staff user authorise vouchers?
create or replace function acct_can_authorize() returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin() or exists (
    select 1 from profiles p where p.id = auth.uid()
      and coalesce((p.permissions->>'accounting.authorize')::boolean, false));
$$;

-- Approval rules: a voucher of doc_type with amount >= min_amount needs
-- approvals_needed authorisations before it posts.
create table if not exists acct_approval_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  doc_type text not null,
  min_amount numeric(18,2) not null default 0,
  approvals_needed int not null default 1,
  active boolean not null default true,
  unique (company_id, doc_type)
);

create table if not exists pending_vouchers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  doc_type text not null,
  entry_date date not null default current_date,
  narration text,
  reference text,
  amount numeric(18,2) not null,
  lines jsonb not null,
  status text not null default 'pending',   -- pending / authorized / rejected / cancelled
  approvals_needed int not null default 1,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  posted_entry_id uuid references journal_entries(id),
  reject_reason text
);
create index if not exists idx_pending_vouchers_feed on pending_vouchers(company_id, status, created_at desc);

create table if not exists pending_voucher_approvals (
  id uuid primary key default gen_random_uuid(),
  pending_id uuid not null references pending_vouchers(id) on delete cascade,
  actor uuid references auth.users(id),
  action text not null,   -- approve / reject
  note text,
  at timestamptz not null default now(),
  unique (pending_id, actor, action)
);

create table if not exists acct_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  actor uuid references auth.users(id),
  action text not null,
  doc_type text,
  ref text,
  detail jsonb,
  at timestamptz not null default now()
);
create index if not exists idx_acct_audit_feed on acct_audit(company_id, at desc);

alter table acct_approval_rules       enable row level security;
alter table pending_vouchers          enable row level security;
alter table pending_voucher_approvals enable row level security;
alter table acct_audit                enable row level security;

create policy acct_rules_staff on acct_approval_rules for all to authenticated
  using (company_id = auth_company_id() and is_staff()) with check (company_id = auth_company_id() and is_staff());
create policy pending_v_staff on pending_vouchers for all to authenticated
  using (company_id = auth_company_id() and is_staff()) with check (company_id = auth_company_id() and is_staff());
create policy pending_va_staff on pending_voucher_approvals for all to authenticated
  using (exists (select 1 from pending_vouchers v where v.id = pending_id and v.company_id = auth_company_id()) and is_staff())
  with check (exists (select 1 from pending_vouchers v where v.id = pending_id and v.company_id = auth_company_id()) and is_staff());
create policy acct_audit_staff on acct_audit for select to authenticated
  using (company_id = auth_company_id() and is_staff());

create or replace function acct_log(p_company uuid, p_action text, p_doc_type text, p_ref text, p_detail jsonb)
returns void language sql security definer set search_path = public as $$
  insert into acct_audit(company_id, actor, action, doc_type, ref, detail)
  values (p_company, auth.uid(), p_action, p_doc_type, p_ref, p_detail);
$$;

-- Validate lines WITHOUT posting; returns the voucher amount (total debit). Raises on
-- any problem. gl_post reuses it so posting and pre-validation never drift.
create or replace function gl_validate(p_company uuid, p_lines jsonb)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare ln jsonb; d numeric(18,2); c numeric(18,2);
  v_debit numeric(18,2) := 0; v_credit numeric(18,2) := 0; v_count int := 0; a accounts%rowtype;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'A voucher needs at least two lines';
  end if;
  for ln in select * from jsonb_array_elements(p_lines) loop
    d := round(coalesce((ln->>'debit')::numeric, 0), 2);
    c := round(coalesce((ln->>'credit')::numeric, 0), 2);
    if d < 0 or c < 0 then raise exception 'Amounts cannot be negative'; end if;
    if d > 0 and c > 0 then raise exception 'A line cannot be both debit and credit'; end if;
    if d = 0 and c = 0 then continue; end if;
    select * into a from accounts where id = (ln->>'account_id')::uuid and company_id = p_company;
    if not found then raise exception 'Account not found on this company'; end if;
    if a.is_group or not a.is_postable then raise exception 'Cannot post to a group account (%)', a.name; end if;
    if a.status <> 'active' then raise exception 'Account % is % — posting blocked', a.name, a.status; end if;
    v_debit := v_debit + d; v_credit := v_credit + c; v_count := v_count + 1;
  end loop;
  if v_count < 2 then raise exception 'A voucher needs at least two non-zero lines'; end if;
  if v_debit <> v_credit then raise exception 'Voucher out of balance: debit % <> credit %', v_debit, v_credit; end if;
  if v_debit = 0 then raise exception 'Voucher total cannot be zero'; end if;
  return v_debit;
end $$;

-- gl_post now validates via gl_validate, then writes (append-only).
create or replace function gl_post(
  p_company uuid, p_date date, p_memo text, p_doc_type text,
  p_source text, p_reference text, p_lines jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_entry uuid; v_no text; ln jsonb; d numeric(18,2); c numeric(18,2);
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  perform gl_validate(p_company, p_lines);
  v_no := next_doc_number(p_company, p_doc_type);
  insert into journal_entries(company_id, entry_no, entry_date, memo, status, source, reference)
  values (p_company, v_no, p_date, p_memo, 'posted', p_source, p_reference)
  returning id into v_entry;
  for ln in select * from jsonb_array_elements(p_lines) loop
    d := round(coalesce((ln->>'debit')::numeric, 0), 2);
    c := round(coalesce((ln->>'credit')::numeric, 0), 2);
    if d = 0 and c = 0 then continue; end if;
    insert into journal_lines(entry_id, account_id, description, debit, credit, cost_center, tag_area)
    values (v_entry, (ln->>'account_id')::uuid, ln->>'description', d, c, ln->>'cost_center', ln->>'tag_area');
  end loop;
  return jsonb_build_object('entry_id', v_entry, 'entry_no', v_no);
end $$;

-- Submit a voucher: post now, or save pending if an approval rule applies.
create or replace function gl_submit(
  p_company uuid, p_date date, p_memo text, p_doc_type text, p_reference text, p_lines jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_amount numeric(18,2); r acct_approval_rules%rowtype; v_id uuid; v jsonb;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  v_amount := gl_validate(p_company, p_lines);
  select * into r from acct_approval_rules
    where company_id = p_company and doc_type = p_doc_type and active and min_amount <= v_amount
    order by min_amount desc limit 1;

  if found and r.approvals_needed >= 1 then
    insert into pending_vouchers(company_id, doc_type, entry_date, narration, reference, amount, lines, approvals_needed, created_by)
    values (p_company, p_doc_type, p_date, p_memo, p_reference, v_amount, p_lines, r.approvals_needed, auth.uid())
    returning id into v_id;
    perform acct_log(p_company, 'submitted', p_doc_type, v_id::text,
      jsonb_build_object('amount', v_amount, 'approvals_needed', r.approvals_needed));
    perform push_notification('staff', null, 'accounting', 'Voucher awaiting approval',
      p_doc_type || ' for ' || v_amount || ' needs authorisation', 'accounting', null);
    return jsonb_build_object('pending', true, 'id', v_id, 'amount', v_amount);
  end if;

  v := gl_post(p_company, p_date, p_memo, p_doc_type, p_doc_type, p_reference, p_lines);
  perform acct_log(p_company, 'posted', p_doc_type, v->>'entry_no', jsonb_build_object('amount', v_amount));
  return jsonb_build_object('pending', false, 'entry_no', v->>'entry_no', 'entry_id', v->>'entry_id');
end $$;

-- Authorise a pending voucher; posts automatically when enough approvals are collected.
create or replace function voucher_approve(p_pending uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pv pending_vouchers%rowtype; v_count int; v jsonb;
begin
  if not acct_can_authorize() then raise exception 'You are not allowed to authorise vouchers'; end if;
  select * into pv from pending_vouchers where id = p_pending and company_id = auth_company_id();
  if not found then raise exception 'Voucher not found'; end if;
  if pv.status <> 'pending' then raise exception 'Voucher is already %', pv.status; end if;
  if pv.created_by = auth.uid() and not is_admin() then
    raise exception 'You cannot authorise your own voucher (maker–checker)';
  end if;

  insert into pending_voucher_approvals(pending_id, actor, action) values (p_pending, auth.uid(), 'approve')
    on conflict (pending_id, actor, action) do nothing;
  select count(*) into v_count from pending_voucher_approvals where pending_id = p_pending and action = 'approve';

  if v_count >= pv.approvals_needed then
    v := gl_post(pv.company_id, pv.entry_date, pv.narration, pv.doc_type, 'approved', pv.reference, pv.lines);
    update pending_vouchers set status = 'authorized', posted_entry_id = (v->>'entry_id')::uuid where id = p_pending;
    perform acct_log(pv.company_id, 'authorized', pv.doc_type, v->>'entry_no', jsonb_build_object('pending_id', p_pending));
    perform push_notification('staff', null, 'accounting', 'Voucher authorised & posted',
      pv.doc_type || ' ' || (v->>'entry_no') || ' posted', 'accounting', null);
    return jsonb_build_object('posted', true, 'entry_no', v->>'entry_no');
  end if;
  perform acct_log(pv.company_id, 'approval', pv.doc_type, p_pending::text, jsonb_build_object('count', v_count, 'needed', pv.approvals_needed));
  return jsonb_build_object('posted', false, 'remaining', pv.approvals_needed - v_count);
end $$;

create or replace function voucher_reject(p_pending uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pv pending_vouchers%rowtype;
begin
  if not acct_can_authorize() then raise exception 'You are not allowed to reject vouchers'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'A rejection reason is required'; end if;
  select * into pv from pending_vouchers where id = p_pending and company_id = auth_company_id();
  if not found then raise exception 'Voucher not found'; end if;
  if pv.status <> 'pending' then raise exception 'Voucher is already %', pv.status; end if;
  update pending_vouchers set status = 'rejected', reject_reason = p_reason where id = p_pending;
  insert into pending_voucher_approvals(pending_id, actor, action, note) values (p_pending, auth.uid(), 'reject', p_reason);
  perform acct_log(pv.company_id, 'rejected', pv.doc_type, p_pending::text, jsonb_build_object('reason', p_reason));
  perform push_notification('staff', null, 'accounting', 'Voucher rejected',
    pv.doc_type || ' rejected: ' || p_reason, 'accounting', null);
  return jsonb_build_object('rejected', true);
end $$;

-- Maker withdraws their own still-pending voucher.
create or replace function voucher_cancel(p_pending uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pv pending_vouchers%rowtype;
begin
  select * into pv from pending_vouchers where id = p_pending and company_id = auth_company_id();
  if not found then raise exception 'Voucher not found'; end if;
  if pv.status <> 'pending' then raise exception 'Voucher is already %', pv.status; end if;
  if pv.created_by <> auth.uid() and not is_admin() then raise exception 'Only the maker can withdraw this voucher'; end if;
  update pending_vouchers set status = 'cancelled' where id = p_pending;
  perform acct_log(pv.company_id, 'cancelled', pv.doc_type, p_pending::text, null);
  return jsonb_build_object('cancelled', true);
end $$;

-- Approval inbox (pending) + recently decided, with maker name & approvals so far.
create or replace function pending_inbox(p_company uuid, p_status text default 'pending') returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', v.id, 'doc_type', v.doc_type, 'date', v.entry_date, 'narration', v.narration,
    'reference', v.reference, 'amount', v.amount, 'status', v.status,
    'approvals_needed', v.approvals_needed,
    'approvals', (select count(*) from pending_voucher_approvals a where a.pending_id = v.id and a.action = 'approve'),
    'maker', coalesce(pr.full_name, pr.email, 'staff'), 'created_by', v.created_by,
    'created_at', v.created_at, 'reject_reason', v.reject_reason,
    'lines', (select coalesce(jsonb_agg(jsonb_build_object(
        'account', ac.code || ' · ' || ac.name,
        'debit', (l->>'debit')::numeric, 'credit', (l->>'credit')::numeric,
        'description', l->>'description')), '[]'::jsonb)
      from jsonb_array_elements(v.lines) l
      left join accounts ac on ac.id = (l->>'account_id')::uuid)
  ) order by v.created_at desc), '[]'::jsonb)
  from pending_vouchers v
  left join profiles pr on pr.id = v.created_by
  where v.company_id = p_company and (p_status = 'all' or v.status = p_status);
$$;

grant execute on function acct_can_authorize() to authenticated;
grant execute on function acct_log(uuid,text,text,text,jsonb) to authenticated;
grant execute on function gl_validate(uuid,jsonb) to authenticated;
grant execute on function gl_submit(uuid,date,text,text,text,jsonb) to authenticated;
grant execute on function voucher_approve(uuid) to authenticated;
grant execute on function voucher_reject(uuid,text) to authenticated;
grant execute on function voucher_cancel(uuid) to authenticated;
grant execute on function pending_inbox(uuid,text) to authenticated;
