-- The WHEN becomes configuration, and new automations can be built without code.
--
-- 342 made "does this automation run, and on which accounts" a row in a table.
-- It left the other half hard-coded: WHEN. Whether a transport invoice was
-- raised on 'completed' rather than 'picked_up' lived inside
-- transport_trip_autopost, and the settings screen printed a sentence describing
-- it that no amount of clicking could change.
--
-- Now the trigger is a row too, and the three module trigger functions become
-- generic dispatchers: they look up the rules that match (this table, this
-- column, this new value) and run whatever those rules say. Change the value on
-- the screen and the ERP genuinely fires somewhere else.
--
-- WHAT IS REAL, AND WHY THERE IS A REGISTRY
--
-- The danger in a feature like this is a builder that offers combinations the
-- ERP cannot honour — a dropdown that saves happily and then posts nothing.
-- So the vocabulary is not open. Two registries hold what actually exists,
-- both seeded from inspection of the running system:
--
--   acct_automation_events  — every event the ERP can DETECT. Each names a real
--     table and column that a module already writes, and the values that column
--     actually takes. Nothing here is aspirational.
--
--   acct_automation_actions — every action the ERP can PERFORM. Each names a
--     routine that already exists and already works. Four of them.
--
-- A rule may only pair an event with an action that declares it can consume it,
-- which is what stops somebody wiring "hotel booking confirmed" to the transport
-- posting, where the id would mean nothing.
--
-- WHAT IS DELIBERATELY ABSENT. There is no "payment received" event: the
-- payments table has no rows and no triggers, and nothing in the application
-- writes it, so the ERP cannot detect a payment. Adding it needs code, not
-- configuration. Better an event that is missing than one that never fires.
--
-- TRIGGER RULES AND ACCOUNT RULES ARE NOT THE SAME THING. Three of the twelve
-- rules 342 seeded are not triggers at all: transport.vendor_cost,
-- visa.supplier_cost and hotel.supplier_cost supply the accounts for the second
-- leg of a posting their sibling rule already makes. transport_trip_post_gl
-- writes the sale and the vendor cost in ONE entry; there is no moment at which
-- the vendor leg could fire alone. They are marked kind='accounts' and shown as
-- what they are, rather than given a fake on/off that would not mean anything.
-- Splitting them into independently triggerable postings is a code change.
--
-- DUPLICATE PROTECTION IS ALREADY THERE AND IS NOT REPLACED. visa_invoices has
-- a UNIQUE index on group_id; transport_trip_post_gl refuses once gl_entry is
-- set; hotel_purchase_post_gl refuses once gl_posted_at is set. Re-saving,
-- refreshing, reopening or retrying therefore cannot double-post, whatever the
-- trigger is changed to. The dispatcher adds one more guard of its own: it only
-- fires when the watched column actually CHANGED to the configured value, so
-- saving a record that is already 'completed' does nothing.

begin;

-- ── what the ERP can detect ────────────────────────────────────────────────
create table if not exists public.acct_automation_events (
  event_key    text primary key,
  module       text not null,
  label        text not null,
  table_name   text not null,
  column_name  text,                       -- null = the row being created
  value_options text[] not null default '{}',
  allow_free_text boolean not null default false,
  description  text
);

insert into public.acct_automation_events
  (event_key, module, label, table_name, column_name, value_options, allow_free_text, description) values
  ('transport.trip_status','transport','Trip status becomes…','transport_trips','status',
     array['pending','assigned','picked_up','on_route','completed','cancelled','outsource_required','outsourced'],
     true,
     'transport_trips.status is a plain text column with no constraint, so these are the values the Transport module is actually observed to write. A status typed by hand will fire only if something writes it.'),
  ('hotel.vendor_status','hotel','Purchase booking status becomes…','hotel_purchase_bookings','vendor_status',
     array['pending_purchase','sent_to_vendor','vendor_processing','vendor_confirmed','hcn_pending','hcn_received','cancelled','rejected'],
     false,
     'The full hotel_vendor_status enum. Only vendor_confirmed, hcn_pending and hcn_received have been used so far.'),
  ('visa.group_created','visa','An Umrah Group is created','umrah_groups',null,
     '{}', false,
     'Fires as the group row is inserted. This is what raised every visa invoice before automation became configurable.'),
  ('visa.visa_status','visa','Group visa status becomes…','umrah_groups','visa_status',
     array['pending','applied','issued','rejected'], false,
     'The visa_status vocabulary. Only pending and issued appear in the data so far.'),
  ('visa.workflow_status','visa','Group workflow status becomes…','umrah_groups','workflow_status',
     array['erp_created','package_assigned','pending','process','visa_issued'], false, null),
  ('visa.brn_status','visa','Group BRN status becomes…','umrah_groups','brn_status',
     array['pending','allocated'], false, null)
on conflict (event_key) do nothing;

-- ── what the ERP can perform ───────────────────────────────────────────────
create table if not exists public.acct_automation_actions (
  action_key   text primary key,
  label        text not null,
  routine      text not null,
  accepts_events text[] not null,
  needs_credit boolean not null default false,
  needs_debit  boolean not null default false,
  description  text
);

insert into public.acct_automation_actions
  (action_key, label, routine, accepts_events, needs_credit, needs_debit, description) values
  ('transport.post_gl','Create Transport invoice','transport_trip_post_gl',
     array['transport.trip_status'], true, false,
     'Debits the agent on the booking, credits the revenue account below. When the trip is outsourced the same entry also carries the vendor cost, using the accounts on the Transport vendor cost rule.'),
  ('hotel.post_gl','Create Hotel invoice and supplier cost','hotel_purchase_post_gl',
     array['hotel.vendor_status'], true, false,
     'Debits the agent on the booking and credits the revenue account; separately debits the cost account and credits the supplier, using the Hotel supplier cost rule.'),
  ('visa.generate_invoice','Create Visa invoice','visa_invoice_generate',
     array['visa.group_created','visa.visa_status','visa.workflow_status','visa.brn_status'], true, false,
     'Raises the VI- invoice from the group and posts it. One invoice per group is enforced by a unique index, so this cannot run twice for the same group whatever the trigger.')
on conflict (action_key) do nothing;

grant select on public.acct_automation_events  to authenticated;
grant select on public.acct_automation_actions to authenticated;

-- ── the rule gains a WHEN and a DO ─────────────────────────────────────────
alter table public.acct_automation_rules
  add column if not exists name        text,
  add column if not exists kind        text not null default 'trigger',
  add column if not exists event_key   text references public.acct_automation_events(event_key),
  add column if not exists event_value text,
  add column if not exists action_key  text references public.acct_automation_actions(action_key),
  add column if not exists created_by  uuid references public.profiles(id) on delete set null,
  add column if not exists created_at  timestamptz not null default now(),
  add column if not exists system_rule boolean not null default false;

-- the same trigger must not be wired twice to the same action, which is how a
-- record would get two invoices from one event
create unique index if not exists acct_automation_rules_one_per_trigger
  on public.acct_automation_rules (company_id, event_key, coalesce(event_value,''), action_key)
  where kind = 'trigger';

-- ── carry the twelve existing rules into the new shape ─────────────────────
-- Behaviour is preserved exactly: the same events, the same actions, the same
-- accounts, and still OFF.
update public.acct_automation_rules set
  name        = coalesce(name, label),
  kind        = case when rule_key in ('transport.vendor_cost','visa.supplier_cost','hotel.supplier_cost')
                     then 'accounts' else 'trigger' end,
  system_rule = true,
  event_key   = case rule_key
                  when 'transport.trip_completed'  then 'transport.trip_status'
                  when 'hotel.vendor_confirmed'    then 'hotel.vendor_status'
                  when 'visa.group_created'        then 'visa.group_created'
                  else null end,
  event_value = case rule_key
                  when 'transport.trip_completed'  then 'completed'
                  when 'hotel.vendor_confirmed'    then 'vendor_confirmed'
                  else null end,
  action_key  = case rule_key
                  when 'transport.trip_completed'  then 'transport.post_gl'
                  when 'hotel.vendor_confirmed'    then 'hotel.post_gl'
                  when 'visa.group_created'        then 'visa.generate_invoice'
                  else null end
where event_key is null and action_key is null;

-- The car rules keep their own dispatcher (car_autopost_trigger reads them by
-- rule_key); they are triggers, but their events are not in the registry
-- because their accounts are resolved inside car_post_* and are not yet
-- configurable. Marked so the screen can say so rather than imply otherwise.
update public.acct_automation_rules
   set kind = 'trigger', system_rule = true, name = coalesce(name, label)
 where module = 'car' and event_key is null;


-- ── the dispatcher ─────────────────────────────────────────────────────────
-- One routine that every watched table's trigger calls. It answers: given this
-- table, this column and the value it just changed to, which enabled rules
-- match, and what do they say to run? The module trigger functions no longer
-- decide anything themselves.
--
-- It fires only on an actual CHANGE to the configured value (or on insert),
-- so re-saving a record that is already 'completed' does nothing — the first
-- and cheapest defence against a duplicate posting, before the per-routine
-- guards are even reached.
create or replace function public.acct_automation_dispatch(
  p_company uuid, p_table text, p_column text, p_new_value text, p_row uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $f$
declare r record; v_err text;
begin
  for r in
    select ru.id, ru.name, ru.action_key, a.routine
      from acct_automation_rules ru
      join acct_automation_events  e on e.event_key  = ru.event_key
      join acct_automation_actions a on a.action_key = ru.action_key
     where ru.company_id = p_company
       and ru.kind = 'trigger'
       and ru.enabled
       and e.table_name = p_table
       and e.column_name is not distinct from p_column
       and (e.column_name is null or ru.event_value = p_new_value)
  loop
    begin
      -- Only the routines named in acct_automation_actions can be reached, and
      -- that table is not writable by anyone, so this cannot become a way to
      -- call an arbitrary function.
      execute format('select %I($1)', r.routine) using p_row;
    exception when others then
      get stacked diagnostics v_err = message_text;
      begin
        insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
        values (p_company, auth.uid(), 'automation_failed', p_table, p_row,
                jsonb_build_object('rule', r.name, 'action', r.action_key, 'error', v_err));
      exception when others then null; end;
    end;
  end loop;
end $f$;
revoke all on function public.acct_automation_dispatch(uuid, text, text, text, uuid) from public, anon;

-- TRANSPORT
create or replace function public.transport_trip_autopost()
returns trigger language plpgsql security definer set search_path to 'public' as $f$
begin
  if new.status is distinct from old.status then
    perform acct_automation_dispatch(new.company_id, 'transport_trips', 'status', new.status, new.id);
  end if;
  return new;
end $f$;

-- HOTEL
create or replace function public.hotel_purchase_autopost()
returns trigger language plpgsql security definer set search_path to 'public' as $f$
begin
  if tg_op = 'INSERT' or new.vendor_status is distinct from old.vendor_status then
    perform acct_automation_dispatch(new.company_id, 'hotel_purchase_bookings', 'vendor_status',
                                     new.vendor_status::text, new.id);
  end if;
  return new;
end $f$;

-- VISA / UMRAH GROUP. Creation and the three status columns are separate
-- events, so one function serves the insert trigger and the update trigger.
create or replace function public.visa_group_autopost()
returns trigger language plpgsql security definer set search_path to 'public' as $f$
begin
  if tg_op = 'INSERT' then
    perform acct_automation_dispatch(new.company_id, 'umrah_groups', null, null, new.id);
    return new;
  end if;
  if new.visa_status is distinct from old.visa_status then
    perform acct_automation_dispatch(new.company_id, 'umrah_groups', 'visa_status', new.visa_status, new.id);
  end if;
  if new.workflow_status is distinct from old.workflow_status then
    perform acct_automation_dispatch(new.company_id, 'umrah_groups', 'workflow_status', new.workflow_status, new.id);
  end if;
  if new.brn_status is distinct from old.brn_status then
    perform acct_automation_dispatch(new.company_id, 'umrah_groups', 'brn_status', new.brn_status, new.id);
  end if;
  return new;
end $f$;

-- the group trigger only fired on INSERT before; the status events need UPDATE too
drop trigger if exists trg_visa_group_autopost_upd on public.umrah_groups;
create trigger trg_visa_group_autopost_upd
  after update of visa_status, workflow_status, brn_status on public.umrah_groups
  for each row execute function visa_group_autopost();

-- ── reading and writing rules ──────────────────────────────────────────────
create or replace function public.acct_automation_list()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $f$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'module', r.module, 'rule_key', r.rule_key,
    'name', coalesce(r.name, r.label), 'label', r.label, 'kind', r.kind,
    'system_rule', r.system_rule, 'enabled', r.enabled,
    'event_key', r.event_key, 'event_value', r.event_value,
    'event_label', (select e.label from acct_automation_events e where e.event_key = r.event_key),
    'event_table', (select e.table_name from acct_automation_events e where e.event_key = r.event_key),
    'action_key', r.action_key,
    'action_label', (select a.label from acct_automation_actions a where a.action_key = r.action_key),
    'trigger_label', r.trigger_label, 'cost_center', r.cost_center, 'notes', r.notes,
    'updated_at', r.updated_at,
    'updated_by_name', (select full_name from profiles p where p.id = r.updated_by),
    'created_by_name', (select full_name from profiles p where p.id = r.created_by),
    'created_at', r.created_at,
    'debit_account_id', r.debit_account_id,
    'debit_account', (select a.name || ' — ' || a.code from accounts a where a.id = r.debit_account_id),
    'credit_account_id', r.credit_account_id,
    'credit_account', (select a.name || ' — ' || a.code from accounts a where a.id = r.credit_account_id)
  ) order by r.module, r.kind desc, coalesce(r.name, r.label)), '[]'::jsonb)
  from acct_automation_rules r
  where r.company_id = auth_company_id() and is_staff();
$f$;
revoke all on function public.acct_automation_list() from public, anon;
grant execute on function public.acct_automation_list() to authenticated;

-- The registries, for the builder's dropdowns.
create or replace function public.acct_automation_catalog()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $f$
  select jsonb_build_object(
    'events', (select coalesce(jsonb_agg(jsonb_build_object(
        'event_key', e.event_key, 'module', e.module, 'label', e.label,
        'table_name', e.table_name, 'column_name', e.column_name,
        'value_options', e.value_options, 'allow_free_text', e.allow_free_text,
        'description', e.description) order by e.module, e.event_key), '[]'::jsonb)
      from acct_automation_events e),
    'actions', (select coalesce(jsonb_agg(jsonb_build_object(
        'action_key', a.action_key, 'label', a.label, 'accepts_events', a.accepts_events,
        'needs_credit', a.needs_credit, 'needs_debit', a.needs_debit,
        'description', a.description) order by a.action_key), '[]'::jsonb)
      from acct_automation_actions a))
  where is_staff();
$f$;
revoke all on function public.acct_automation_catalog() from public, anon;
grant execute on function public.acct_automation_catalog() to authenticated;

-- ── one guarded door for every change ──────────────────────────────────────
-- 342's five-argument version is DROPPED rather than replaced: adding
-- arguments to a Postgres function creates an overload, not a replacement, and
-- two functions of the same name is how PostgREST comes to call the one that
-- silently ignores the new fields.
drop function if exists public.acct_automation_save(uuid, boolean, uuid, uuid, text);

create or replace function public.acct_automation_save(
  p_id uuid, p_enabled boolean,
  p_debit uuid default null, p_credit uuid default null, p_cost_center text default null,
  p_event_key text default null, p_event_value text default null,
  p_action_key text default null, p_name text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $f$
declare r acct_automation_rules; v_co uuid; v_before jsonb; v_after jsonb;
        v_ev text; v_val text; v_act text; e acct_automation_events; a acct_automation_actions;
begin
  if not is_staff() then raise exception 'Not signed in'; end if;
  if not (has_role('admin') or staff_has_perm('accounting.settings')) then
    raise exception 'You do not have permission to change accounting automation';
  end if;

  select * into r from acct_automation_rules where id = p_id;
  if not found then raise exception 'Rule not found'; end if;
  v_co := auth_company_id();
  if r.company_id <> v_co then raise exception 'That rule belongs to another company'; end if;

  v_ev  := coalesce(p_event_key,  r.event_key);
  v_val := coalesce(p_event_value, r.event_value);
  v_act := coalesce(p_action_key, r.action_key);

  if p_debit is not null and not exists (
      select 1 from accounts x where x.id = p_debit and x.company_id = v_co
         and not coalesce(x.is_group,false) and coalesce(x.is_postable,true)
         and coalesce(x.status,'active') = 'active')
  then raise exception 'The debit account is not a usable account in this company'; end if;
  if p_credit is not null and not exists (
      select 1 from accounts x where x.id = p_credit and x.company_id = v_co
         and not coalesce(x.is_group,false) and coalesce(x.is_postable,true)
         and coalesce(x.status,'active') = 'active')
  then raise exception 'The credit account is not a usable account in this company'; end if;

  -- a trigger rule must name an event and an action that can consume it
  if r.kind = 'trigger' and r.module <> 'car' then
    if v_ev is null or v_act is null then
      raise exception 'A trigger rule needs both an event and an action';
    end if;
    select * into e from acct_automation_events  where event_key  = v_ev;
    if not found then raise exception 'Unknown event %', v_ev; end if;
    select * into a from acct_automation_actions where action_key = v_act;
    if not found then raise exception 'Unknown action %', v_act; end if;
    if not (v_ev = any (a.accepts_events)) then
      raise exception '% cannot be run by the event %', a.label, e.label;
    end if;
    if e.column_name is not null then
      if v_val is null or v_val = '' then raise exception 'Choose which value should set this off'; end if;
      if not e.allow_free_text and not (v_val = any (e.value_options)) then
        raise exception '% is not one of the values % can take', v_val, e.label;
      end if;
    end if;
    if p_enabled then
      if a.needs_credit and coalesce(p_credit, r.credit_account_id) is null then
        raise exception 'Choose a revenue (credit) account before turning this on'; end if;
      if a.needs_debit and coalesce(p_debit, r.debit_account_id) is null then
        raise exception 'Choose a cost (debit) account before turning this on'; end if;
    end if;
  end if;

  v_before := jsonb_build_object('enabled', r.enabled, 'event_key', r.event_key,
    'event_value', r.event_value, 'action_key', r.action_key, 'name', r.name,
    'debit_account_id', r.debit_account_id, 'credit_account_id', r.credit_account_id,
    'cost_center', r.cost_center);

  update acct_automation_rules
     set enabled = p_enabled,
         name = coalesce(nullif(p_name,''), name),
         event_key = v_ev, event_value = v_val, action_key = v_act,
         debit_account_id  = coalesce(p_debit,  debit_account_id),
         credit_account_id = coalesce(p_credit, credit_account_id),
         cost_center = coalesce(nullif(p_cost_center,''), cost_center),
         updated_at = now(), updated_by = auth.uid()
   where id = p_id
   returning * into r;

  v_after := jsonb_build_object('enabled', r.enabled, 'event_key', r.event_key,
    'event_value', r.event_value, 'action_key', r.action_key, 'name', r.name,
    'debit_account_id', r.debit_account_id, 'credit_account_id', r.credit_account_id,
    'cost_center', r.cost_center);

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_co, auth.uid(), 'invoice_automation_changed', 'acct_automation_rule', r.id,
          jsonb_build_object('rule_key', r.rule_key, 'name', coalesce(r.name, r.label),
                             'before', v_before, 'after', v_after));

  return jsonb_build_object('ok', true, 'rule_key', r.rule_key, 'enabled', r.enabled);
end $f$;
revoke all on function public.acct_automation_save(uuid, boolean, uuid, uuid, text, text, text, text, text) from public, anon;
grant execute on function public.acct_automation_save(uuid, boolean, uuid, uuid, text, text, text, text, text) to authenticated;

-- ── building a new one ─────────────────────────────────────────────────────
create or replace function public.acct_automation_create(
  p_name text, p_event_key text, p_event_value text, p_action_key text,
  p_debit uuid default null, p_credit uuid default null, p_cost_center text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $f$
declare v_co uuid; e acct_automation_events; a acct_automation_actions; v_id uuid; v_key text;
begin
  if not is_staff() then raise exception 'Not signed in'; end if;
  if not (has_role('admin') or staff_has_perm('accounting.settings')) then
    raise exception 'You do not have permission to create accounting automation';
  end if;
  v_co := auth_company_id();
  if coalesce(trim(p_name),'') = '' then raise exception 'Give the automation a name'; end if;

  select * into e from acct_automation_events  where event_key  = p_event_key;
  if not found then raise exception 'Unknown event'; end if;
  select * into a from acct_automation_actions where action_key = p_action_key;
  if not found then raise exception 'Unknown action'; end if;
  if not (p_event_key = any (a.accepts_events)) then
    raise exception '% cannot be run by the event %', a.label, e.label;
  end if;
  if e.column_name is not null then
    if coalesce(p_event_value,'') = '' then raise exception 'Choose which value should set this off'; end if;
    if not e.allow_free_text and not (p_event_value = any (e.value_options)) then
      raise exception '% is not one of the values % can take', p_event_value, e.label;
    end if;
  end if;
  if exists (select 1 from acct_automation_rules where company_id = v_co and kind='trigger'
              and event_key = p_event_key and coalesce(event_value,'') = coalesce(p_event_value,'')
              and action_key = p_action_key) then
    raise exception 'There is already an automation doing that on the same event';
  end if;

  v_key := e.module || '.custom.' || replace(lower(trim(p_name)), ' ', '_') || '.' || substr(gen_random_uuid()::text, 1, 8);

  insert into acct_automation_rules
    (company_id, module, rule_key, label, trigger_label, enabled, kind, system_rule,
     name, event_key, event_value, action_key, debit_account_id, credit_account_id, cost_center,
     created_by, updated_by)
  values (v_co, e.module, v_key, p_name,
          e.label || coalesce(' ' || p_event_value, ''), false, 'trigger', false,
          p_name, p_event_key, p_event_value, p_action_key, p_debit, p_credit, p_cost_center,
          auth.uid(), auth.uid())
  returning id into v_id;

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_co, auth.uid(), 'invoice_automation_created', 'acct_automation_rule', v_id,
          jsonb_build_object('name', p_name, 'event_key', p_event_key,
                             'event_value', p_event_value, 'action_key', p_action_key));

  return jsonb_build_object('ok', true, 'id', v_id);
end $f$;
revoke all on function public.acct_automation_create(text, text, text, text, uuid, uuid, text) from public, anon;
grant execute on function public.acct_automation_create(text, text, text, text, uuid, uuid, text) to authenticated;

-- Only rules somebody built may be removed; the seeded ones describe what the
-- ERP does and are switched off rather than deleted.
create or replace function public.acct_automation_delete(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $f$
declare r acct_automation_rules; v_co uuid;
begin
  if not is_staff() then raise exception 'Not signed in'; end if;
  if not (has_role('admin') or staff_has_perm('accounting.settings')) then
    raise exception 'You do not have permission to delete accounting automation';
  end if;
  v_co := auth_company_id();
  select * into r from acct_automation_rules where id = p_id and company_id = v_co;
  if not found then raise exception 'Rule not found'; end if;
  if r.system_rule then
    raise exception 'This automation is part of the ERP. Turn it off instead of deleting it.';
  end if;
  delete from acct_automation_rules where id = p_id;
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_co, auth.uid(), 'invoice_automation_deleted', 'acct_automation_rule', p_id,
          jsonb_build_object('name', coalesce(r.name, r.label), 'event_key', r.event_key,
                             'event_value', r.event_value, 'action_key', r.action_key));
  return jsonb_build_object('ok', true);
end $f$;
revoke all on function public.acct_automation_delete(uuid) from public, anon;
grant execute on function public.acct_automation_delete(uuid) to authenticated;

do $chk$
declare n int;
begin
  select count(*) into n from acct_automation_rules where kind='trigger' and module<>'car' and event_key is null;
  if n <> 0 then raise exception '345: % trigger rule(s) have no event', n; end if;
  select count(*) into n from acct_automation_rules where enabled;
  if n <> 0 then raise exception '345: % rules are enabled — all must stay OFF', n; end if;
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
   where ns.nspname='public' and p.proname in ('transport_trip_autopost','hotel_purchase_autopost','visa_group_autopost')
     and pg_get_functiondef(p.oid) like '%acct_automation_dispatch%';
  if n <> 3 then raise exception '345: expected 3 dispatching triggers, found %', n; end if;
end $chk$;


-- ── the posting routines must accept the status the RULE names ─────────────
--
-- Found by testing, and it would have made the whole feature a lie. The
-- dispatcher fired correctly on the new trigger, and then
-- transport_trip_post_gl refused the trip because its own body said
--
--     if t.status <> 'completed' then return 'trip not completed'
--
-- so changing the trigger to picked_up changed nothing at all: the old event
-- stopped firing and the new one was turned away at the door. The same
-- hard-coded list sat in hotel_purchase_post_gl.
--
-- The guard is not removed — a routine that posts any trip in any state would
-- be worse. It now asks the configuration instead: post if the row is in the
-- state the module has always considered final, OR in a state some enabled rule
-- names as its trigger. The manual Post buttons on the invoice screens are
-- unaffected, because a completed trip and a vendor-confirmed booking still
-- qualify exactly as before.
create or replace function public.acct_automation_status_ok(
  p_company uuid, p_table text, p_column text, p_status text)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $f$
  select exists (
    select 1 from acct_automation_rules r
      join acct_automation_events e on e.event_key = r.event_key
     where r.company_id = p_company and r.enabled and r.kind = 'trigger'
       and e.table_name = p_table and e.column_name = p_column
       and r.event_value = p_status);
$f$;
revoke all on function public.acct_automation_status_ok(uuid, text, text, text) from public, anon;
grant execute on function public.acct_automation_status_ok(uuid, text, text, text) to authenticated;

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
  -- 'completed' keeps working for the manual Post button; anything else must be
  -- a status an enabled rule actually names.
  if coalesce(t.status,'') <> 'completed'
     and not acct_automation_status_ok(v_co, 'transport_trips', 'status', t.status) then
    return jsonb_build_object('posted', false, 'reason', 'trip status is not one that posts');
  end if;
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
  -- the three statuses the module has always treated as confirmed keep working
  -- for the manual Post button; anything else must be named by an enabled rule.
  if coalesce(hp.vendor_status::text,'') not in ('vendor_confirmed','hcn_pending','hcn_received')
     and not acct_automation_status_ok(v_co, 'hotel_purchase_bookings', 'vendor_status', hp.vendor_status::text) then
    return jsonb_build_object('posted', false, 'reason', 'booking status is not one that posts');
  end if;

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

commit;
