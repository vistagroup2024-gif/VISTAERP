-- 266_voucher_approvers.sql
-- Named approvers per voucher type.
--
-- What already existed (migrations 205/246): pending_vouchers, an approval inbox,
-- maker-checker, per-user amount limits, and posting that happens automatically
-- the moment enough approvals land. What was missing is the part that makes it
-- usable: a way to say "Asim authorises Payment Vouchers". Rules were keyed on
-- doc_type + amount only, and ANY user holding accounting.authorize could approve
-- anything — and in practice nobody held it, so a pending voucher would have sat
-- forever.
--
-- Now: assign users to a voucher type. A type WITH approvers always needs
-- approval, and only its assigned approvers (or an admin) can give it. A type
-- WITHOUT approvers posts immediately, which is the "anything that doesn't have
-- an approval gets posted automatically" rule. The legacy amount rule still
-- applies to types that have no named approver, so existing setups keep working.

-- Bill-wise vouchers carry their allocations here so they can be replayed when
-- the voucher is approved rather than being lost.
alter table pending_vouchers add column if not exists payload jsonb;

create table if not exists acct_voucher_approvers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  doc_type text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (company_id, doc_type, user_id)
);
alter table acct_voucher_approvers enable row level security;
drop policy if exists acct_voucher_approvers_staff on acct_voucher_approvers;
create policy acct_voucher_approvers_staff on acct_voucher_approvers for select to authenticated
  using (company_id = auth_company_id() and is_staff());

-- How many approvals a voucher of this type and amount needs. 0 = post now.
create or replace function acct_approvals_needed(p_company uuid, p_doc_type text, p_amount numeric)
returns int language sql stable security definer set search_path = public as $$
  select case
    -- A named approver on the type always gates it, whatever the amount.
    when exists (select 1 from acct_voucher_approvers a
                 where a.company_id = p_company and a.doc_type = p_doc_type)
      then greatest(1, coalesce((select r.approvals_needed from acct_approval_rules r
                                 where r.company_id = p_company and r.doc_type = p_doc_type and r.active), 1))
    -- Otherwise fall back to the legacy amount rule.
    else coalesce((select r.approvals_needed from acct_approval_rules r
                   where r.company_id = p_company and r.doc_type = p_doc_type
                     and r.active and r.min_amount <= p_amount
                   order by r.min_amount desc limit 1), 0)
  end;
$$;

-- May the current user authorise this voucher type?
create or replace function acct_can_authorize_type(p_company uuid, p_doc_type text)
returns boolean language sql stable security definer set search_path = public as $$
  select is_admin() or exists (
    select 1 from acct_voucher_approvers a
    where a.company_id = p_company and a.doc_type = p_doc_type and a.user_id = auth.uid())
  -- Types with no named approver fall back to the old blanket permission.
  or (not exists (select 1 from acct_voucher_approvers a
                  where a.company_id = p_company and a.doc_type = p_doc_type)
      and acct_can_authorize());
$$;

-- Apply the bill-wise allocations of a voucher against its posted entry.
create or replace function apply_billwise_allocations(p_company uuid, p_entry uuid, p_lines jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare ln jsonb; a jsonb; amt numeric(18,2); take numeric(18,2); oi open_items%rowtype;
begin
  for ln in select * from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) loop
    amt := round(coalesce((ln->>'amount')::numeric, 0), 2);
    if ln ? 'allocations' and jsonb_typeof(ln->'allocations') = 'array' and jsonb_array_length(ln->'allocations') > 0 then
      for a in select * from jsonb_array_elements(ln->'allocations') loop
        take := round(coalesce((a->>'amount')::numeric, 0), 2);
        if take <= 0 then continue; end if;
        select * into oi from open_items
          where id = (a->>'open_item_id')::uuid and company_id = p_company
            and account_id = (ln->>'account')::uuid and status = 'open' for update;
        if not found then continue; end if;
        take := least(take, oi.outstanding_base);
        if take <= 0 then continue; end if;
        insert into allocations(company_id, open_item_id, settle_entry_id, amount_base, note)
        values (p_company, oi.id, p_entry, take, 'Bill-wise');
        update open_items set outstanding_base = outstanding_base - take,
          status = case when outstanding_base - take <= 0.005 then 'settled' else 'open' end
          where id = oi.id;
      end loop;
    elsif coalesce((ln->>'fifo')::boolean, false) and amt > 0 then
      perform allocate_fifo(p_company, (ln->>'account')::uuid, p_entry, amt, 'Auto FIFO');
    end if;
  end loop;
end $$;

-- Submit a voucher: post now, or hold it for the assigned approvers.
-- The new payload parameter defaults, so the old 6-argument signature has to go
-- or every existing 6-argument call becomes ambiguous.
drop function if exists gl_submit(uuid, date, text, text, text, jsonb);
create or replace function gl_submit(
  p_company uuid, p_date date, p_memo text, p_doc_type text, p_reference text, p_lines jsonb,
  p_payload jsonb default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_amount numeric(18,2); v_needed int; v_id uuid; v jsonb; v_who text;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  v_amount := gl_validate(p_company, p_lines);
  v_needed := acct_approvals_needed(p_company, p_doc_type, v_amount);

  if v_needed >= 1 then
    insert into pending_vouchers(company_id, doc_type, entry_date, narration, reference, amount, lines,
                                 approvals_needed, created_by, payload)
    values (p_company, p_doc_type, p_date, p_memo, p_reference, v_amount, p_lines, v_needed, auth.uid(), p_payload)
    returning id into v_id;
    perform acct_log(p_company, 'submitted', p_doc_type, v_id::text,
      jsonb_build_object('amount', v_amount, 'approvals_needed', v_needed));
    -- Name the people who can act on it, so the alert is addressed rather than generic.
    select string_agg(coalesce(pr.full_name, pr.email, 'an approver'), ', ')
      into v_who from acct_voucher_approvers a join profiles pr on pr.id = a.user_id
      where a.company_id = p_company and a.doc_type = p_doc_type;
    perform push_notification('staff', null, 'accounting', 'Voucher awaiting authorisation',
      p_doc_type || ' for ' || v_amount || coalesce(' — for ' || v_who, '') || ' to authorise',
      'accounting', null, '/accounting/approvals');
    return jsonb_build_object('pending', true, 'id', v_id, 'amount', v_amount, 'approvers', v_who);
  end if;

  v := gl_post(p_company, p_date, p_memo, p_doc_type, p_doc_type, p_reference, p_lines);
  if p_payload ? 'lines' then
    perform apply_billwise_allocations(p_company, (v->>'entry_id')::uuid, p_payload->'lines');
  end if;
  perform acct_log(p_company, 'posted', p_doc_type, v->>'entry_no', jsonb_build_object('amount', v_amount));
  return jsonb_build_object('pending', false, 'entry_no', v->>'entry_no', 'entry_id', v->>'entry_id');
end $$;

-- Authorise: only an assigned approver for that voucher type (or an admin).
create or replace function voucher_approve(p_pending uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pv pending_vouchers%rowtype; v_count int; v jsonb; v_lim numeric(18,2);
begin
  select * into pv from pending_vouchers where id = p_pending and company_id = auth_company_id();
  if not found then raise exception 'Voucher not found'; end if;
  if not acct_can_authorize_type(pv.company_id, pv.doc_type) then
    raise exception 'You are not an approver for %', pv.doc_type;
  end if;
  if pv.status <> 'pending' then raise exception 'Voucher is already %', pv.status; end if;
  if pv.created_by = auth.uid() and not is_admin() then
    raise exception 'You cannot authorise your own voucher (maker-checker)';
  end if;
  if not is_admin() then
    select acct_authorize_limit into v_lim from profiles where id = auth.uid();
    if v_lim is not null and pv.amount > v_lim then
      raise exception 'Amount % exceeds your authorisation limit of %', pv.amount, v_lim;
    end if;
  end if;

  insert into pending_voucher_approvals(pending_id, actor, action) values (p_pending, auth.uid(), 'approve')
    on conflict (pending_id, actor, action) do nothing;
  select count(*) into v_count from pending_voucher_approvals where pending_id = p_pending and action = 'approve';

  if v_count >= pv.approvals_needed then
    v := gl_post(pv.company_id, pv.entry_date, pv.narration, pv.doc_type, 'approved', pv.reference, pv.lines);
    -- Replay the bill-wise allocations the maker chose, if any.
    if pv.payload ? 'lines' then
      perform apply_billwise_allocations(pv.company_id, (v->>'entry_id')::uuid, pv.payload->'lines');
    end if;
    update pending_vouchers set status = 'authorized', posted_entry_id = (v->>'entry_id')::uuid where id = p_pending;
    perform acct_log(pv.company_id, 'authorized', pv.doc_type, v->>'entry_no', jsonb_build_object('pending_id', p_pending));
    perform push_notification('staff', null, 'accounting', 'Voucher authorised & posted',
      pv.doc_type || ' ' || (v->>'entry_no') || ' posted', 'accounting', null, null);
    return jsonb_build_object('posted', true, 'entry_no', v->>'entry_no');
  end if;
  perform acct_log(pv.company_id, 'approval', pv.doc_type, p_pending::text,
    jsonb_build_object('count', v_count, 'needed', pv.approvals_needed));
  return jsonb_build_object('posted', false, 'remaining', pv.approvals_needed - v_count);
end $$;

-- Bill-wise receipt / payment now go through the same gate; the allocations ride
-- along in the payload so they survive the wait for approval.
create or replace function gl_receipt_billwise(
  p_company uuid, p_kind text, p_date date, p_cash_bank uuid,
  p_narration text, p_reference text, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare arr jsonb := '[]'::jsonb; total numeric(18,2) := 0; ln jsonb; amt numeric(18,2);
        v_doc text := case when p_kind = 'customer' then 'gl_receipt' else 'gl_payment' end;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  for ln in select * from jsonb_array_elements(p_lines) loop
    amt := round(coalesce((ln->>'amount')::numeric, 0), 2);
    if amt <= 0 then continue; end if;
    total := total + amt;
    if p_kind = 'customer' then
      arr := arr || jsonb_build_array(jsonb_build_object('account_id', ln->>'account', 'debit', 0, 'credit', amt, 'description', ln->>'remarks'));
    else
      arr := arr || jsonb_build_array(jsonb_build_object('account_id', ln->>'account', 'debit', amt, 'credit', 0, 'description', ln->>'remarks'));
    end if;
  end loop;
  if total <= 0 then raise exception 'Enter at least one amount'; end if;
  if p_kind = 'customer' then
    arr := jsonb_build_array(jsonb_build_object('account_id', p_cash_bank::text, 'debit', total, 'credit', 0, 'description', p_narration)) || arr;
  else
    arr := jsonb_build_array(jsonb_build_object('account_id', p_cash_bank::text, 'debit', 0, 'credit', total, 'description', p_narration)) || arr;
  end if;
  return gl_submit(p_company, p_date, p_narration, v_doc, p_reference, arr,
                   jsonb_build_object('billwise', true, 'lines', p_lines));
end $$;

-- Journal with bill-wise adjustment: same gate, allocations carried in the payload.
create or replace function gl_journal_billwise(p_company uuid, p_date date, p_narration text, p_reference text, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare arr jsonb := '[]'::jsonb; ln jsonb; d numeric(18,2); c numeric(18,2);
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  for ln in select * from jsonb_array_elements(p_lines) loop
    d := round(coalesce((ln->>'debit')::numeric,0),2); c := round(coalesce((ln->>'credit')::numeric,0),2);
    if d = 0 and c = 0 then continue; end if;
    arr := arr || jsonb_build_array(jsonb_build_object('account_id', ln->>'account', 'debit', d, 'credit', c,
      'description', ln->>'remarks', 'cost_center', ln->>'cost_center', 'tag_area', ln->>'tag_area'));
  end loop;
  return gl_submit(p_company, p_date, p_narration, 'gl_journal', p_reference, arr,
                   jsonb_build_object('billwise', true, 'lines', p_lines));
end $$;

-- Manage who authorises what.
create or replace function voucher_approvers_list()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(doc_type, users), '{}'::jsonb) from (
    select a.doc_type, jsonb_agg(jsonb_build_object(
             'user_id', a.user_id,
             'name', coalesce(p.full_name, p.email, 'user')) order by coalesce(p.full_name, p.email)) as users
    from acct_voucher_approvers a left join profiles p on p.id = a.user_id
    where a.company_id = auth_company_id()
    group by a.doc_type
  ) t;
$$;

create or replace function voucher_approvers_set(p_doc_type text, p_user_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_co uuid := auth_company_id(); u uuid;
begin
  if not is_admin() then raise exception 'Only an admin can change who authorises vouchers'; end if;
  delete from acct_voucher_approvers where company_id = v_co and doc_type = p_doc_type;
  foreach u in array coalesce(p_user_ids, '{}'::uuid[]) loop
    insert into acct_voucher_approvers(company_id, doc_type, user_id) values (v_co, p_doc_type, u)
      on conflict (company_id, doc_type, user_id) do nothing;
  end loop;
  perform acct_log(v_co, 'approvers_changed', p_doc_type, null,
    jsonb_build_object('count', coalesce(array_length(p_user_ids,1),0)));
  return jsonb_build_object('doc_type', p_doc_type, 'count', coalesce(array_length(p_user_ids,1),0));
end $$;

grant execute on function acct_approvals_needed(uuid, text, numeric) to authenticated;
grant execute on function acct_can_authorize_type(uuid, text) to authenticated;
grant execute on function apply_billwise_allocations(uuid, uuid, jsonb) to authenticated;
grant execute on function gl_submit(uuid, date, text, text, text, jsonb, jsonb) to authenticated;
grant execute on function voucher_approvers_list() to authenticated;
grant execute on function voucher_approvers_set(text, uuid[]) to authenticated;
