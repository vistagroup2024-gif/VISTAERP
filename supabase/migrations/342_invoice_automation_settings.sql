-- Automatic invoicing becomes a setting, not a fact of the code.
--
-- Nine triggers create accounting records today, and every one of them decides
-- for itself whether to fire and which accounts to use. The accounts are chosen
-- BY NAME through acct_ensure_named(), which creates the account if it is not
-- there — so the chart of accounts has been shaped by the posting code rather
-- than by the user, which is the opposite of the rule this ERP otherwise keeps
-- ("master data is the user's; vouchers choose an existing item, they never
-- invent one"). And the only way to answer "does creating a group raise a visa
-- invoice, and what does it credit?" was to read a plpgsql function.
--
-- After this, the answer is a row in a table anybody with the right permission
-- can read and change, and the trigger asks that row before it does anything.
--
-- FAIL SAFE. acct_automation_enabled() returns FALSE when no rule row matches.
-- A trigger with no configuration therefore posts NOTHING. That is deliberate:
-- the failure people can see is an invoice that did not appear, and the failure
-- they cannot see is one that did. It also means a new company starts silent
-- until somebody configures it, rather than inheriting behaviour nobody chose.
--
-- The accounts on the rule are used when set and fall back to the name lookup
-- when they are not, so this migration changes NO posting behaviour on the day
-- it runs beyond turning the automation off. Seeded rules carry the accounts the
-- code was already using, resolved to real ids, so the settings screen opens
-- showing the truth rather than a blank form.
--
-- The manual Post buttons on the Transport and Hotel invoice screens are NOT
-- gated: they are a person asking for a posting, which is what a button is.

begin;

create table if not exists public.acct_automation_rules (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  module            text not null,
  rule_key          text not null,
  label             text not null,
  trigger_label     text not null,
  enabled           boolean not null default false,
  debit_account_id  uuid references public.accounts(id) on delete restrict,
  credit_account_id uuid references public.accounts(id) on delete restrict,
  cost_center       text,
  notes             text,
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.profiles(id) on delete set null,
  -- one rule per trigger per company: the duplicate that would make posting
  -- ambiguous cannot be created in the first place.
  unique (company_id, rule_key)
);

comment on table public.acct_automation_rules is
  'Which automatic postings run, and which accounts they use. Read by the autopost triggers; edited on Accounting -> Invoice Automation.';

alter table public.acct_automation_rules enable row level security;

drop policy if exists acct_automation_rules_staff on public.acct_automation_rules;
-- Readable by any staff member of the company (the screen is permission-gated
-- separately); wrapped in (select ...) so the helpers run once per query, as
-- every policy has since 312/313.
create policy acct_automation_rules_staff on public.acct_automation_rules for all
  using      (company_id = (select auth_company_id()) and (select is_staff()))
  with check (company_id = (select auth_company_id()) and (select is_staff()));

grant select on public.acct_automation_rules to authenticated;

create index if not exists acct_automation_rules_lookup
  on public.acct_automation_rules (company_id, rule_key);

-- ── the question every autopost trigger now asks first ─────────────────────
create or replace function public.acct_automation_enabled(p_company uuid, p_rule text)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select coalesce((select r.enabled from acct_automation_rules r
                    where r.company_id = p_company and r.rule_key = p_rule), false);
$$;
revoke all on function public.acct_automation_enabled(uuid, text) from public, anon;
grant execute on function public.acct_automation_enabled(uuid, text) to authenticated;

-- The account a rule names, or null to fall back to the old name lookup.
create or replace function public.acct_automation_account(p_company uuid, p_rule text, p_side text)
returns uuid
language sql
stable security definer
set search_path to 'public'
as $$
  select case when p_side = 'debit' then r.debit_account_id else r.credit_account_id end
    from acct_automation_rules r
   where r.company_id = p_company and r.rule_key = p_rule;
$$;
revoke all on function public.acct_automation_account(uuid, text, text) from public, anon;
grant execute on function public.acct_automation_account(uuid, text, text) to authenticated;


-- ── the four autopost triggers now ask before they act ─────────────────────

-- VISA: fires when an Umrah Group is INSERTed. The group itself is never
-- touched by this — only whether an invoice is raised from it changes.
create or replace function public.visa_group_autopost()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $f$
declare v_err text;
begin
  if not acct_automation_enabled(new.company_id, 'visa.group_created') then
    return new;                                   -- switched off in ERP settings
  end if;
  begin
    perform visa_invoice_generate(new.id);
  exception when others then
    get stacked diagnostics v_err = message_text;
    begin
      insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
      values (new.company_id, auth.uid(), 'visa_autopost_failed', 'umrah_group', new.id,
              jsonb_build_object('group_no', new.group_no, 'error', v_err));
    exception when others then null; end;
  end;
  return new;
end $f$;

-- TRANSPORT: fires when a trip's status becomes 'completed'.
create or replace function public.transport_trip_autopost()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $f$
declare v_err text;
begin
  if new.status = 'completed' and coalesce(old.status,'') <> 'completed' and new.gl_entry is null then
    if not acct_automation_enabled(new.company_id, 'transport.trip_completed') then
      return new;                                 -- switched off in ERP settings
    end if;
    begin
      perform transport_trip_post_gl(new.id);
    exception when others then
      get stacked diagnostics v_err = message_text;
      begin insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
        values (new.company_id, auth.uid(), 'transport_autopost_failed', 'transport_trip', new.id,
                jsonb_build_object('error', v_err));
      exception when others then null; end;
    end;
  end if;
  return new;
end $f$;

-- HOTEL: fires when a purchase booking reaches vendor_confirmed / hcn_pending /
-- hcn_received.
create or replace function public.hotel_purchase_autopost()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $f$
declare v_err text;
begin
  if coalesce(new.vendor_status::text,'') in ('vendor_confirmed','hcn_pending','hcn_received')
     and new.gl_posted_at is null
     and (tg_op = 'INSERT' or coalesce(old.vendor_status::text,'') not in ('vendor_confirmed','hcn_pending','hcn_received')) then
    if not acct_automation_enabled(new.company_id, 'hotel.vendor_confirmed') then
      return new;                                 -- switched off in ERP settings
    end if;
    begin
      perform hotel_purchase_post_gl(new.id);
    exception when others then
      get stacked diagnostics v_err = message_text;
      begin insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
        values (new.company_id, auth.uid(), 'hotel_autopost_failed', 'hotel_purchase_booking', new.id,
                jsonb_build_object('error', v_err));
      exception when others then null; end;
    end;
  end if;
  return new;
end $f$;

-- CAR: one trigger function serving six tables. The company is read out of the
-- row generically, because these six tables are not the same shape and the
-- alternative is six near-identical trigger functions.
create or replace function public.car_autopost_trigger()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $f$
declare v_err text; v_state text; v_ctx text; v_co uuid;
begin
  v_co := coalesce(nullif(to_jsonb(new) ->> 'company_id','')::uuid, auth_company_id());
  if not acct_automation_enabled(v_co, 'car.' || tg_argv[0]) then
    return null;                                  -- switched off in ERP settings
  end if;
  begin
    case tg_argv[0]
      when 'vehicle'        then perform car_post_vehicle(new.id);
      when 'contract'       then perform car_post_contract(new.id);
      when 'receipt'        then perform car_post_receipt(new.id);
      when 'charge'         then perform car_post_charge(new.id);
      when 'charge_payment' then perform car_post_charge_payment(new.id);
      when 'commission'     then perform car_post_commission(new.id);
      else null;
    end case;
  exception when others then
    get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_ctx = pg_exception_context;
    raise warning 'car autopost (%) failed for % [%]: % / %', tg_argv[0], new.id, v_state, v_err, v_ctx;
    begin
      insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
      values (v_co, auth.uid(), 'car_autopost_failed', tg_argv[0]::text, new.id,
              jsonb_build_object('sqlstate', v_state, 'message', v_err, 'context', v_ctx));
    exception when others then null; end;
  end;
  return null;
end $f$;

-- ── the posting routines read their accounts from the rule ─────────────────
-- Each keeps acct_ensure_named as the fallback, so a rule with no account set
-- behaves exactly as before rather than failing to post.

create or replace function public.transport_trip_post_gl(p_trip uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $f$
declare t transport_trips; b transport_bookings; v_co uuid; v_agent uuid; v_sales uuid; v_cost uuid; v_vendor uuid;
        v_sell numeric(18,2); v_vc numeric(18,2); v_cash numeric(18,2); lines jsonb := '[]'::jsonb; g jsonb;
        v_dr numeric(18,2); v_cr numeric(18,2); v_diff numeric(18,2); v_ro uuid; v_cc text; v_outsourced boolean;
begin
  select * into t from transport_trips where id = p_trip;
  if not found then return jsonb_build_object('posted', false, 'reason', 'trip not found'); end if;
  v_co := t.company_id;
  if t.gl_entry is not null then return jsonb_build_object('posted', false, 'reason', 'already posted'); end if;
  if coalesce(t.status,'') <> 'completed' then return jsonb_build_object('posted', false, 'reason', 'trip not completed'); end if;
  if coalesce(t.cancelled_with_booking,false) then return jsonb_build_object('posted', false, 'reason', 'cancelled'); end if;

  select * into b from transport_bookings where id = t.booking_id;
  if not found or b.agent_id is null then return jsonb_build_object('posted', false, 'reason', 'no booking/agent'); end if;

  v_outsourced := coalesce(t.is_outsourced, false) or t.vendor_id is not null;
  v_cc := coalesce((select cost_center from acct_automation_rules
                     where company_id=v_co and rule_key='transport.trip_completed' and cost_center is not null),
                   case when v_outsourced then 'OUTSOURCE TRANSPORT' else 'VISTA TRANSPORT' end);
  v_agent := ensure_party_account(v_co, b.agent_id, 'customer');
  v_sales := coalesce(acct_automation_account(v_co, 'transport.trip_completed', 'credit'),
                      acct_ensure_named(v_co, 'Transport Sales', 'income', '4', 'Revenue'));
  v_sell  := round(coalesce(t.sell_rate, 0), 2);

  if v_agent is not null and v_sales is not null and v_sell > 0 then
    lines := lines || jsonb_build_array(
      jsonb_build_object('account_id', v_agent::text, 'debit', v_sell, 'credit', 0, 'description', 'Transport '||coalesce(b.booking_no,'')||'/'||coalesce(t.seq,0), 'cost_center', v_cc),
      jsonb_build_object('account_id', v_sales::text, 'debit', 0, 'credit', v_sell, 'description', coalesce(t.route_label,'Transport'), 'cost_center', v_cc));
  end if;

  if v_outsourced and t.vendor_id is not null then
    v_vendor := ensure_transport_vendor_account(v_co, t.vendor_id);
    v_vc := round(coalesce(t.vendor_cost, 0), 2);
    if v_vendor is not null and v_vc > 0 then
      v_cost := coalesce(acct_automation_account(v_co, 'transport.vendor_cost', 'debit'),
                         acct_ensure_named(v_co, 'Transport Cost', 'expense', '5', 'COGS'));
      lines := lines || jsonb_build_array(
        jsonb_build_object('account_id', v_cost::text, 'debit', v_vc, 'credit', 0, 'description', 'Vendor cost '||coalesce(b.booking_no,''), 'cost_center', v_cc),
        jsonb_build_object('account_id', v_vendor::text, 'debit', 0, 'credit', v_vc, 'description', 'Vendor '||coalesce(t.route_label,'')));
    end if;
    v_cash := round(coalesce(t.cash_received, 0), 2);
    if v_vendor is not null and v_agent is not null and v_cash > 0 then
      lines := lines || jsonb_build_array(
        jsonb_build_object('account_id', v_vendor::text, 'debit', v_cash, 'credit', 0, 'description', 'Cash collected by vendor'),
        jsonb_build_object('account_id', v_agent::text, 'debit', 0, 'credit', v_cash, 'description', 'Cash collected by vendor', 'cost_center', v_cc));
    end if;
  end if;

  if jsonb_array_length(lines) = 0 then return jsonb_build_object('posted', false, 'reason', 'nothing to post'); end if;

  select coalesce(sum((x->>'debit')::numeric),0), coalesce(sum((x->>'credit')::numeric),0)
    into v_dr, v_cr from jsonb_array_elements(lines) x;
  v_diff := round(v_dr - v_cr, 2);
  if v_diff <> 0 then
    v_ro := acct_ensure_named(v_co, 'Round Off', 'expense', '5', 'Indirect Expense');
    if v_diff > 0 then lines := lines || jsonb_build_array(jsonb_build_object('account_id', v_ro::text, 'debit', 0, 'credit', v_diff, 'description', 'Round off'));
    else lines := lines || jsonb_build_array(jsonb_build_object('account_id', v_ro::text, 'debit', -v_diff, 'credit', 0, 'description', 'Round off')); end if;
  end if;

  g := gl_post(v_co, coalesce(t.trip_date, current_date), 'Transport '||coalesce(b.booking_no,'')||'/'||coalesce(t.seq,0), 'gl_transport', coalesce(b.booking_no,'')||'/'||coalesce(t.seq,0), lines);
  update transport_trips set gl_entry = (g->>'entry_id')::uuid, gl_posted_at = now() where id = p_trip;
  return jsonb_build_object('posted', true, 'sell', v_sell, 'vendor_cost', coalesce(v_vc,0), 'entry_no', g->>'entry_no');
end $f$;

create or replace function public.visa_invoice_post(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $f$
declare v visa_invoices; v_inc uuid; v_exp uuid; r jsonb; lines jsonb; g jsonb; v_cc text;
begin
  select * into v from visa_invoices where id = p_id;
  if not found then return; end if;
  if v.gl_sales_entry is not null or v.gl_purchase_entry is not null then return; end if;

  v_cc := coalesce((select cost_center from acct_automation_rules
                     where company_id=v.company_id and rule_key='visa.group_created' and cost_center is not null),
                   'UMRAH VISA');

  if v.agent_id is not null and v.sell_amount > 0 then
    v_inc := coalesce(acct_automation_account(v.company_id, 'visa.group_created', 'credit'),
                      acct_ensure_named(v.company_id, 'Visa Sales', 'income', '4', 'Revenue'));
    if v_inc is not null then
      r := party_invoice(v.company_id, v.agent_id, 'customer', v.doc_date, null,
             coalesce(v.narration, 'Visa ' || coalesce(v.doc_no,'')), v.sell_amount, v_inc, 0, v.doc_no, true, v_cc, null);
      update visa_invoices set gl_sales_entry = (select entry_id from open_items where id = (r->>'open_item_id')::uuid)
        where id = p_id;
    end if;
  end if;

  if v.supplier_account_id is not null and v.cost_amount > 0 then
    v_exp := coalesce(acct_automation_account(v.company_id, 'visa.supplier_cost', 'debit'),
                      acct_ensure_named(v.company_id, 'Visa Cost', 'expense', '5', 'COGS'));
    if v_exp is not null then
      lines := jsonb_build_array(
        jsonb_build_object('account_id', v_exp::text, 'debit', v.cost_amount, 'credit', 0, 'description', 'Visa cost ' || coalesce(v.doc_no,''), 'cost_center', v_cc),
        jsonb_build_object('account_id', v.supplier_account_id::text, 'debit', 0, 'credit', v.cost_amount, 'description', coalesce(v.haji_name, v.doc_no)));
      g := gl_post(v.company_id, v.doc_date, 'Visa cost ' || coalesce(v.doc_no,''), 'gl_visa_cost', v.doc_no, lines);
      update visa_invoices set gl_purchase_entry = (g->>'entry_id')::uuid where id = p_id;
    end if;
  end if;

  update visa_invoices set status = 'posted', updated_at = now() where id = p_id;
end $f$;

create or replace function public.hotel_purchase_post_gl(p_row uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $f$
declare hp hotel_purchase_bookings; b hotel_bookings; v_co uuid; v_agent uuid; v_inc uuid; v_exp uuid;
        v_sell numeric(18,2); v_cost numeric(18,2); r jsonb; v_cc text; v_narr text;
        v_sales_no text; v_pur_no text;
begin
  select * into hp from hotel_purchase_bookings where id = p_row;
  if not found then return jsonb_build_object('posted', false, 'reason', 'row not found'); end if;
  v_co := hp.company_id;
  if hp.gl_posted_at is not null then return jsonb_build_object('posted', false, 'reason', 'already posted'); end if;
  if coalesce(hp.vendor_status::text,'') not in ('vendor_confirmed','hcn_pending','hcn_received')
    then return jsonb_build_object('posted', false, 'reason', 'not vendor confirmed'); end if;

  v_cc := coalesce((select cost_center from acct_automation_rules
                     where company_id=v_co and rule_key='hotel.vendor_confirmed' and cost_center is not null), 'HOTEL');

  select * into b from hotel_bookings where id = hp.booking_id;
  v_sell := round(coalesce(hp.sale_total, 0), 2);
  v_cost := round(coalesce(hp.purchase_total, 0), 2);
  v_narr := 'Hotel ' || coalesce(b.booking_no,'') || ' — ' || coalesce(hp.hotel_name,'');

  v_agent := b.agent_id;
  if v_agent is not null and v_sell > 0 then
    v_inc := coalesce(acct_automation_account(v_co, 'hotel.vendor_confirmed', 'credit'),
                      acct_ensure_named(v_co, 'Hotel Sales', 'income', '4', 'Revenue'));
    if v_inc is not null then
      r := party_invoice(v_co, v_agent, 'customer', coalesce(hp.check_in, current_date), null,
             v_narr, v_sell, v_inc, 0, coalesce(b.booking_no,''), true, v_cc, null);
      v_sales_no := r->>'entry_no';
    end if;
  end if;

  if hp.supplier_id is not null and v_cost > 0 then
    v_exp := coalesce(acct_automation_account(v_co, 'hotel.supplier_cost', 'debit'),
                      acct_ensure_named(v_co, 'Hotel Cost', 'expense', '5', 'COGS'));
    if v_exp is not null then
      r := party_invoice(v_co, hp.supplier_id, 'supplier', coalesce(hp.check_in, current_date), null,
             v_narr || ' (cost)', v_cost, v_exp, 0, coalesce(b.booking_no,''), true, v_cc, null);
      v_pur_no := r->>'entry_no';
    end if;
  end if;

  if v_sales_no is null and v_pur_no is null then
    return jsonb_build_object('posted', false, 'reason', 'nothing to post');
  end if;

  update hotel_purchase_bookings
    set gl_posted_at = now(), gl_sales_entry = v_sales_no, gl_purchase_entry = v_pur_no
    where id = p_row;
  return jsonb_build_object('posted', true, 'sell', v_sell, 'cost', v_cost,
    'sales_entry', v_sales_no, 'purchase_entry', v_pur_no);
end $f$;

-- ── seed the rules from what the code was already doing ────────────────────
-- Enabled FALSE on every one, as asked. The accounts are the real ids of the
-- accounts the code resolved by name, so the screen opens showing the truth.
insert into public.acct_automation_rules
  (company_id, module, rule_key, label, trigger_label, enabled, debit_account_id, credit_account_id, cost_center, notes)
select c.id, r.module, r.rule_key, r.label, r.trigger_label, false,
       (select a.id from accounts a where a.company_id=c.id and a.name=r.dr_name limit 1),
       (select a.id from accounts a where a.company_id=c.id and a.name=r.cr_name limit 1),
       r.cc, r.notes
from public.companies c
cross join (values
  ('transport','transport.trip_completed','Transport invoice','Trip status becomes Completed',
     null,'Transport Sales','VISTA TRANSPORT',
     'Debits the agent''s own receivable account, which is resolved per agent and cannot be a fixed setting.'),
  ('transport','transport.vendor_cost','Transport vendor cost','Trip completed and given to a vendor',
     'Transport Cost',null,'OUTSOURCE TRANSPORT',
     'Credits the vendor''s own account, resolved per vendor.'),
  ('visa','visa.group_created','Visa invoice','An Umrah Group is created',
     null,'Visa Sales','UMRAH VISA',
     'Debits the agent''s own receivable account, resolved per agent.'),
  ('visa','visa.supplier_cost','Visa supplier cost','Visa invoice is posted',
     'Visa Cost',null,'UMRAH VISA',
     'Credits the supplier account named on the visa invoice.'),
  ('hotel','hotel.vendor_confirmed','Hotel invoice','Purchase booking becomes Vendor Confirmed / HCN Pending / HCN Received',
     null,'Hotel Sales','HOTEL',
     'Debits the agent''s own receivable account, resolved per agent.'),
  ('hotel','hotel.supplier_cost','Hotel supplier cost','Purchase booking is posted',
     'Hotel Cost',null,'HOTEL',
     'Credits the supplier''s own account, resolved per supplier.'),
  ('car','car.vehicle','Car vehicle purchase','A vehicle is added or its cost changes',null,null,null,
     'Accounts are resolved inside car_post_vehicle; not yet configurable here.'),
  ('car','car.contract','Car invoice','A car contract is created or its price changes',null,null,null,
     'Accounts are resolved inside car_post_contract; not yet configurable here.'),
  ('car','car.receipt','Car receipt','A car receipt is saved',null,null,null,
     'Accounts are resolved inside car_post_receipt; not yet configurable here.'),
  ('car','car.charge','Car monthly charge','A monthly service charge is raised',null,null,null,
     'Accounts are resolved inside car_post_charge; not yet configurable here.'),
  ('car','car.charge_payment','Car charge payment','A service charge payment is recorded',null,null,null,
     'Accounts are resolved inside car_post_charge_payment; not yet configurable here.'),
  ('car','car.commission','Car commission','A commission row is created',null,null,null,
     'Accounts are resolved inside car_post_commission; not yet configurable here.')
) as r(module, rule_key, label, trigger_label, dr_name, cr_name, cc, notes)
on conflict (company_id, rule_key) do nothing;

-- ── saving a rule: validated, audited, permission-checked ──────────────────
-- The screen never writes the table directly. Everything a person can get wrong
-- is refused here rather than in the UI, because the UI is not the only way in.
create or replace function public.acct_automation_save(
  p_id uuid, p_enabled boolean,
  p_debit uuid default null, p_credit uuid default null, p_cost_center text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $f$
declare r acct_automation_rules; v_co uuid; v_before jsonb; v_after jsonb;
begin
  if not is_staff() then raise exception 'Not signed in'; end if;
  -- Same right that opens the Accounting module; an admin always passes.
  if not (has_role('admin') or staff_has_perm('accounting.settings')) then
    raise exception 'You do not have permission to change accounting automation';
  end if;

  select * into r from acct_automation_rules where id = p_id;
  if not found then raise exception 'Rule not found'; end if;
  v_co := auth_company_id();
  if r.company_id <> v_co then raise exception 'That rule belongs to another company'; end if;

  -- An account must exist, belong to this company, and not be a group header.
  if p_debit is not null and not exists (
      select 1 from accounts a where a.id = p_debit and a.company_id = v_co
         and not coalesce(a.is_group,false) and coalesce(a.is_postable,true)
         and coalesce(a.status,'active') = 'active')
  then raise exception 'The debit account is not a usable account in this company'; end if;
  if p_credit is not null and not exists (
      select 1 from accounts a where a.id = p_credit and a.company_id = v_co
         and not coalesce(a.is_group,false) and coalesce(a.is_postable,true)
         and coalesce(a.status,'active') = 'active')
  then raise exception 'The credit account is not a usable account in this company'; end if;

  -- Turning a rule ON without the accounts it needs would post to nothing, so
  -- it is refused rather than silently falling back.
  if p_enabled then
    if r.rule_key in ('transport.trip_completed','visa.group_created','hotel.vendor_confirmed')
       and coalesce(p_credit, r.credit_account_id) is null then
      raise exception 'Choose a revenue (credit) account before turning this on';
    end if;
    if r.rule_key in ('transport.vendor_cost','visa.supplier_cost','hotel.supplier_cost')
       and coalesce(p_debit, r.debit_account_id) is null then
      raise exception 'Choose a cost (debit) account before turning this on';
    end if;
  end if;

  v_before := jsonb_build_object('enabled', r.enabled, 'debit_account_id', r.debit_account_id,
                                 'credit_account_id', r.credit_account_id, 'cost_center', r.cost_center);

  update acct_automation_rules
     set enabled = p_enabled,
         debit_account_id  = coalesce(p_debit,  debit_account_id),
         credit_account_id = coalesce(p_credit, credit_account_id),
         cost_center = coalesce(nullif(p_cost_center,''), cost_center),
         updated_at = now(), updated_by = auth.uid()
   where id = p_id
   returning * into r;

  v_after := jsonb_build_object('enabled', r.enabled, 'debit_account_id', r.debit_account_id,
                                'credit_account_id', r.credit_account_id, 'cost_center', r.cost_center);

  -- The ERP's existing audit log, not a second one.
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_co, auth.uid(), 'invoice_automation_changed', 'acct_automation_rule', r.id,
          jsonb_build_object('rule_key', r.rule_key, 'label', r.label,
                             'before', v_before, 'after', v_after));

  return jsonb_build_object('ok', true, 'rule_key', r.rule_key, 'enabled', r.enabled);
end $f$;
revoke all on function public.acct_automation_save(uuid, boolean, uuid, uuid, text) from public, anon;
grant execute on function public.acct_automation_save(uuid, boolean, uuid, uuid, text) to authenticated;

-- What the settings screen reads: every rule with its accounts resolved to
-- names and codes, so the screen shows "Transport Sales - 4-10" rather than a uuid.
create or replace function public.acct_automation_list()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $f$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'module', r.module, 'rule_key', r.rule_key, 'label', r.label,
    'trigger_label', r.trigger_label, 'enabled', r.enabled, 'cost_center', r.cost_center,
    'notes', r.notes, 'updated_at', r.updated_at,
    'updated_by_name', (select full_name from profiles p where p.id = r.updated_by),
    'debit_account_id', r.debit_account_id,
    'debit_account', (select a.name || ' — ' || a.code from accounts a where a.id = r.debit_account_id),
    'credit_account_id', r.credit_account_id,
    'credit_account', (select a.name || ' — ' || a.code from accounts a where a.id = r.credit_account_id)
  ) order by r.module, r.rule_key), '[]'::jsonb)
  from acct_automation_rules r
  where r.company_id = auth_company_id() and is_staff();
$f$;
revoke all on function public.acct_automation_list() from public, anon;
grant execute on function public.acct_automation_list() to authenticated;

-- Post-condition: every trigger must now be gated, and nothing may be enabled.
do $chk$
declare n int;
begin
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
   where ns.nspname='public'
     and p.proname in ('visa_group_autopost','transport_trip_autopost','hotel_purchase_autopost','car_autopost_trigger')
     and pg_get_functiondef(p.oid) like '%acct_automation_enabled%';
  if n <> 4 then raise exception '342: expected 4 gated autopost triggers, found %', n; end if;

  select count(*) into n from acct_automation_rules where enabled;
  if n <> 0 then raise exception '342: % rules seeded as enabled - all must start OFF', n; end if;

  select count(*) into n from acct_automation_rules;
  if n < 12 then raise exception '342: expected at least 12 seeded rules, found %', n; end if;
end $chk$;

commit;
