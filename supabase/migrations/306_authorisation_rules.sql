-- Voucher authorisation, decided by rules rather than by a tick-list.
--
-- What it used to do: tick somebody as an approver for a voucher TYPE and every
-- voucher of that type was held, whatever it was for and whoever raised it. The
-- amount threshold on a rule was only consulted when NOBODY was ticked, so the
-- two controls could not be combined — naming an approver overrode the
-- threshold entirely (see the old acct_approvals_needed).
--
-- What it does now: a rule says WHEN authorisation is needed, and nothing else
-- does. No rule matches, the voucher posts on save, as it always has.
--
-- A rule can test, in any combination:
--   voucher type   — always
--   amount         — min_amount; 0 means every voucher of the type
--   cost centre    — null means any
--   who raised it  — null means anyone
--
-- so "over 100 in CAR SALES INSTALLMENT" and "anything Saad raises" are both
-- expressible, and the more specific of the two wins when both match.

-- Several rules per voucher type is the whole point now.
alter table acct_approval_rules drop constraint if exists acct_approval_rules_company_id_doc_type_key;
alter table acct_approval_rules
  add column if not exists name text,
  add column if not exists cost_center text,
  add column if not exists created_by uuid;

comment on column acct_approval_rules.cost_center is 'Null = any cost centre.';
comment on column acct_approval_rules.created_by is 'Null = whoever raises it. Set to hold only one person''s vouchers.';

-- Who may authorise the vouchers THIS rule holds. Empty falls back to the
-- voucher type's approvers, and then to anyone who may authorise at all —
-- so a rule needs approvers only when they differ from the usual ones.
create table if not exists acct_approval_rule_approvers (
  rule_id uuid not null references acct_approval_rules(id) on delete cascade,
  user_id uuid not null,
  primary key (rule_id, user_id)
);
alter table acct_approval_rule_approvers enable row level security;
drop policy if exists acct_approval_rule_approvers_staff on acct_approval_rule_approvers;
create policy acct_approval_rule_approvers_staff on acct_approval_rule_approvers for all
  using (exists (select 1 from acct_approval_rules r
                  where r.id = rule_id and r.company_id = auth_company_id() and is_staff()))
  with check (exists (select 1 from acct_approval_rules r
                       where r.id = rule_id and r.company_id = auth_company_id() and is_staff()));

-- Which rule held it, so the approval knows whose approval it is waiting for.
alter table pending_vouchers add column if not exists rule_id uuid references acct_approval_rules(id);

-- ── Which rule applies ─────────────────────────────────────────────────────
-- The most specific match wins: a rule naming a person beats one naming only a
-- cost centre, which beats one naming only an amount. Between rules of equal
-- shape the higher threshold wins, because that is the one written for the
-- larger voucher.
create or replace function public.acct_rule_for(
  p_company uuid, p_doc_type text, p_amount numeric,
  p_cost_center text default null, p_created_by uuid default null)
returns uuid
language sql
stable
set search_path to 'public'
as $function$
  select r.id from acct_approval_rules r
  where r.company_id = p_company
    and r.doc_type = p_doc_type
    and r.active
    and r.min_amount <= coalesce(p_amount, 0)
    and (r.cost_center is null
         or upper(btrim(r.cost_center)) = upper(btrim(coalesce(p_cost_center, ''))))
    and (r.created_by is null or r.created_by = p_created_by)
  order by (r.created_by is not null) desc,
           (r.cost_center is not null) desc,
           r.min_amount desc
  limit 1;
$function$;

-- The old three-argument version has to go rather than be kept alongside: a
-- five-argument one with defaults would match the same three-argument calls and
-- Postgres would refuse them as ambiguous.
drop function if exists public.acct_approvals_needed(uuid, text, numeric);

create or replace function public.acct_approvals_needed(
  p_company uuid, p_doc_type text, p_amount numeric,
  p_cost_center text default null, p_created_by uuid default null)
returns integer
language sql
stable
set search_path to 'public'
as $function$
  select coalesce((select r.approvals_needed from acct_approval_rules r
                   where r.id = acct_rule_for(p_company, p_doc_type, p_amount, p_cost_center, p_created_by)), 0);
$function$;

-- ── Who may authorise a particular held voucher ────────────────────────────
-- Narrowest first: the rule's own approvers if it names any, else the voucher
-- type's, else anyone with the authorisation right. An admin always may — but
-- an admin is no longer REQUIRED anywhere, which was the point of asking.
create or replace function public.acct_can_authorize_pending(p_pending uuid)
returns boolean
language sql
stable
set search_path to 'public'
as $function$
  select case
    when is_admin() then true
    when exists (select 1 from pending_vouchers pv
                 join acct_approval_rule_approvers ra on ra.rule_id = pv.rule_id
                 where pv.id = p_pending)
      then exists (select 1 from pending_vouchers pv
                   join acct_approval_rule_approvers ra on ra.rule_id = pv.rule_id
                   where pv.id = p_pending and ra.user_id = auth.uid())
    else (select acct_can_authorize_type(pv.company_id, pv.doc_type)
            from pending_vouchers pv where pv.id = p_pending)
  end;
$function$;

revoke all on function public.acct_rule_for(uuid, text, numeric, text, uuid) from public, anon;
revoke all on function public.acct_approvals_needed(uuid, text, numeric, text, uuid) from public, anon;
revoke all on function public.acct_can_authorize_pending(uuid) from public, anon;
grant execute on function public.acct_rule_for(uuid, text, numeric, text, uuid) to authenticated;
grant execute on function public.acct_approvals_needed(uuid, text, numeric, text, uuid) to authenticated;
grant execute on function public.acct_can_authorize_pending(uuid) to authenticated;

-- ── The three places a voucher is held ─────────────────────────────────────
-- Each now works out its rule and records WHICH rule held it, so the approval
-- knows whose approval it is waiting for rather than guessing from the type.

-- acct_hold_document gains the cost centre and the rule. Defaults on both, so
-- payroll — which has no cost centre — calls it exactly as before.
drop function if exists public.acct_hold_document(uuid, text, date, text, text, numeric, integer, text, uuid);
create or replace function public.acct_hold_document(
  p_company uuid, p_doc_type text, p_date date, p_memo text, p_reference text,
  p_amount numeric, p_needed integer, p_post_fn text, p_doc_id uuid,
  p_rule uuid default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id uuid; v_who text;
begin
  insert into pending_vouchers(company_id, doc_type, entry_date, narration, reference, amount,
                               lines, approvals_needed, created_by, payload, rule_id)
  values (p_company, p_doc_type, coalesce(p_date, current_date), p_memo, p_reference, p_amount,
          '[]'::jsonb, p_needed, auth.uid(),
          jsonb_build_object('post_fn', p_post_fn, 'doc_id', p_doc_id), p_rule)
  returning id into v_id;

  perform acct_log(p_company, 'submitted', p_doc_type, v_id::text,
    jsonb_build_object('amount', p_amount, 'approvals_needed', p_needed, 'rule', p_rule));
  v_who := acct_approver_names(p_company, p_doc_type, p_rule);
  perform push_notification('staff', null, 'accounting', 'Voucher awaiting authorisation',
    p_doc_type || ' for ' || p_amount || coalesce(' — for ' || v_who, '') || ' to authorise',
    'accounting', null, '/accounting/approvals');
  return v_id;
end $function$;

-- Who to name in the notification: the rule's approvers if it has its own,
-- otherwise the voucher type's.
create or replace function public.acct_approver_names(p_company uuid, p_doc_type text, p_rule uuid)
returns text
language sql
stable
set search_path to 'public'
as $function$
  select coalesce(
    (select string_agg(coalesce(pr.full_name, pr.email, 'an approver'), ', ')
       from acct_approval_rule_approvers ra join profiles pr on pr.id = ra.user_id
      where ra.rule_id = p_rule),
    (select string_agg(coalesce(pr.full_name, pr.email, 'an approver'), ', ')
       from acct_voucher_approvers a join profiles pr on pr.id = a.user_id
      where a.company_id = p_company and a.doc_type = p_doc_type));
$function$;

-- p_payload keeps its default: dropping it would change the signature, and
-- Postgres refuses to remove a default from a function in place.
create or replace function public.gl_submit(
  p_company uuid, p_date date, p_memo text, p_doc_type text, p_reference text,
  p_lines jsonb, p_payload jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_amount numeric(18,2); v_needed int; v_id uuid; v jsonb; v_who text;
        v_cc text; v_rule uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  perform staff_require_scope_accounts(p_lines);
  v_amount := gl_validate(p_company, p_lines);

  -- The voucher's cost centre for rule matching: the first line that names one.
  -- A voucher whose lines disagree is not a case the rules can decide between,
  -- and the first line is the one the operator chose first.
  select l->>'cost_center' into v_cc
    from jsonb_array_elements(p_lines) l
   where nullif(btrim(coalesce(l->>'cost_center','')),'') is not null
   limit 1;

  v_rule   := acct_rule_for(p_company, p_doc_type, v_amount, v_cc, auth.uid());
  v_needed := acct_approvals_needed(p_company, p_doc_type, v_amount, v_cc, auth.uid());

  if v_needed >= 1 then
    insert into pending_vouchers(company_id, doc_type, entry_date, narration, reference, amount, lines,
                                 approvals_needed, created_by, payload, rule_id)
    values (p_company, p_doc_type, p_date, p_memo, p_reference, v_amount, p_lines,
            v_needed, auth.uid(), p_payload, v_rule)
    returning id into v_id;
    perform acct_log(p_company, 'submitted', p_doc_type, v_id::text,
      jsonb_build_object('amount', v_amount, 'approvals_needed', v_needed, 'rule', v_rule));
    v_who := acct_approver_names(p_company, p_doc_type, v_rule);
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
end $function$;

create or replace function public.trade_doc_post(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare d trade_documents; v_co uuid := auth_company_id(); v_needed int; v_id uuid; v_rule uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into d from trade_documents where id = p_id and company_id = v_co;
  if not found then raise exception 'Document not found'; end if;
  if d.gl_entry is not null then raise exception 'Already posted'; end if;
  if d.doc_type not in ('purchase_voucher','purchase_return','sales_return','sales_invoice') then
    raise exception 'This document type does not post to the GL';
  end if;
  if d.status = 'awaiting_approval' then
    raise exception 'This voucher is already awaiting authorisation.';
  end if;

  -- A trade document carries its cost centre on the header, which is what makes
  -- "over 100 in CAR SALES INSTALLMENT" mean anything here.
  v_rule   := acct_rule_for(v_co, d.doc_type, coalesce(d.total, 0), d.cost_center, auth.uid());
  v_needed := acct_approvals_needed(v_co, d.doc_type, coalesce(d.total, 0), d.cost_center, auth.uid());
  if v_needed >= 1 then
    v_id := acct_hold_document(v_co, d.doc_type, d.doc_date, coalesce(d.narration, d.doc_no),
                               d.doc_no, coalesce(d.total, 0), v_needed, 'trade_doc_post_now', p_id, v_rule);
    update trade_documents set status = 'awaiting_approval' where id = p_id;
    -- 'pending_id', not 'id': this result is merged into trade_doc_save's, and
    -- an 'id' key here would overwrite the document's own id.
    return jsonb_build_object('pending', true, 'pending_id', v_id, 'amount', coalesce(d.total, 0));
  end if;

  return trade_doc_post_now(p_id) || jsonb_build_object('pending', false);
end $function$;

revoke all on function public.acct_approver_names(uuid, text, uuid) from public, anon;
grant execute on function public.acct_approver_names(uuid, text, uuid) to authenticated;

-- ── And who may approve it ─────────────────────────────────────────────────
-- The only change here is the first check: the rule's own approvers decide,
-- falling back to the voucher type's. Maker-checker, the per-user limit and
-- the counting of approvals are untouched.
create or replace function public.voucher_approve(p_pending uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare pv pending_vouchers%rowtype; v_count int; v jsonb; v_lim numeric(18,2);
        v_fn text; v_doc uuid; v_entry uuid;
begin
  select * into pv from pending_vouchers where id = p_pending and company_id = auth_company_id();
  if not found then raise exception 'Voucher not found'; end if;
  if not acct_can_authorize_pending(p_pending) then
    raise exception 'You are not an approver for this voucher';
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
    if pv.payload ? 'post_fn' then
      v_fn := pv.payload->>'post_fn';
      if v_fn not in ('trade_doc_post_now', 'payroll_post_now') then
        raise exception 'Unknown posting routine %', v_fn;
      end if;
      v_doc := (pv.payload->>'doc_id')::uuid;
      execute format('select %I($1)', v_fn) into v using v_doc;
      if v_fn = 'trade_doc_post_now' then
        select gl_entry into v_entry from trade_documents where id = v_doc;
      else
        select gl_entry into v_entry from payroll_runs where id = v_doc;
      end if;
    else
      v := gl_post(pv.company_id, pv.entry_date, pv.narration, pv.doc_type, 'approved', pv.reference, pv.lines);
      if pv.payload ? 'lines' then
        perform apply_billwise_allocations(pv.company_id, (v->>'entry_id')::uuid, pv.payload->'lines');
      end if;
      v_entry := (v->>'entry_id')::uuid;
    end if;

    update pending_vouchers set status = 'authorized', posted_entry_id = v_entry where id = p_pending;
    perform acct_log(pv.company_id, 'authorized', pv.doc_type, v->>'entry_no', jsonb_build_object('pending_id', p_pending));
    perform push_notification('staff', null, 'accounting', 'Voucher authorised & posted',
      pv.doc_type || ' ' || coalesce(v->>'entry_no', '') || ' posted', 'accounting', null, null);
    return jsonb_build_object('posted', true, 'entry_no', v->>'entry_no');
  end if;
  perform acct_log(pv.company_id, 'approval', pv.doc_type, p_pending::text,
    jsonb_build_object('count', v_count, 'needed', pv.approvals_needed));
  return jsonb_build_object('posted', false, 'remaining', pv.approvals_needed - v_count);
end $function$;
