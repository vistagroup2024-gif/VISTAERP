-- ROLLBACK for 345. Returns the three module triggers to deciding WHEN for
-- themselves (reading only the on/off flag 342 gave them), and removes the
-- event/action registries and the builder.
--
-- Any automation somebody BUILT in the ERP is deleted by this, because there is
-- nowhere for it to live once the registries are gone. The twelve seeded rules
-- survive with their accounts and their on/off state; only the WHEN goes back
-- to being hard-coded.

begin;

drop trigger if exists trg_visa_group_autopost_upd on public.umrah_groups;

create or replace function public.transport_trip_autopost()
returns trigger language plpgsql security definer set search_path to 'public' as $f$
declare v_err text;
begin
  if new.status = 'completed' and coalesce(old.status,'') <> 'completed' and new.gl_entry is null then
    if not acct_automation_enabled(new.company_id, 'transport.trip_completed') then return new; end if;
    begin perform transport_trip_post_gl(new.id);
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

create or replace function public.hotel_purchase_autopost()
returns trigger language plpgsql security definer set search_path to 'public' as $f$
declare v_err text;
begin
  if coalesce(new.vendor_status::text,'') in ('vendor_confirmed','hcn_pending','hcn_received')
     and new.gl_posted_at is null
     and (tg_op = 'INSERT' or coalesce(old.vendor_status::text,'') not in ('vendor_confirmed','hcn_pending','hcn_received')) then
    if not acct_automation_enabled(new.company_id, 'hotel.vendor_confirmed') then return new; end if;
    begin perform hotel_purchase_post_gl(new.id);
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

create or replace function public.visa_group_autopost()
returns trigger language plpgsql security definer set search_path to 'public' as $f$
declare v_err text;
begin
  if not acct_automation_enabled(new.company_id, 'visa.group_created') then return new; end if;
  begin perform visa_invoice_generate(new.id);
  exception when others then
    get stacked diagnostics v_err = message_text;
    begin insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
      values (new.company_id, auth.uid(), 'visa_autopost_failed', 'umrah_group', new.id,
              jsonb_build_object('group_no', new.group_no, 'error', v_err));
    exception when others then null; end;
  end;
  return new;
end $f$;

-- rules somebody built have nowhere to live once the registries go
delete from public.acct_automation_rules where coalesce(system_rule, false) = false;

drop function if exists public.acct_automation_delete(uuid);
drop function if exists public.acct_automation_create(text, text, text, text, uuid, uuid, text);
drop function if exists public.acct_automation_save(uuid, boolean, uuid, uuid, text, text, text, text, text);

-- and put 342's five-argument version back, since 345 dropped it
create or replace function public.acct_automation_save(
  p_id uuid, p_enabled boolean,
  p_debit uuid default null, p_credit uuid default null, p_cost_center text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare r acct_automation_rules; v_co uuid; v_before jsonb; v_after jsonb;
begin
  if not is_staff() then raise exception 'Not signed in'; end if;
  if not (has_role('admin') or staff_has_perm('accounting.settings')) then
    raise exception 'You do not have permission to change accounting automation'; end if;
  select * into r from acct_automation_rules where id = p_id;
  if not found then raise exception 'Rule not found'; end if;
  v_co := auth_company_id();
  if r.company_id <> v_co then raise exception 'That rule belongs to another company'; end if;
  if p_debit is not null and not exists (select 1 from accounts a where a.id = p_debit and a.company_id = v_co
       and not coalesce(a.is_group,false) and coalesce(a.is_postable,true) and coalesce(a.status,'active')='active')
  then raise exception 'The debit account is not a usable account in this company'; end if;
  if p_credit is not null and not exists (select 1 from accounts a where a.id = p_credit and a.company_id = v_co
       and not coalesce(a.is_group,false) and coalesce(a.is_postable,true) and coalesce(a.status,'active')='active')
  then raise exception 'The credit account is not a usable account in this company'; end if;
  if p_enabled then
    if r.rule_key in ('transport.trip_completed','visa.group_created','hotel.vendor_confirmed')
       and coalesce(p_credit, r.credit_account_id) is null then
      raise exception 'Choose a revenue (credit) account before turning this on'; end if;
    if r.rule_key in ('transport.vendor_cost','visa.supplier_cost','hotel.supplier_cost')
       and coalesce(p_debit, r.debit_account_id) is null then
      raise exception 'Choose a cost (debit) account before turning this on'; end if;
  end if;
  v_before := jsonb_build_object('enabled', r.enabled, 'debit_account_id', r.debit_account_id,
                                 'credit_account_id', r.credit_account_id, 'cost_center', r.cost_center);
  update acct_automation_rules set enabled = p_enabled,
         debit_account_id = coalesce(p_debit, debit_account_id),
         credit_account_id = coalesce(p_credit, credit_account_id),
         cost_center = coalesce(nullif(p_cost_center,''), cost_center),
         updated_at = now(), updated_by = auth.uid()
   where id = p_id returning * into r;
  v_after := jsonb_build_object('enabled', r.enabled, 'debit_account_id', r.debit_account_id,
                                'credit_account_id', r.credit_account_id, 'cost_center', r.cost_center);
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_co, auth.uid(), 'invoice_automation_changed', 'acct_automation_rule', r.id,
          jsonb_build_object('rule_key', r.rule_key, 'label', r.label, 'before', v_before, 'after', v_after));
  return jsonb_build_object('ok', true, 'rule_key', r.rule_key, 'enabled', r.enabled);
end $f$;
grant execute on function public.acct_automation_save(uuid, boolean, uuid, uuid, text) to authenticated;
drop function if exists public.acct_automation_catalog();
drop function if exists public.acct_automation_dispatch(uuid, text, text, text, uuid);

drop index if exists public.acct_automation_rules_one_per_trigger;
alter table public.acct_automation_rules
  drop column if exists name, drop column if exists kind,
  drop column if exists event_key, drop column if exists event_value,
  drop column if exists action_key, drop column if exists created_by,
  drop column if exists created_at, drop column if exists system_rule;

drop table if exists public.acct_automation_actions;
drop table if exists public.acct_automation_events;

-- 342's save/list are restored so the settings screen keeps working
create or replace function public.acct_automation_list()
returns jsonb language sql stable security definer set search_path to 'public' as $f$
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
grant execute on function public.acct_automation_list() to authenticated;

do $chk$ begin
  if to_regclass('public.acct_automation_events') is not null then
    raise exception '345 rollback: the event registry is still present'; end if;
end $chk$;

commit;
