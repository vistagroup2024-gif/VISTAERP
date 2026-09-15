-- 396 — Two of the six Car Sales rows on Invoice Automation showed OFF while
-- posting every time regardless. `car_contract_save` calls `car_post_contract`
-- unconditionally on every save (not gated by acct_automation_enabled), and the
-- monthly Service Charges voucher posts through `car_post_charges_month`
-- directly — neither has ever read this table's `enabled` column. The other
-- four car rows (vehicle, receipt, charge_payment, commission) ARE gated by
-- car_autopost_trigger()'s own acct_automation_enabled() check and are real.
--
-- In production both car.contract and car.charge sit at enabled=false right
-- now, so the screen was actively telling whoever reads it that car invoices
-- and monthly charges do not post automatically, when they always have. This
-- names the two rows for what they are rather than leaving them looking like
-- switches that do nothing when pressed.

alter table acct_automation_rules add column if not exists always_runs boolean not null default false;

update acct_automation_rules
   set always_runs = true,
       enabled = true,
       notes = 'car_contract_save posts every contract unconditionally — this switch has no effect and cannot be turned off.'
 where rule_key = 'car.contract' and module = 'car';

update acct_automation_rules
   set always_runs = true,
       enabled = true,
       notes = 'The monthly Service Charges voucher posts directly when saved — this switch has no effect and cannot be turned off.'
 where rule_key = 'car.charge' and module = 'car';

-- ── the screen's own read: always_runs travels with everything else ────────
create or replace function public.acct_automation_list()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'module', r.module, 'rule_key', r.rule_key,
    'name', coalesce(r.name, r.label), 'label', r.label, 'kind', r.kind,
    'system_rule', r.system_rule, 'enabled', r.enabled, 'always_runs', r.always_runs,
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
$function$;
revoke all on function public.acct_automation_list() from public, anon;
grant execute on function public.acct_automation_list() to authenticated;

-- ── the save: refused server-side too, not only hidden in the UI ───────────
-- "The screen never writes the table directly. Everything a person can get
-- wrong is refused here rather than in the UI" (342) — a row that always runs
-- is exactly such a case, so the refusal belongs here, whatever the screen
-- ever does or does not show.
create or replace function public.acct_automation_save(
  p_id uuid, p_enabled boolean,
  p_debit uuid default null, p_credit uuid default null, p_cost_center text default null,
  p_event_key text default null, p_event_value text default null, p_action_key text default null,
  p_name text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  if r.always_runs and p_enabled is distinct from r.enabled then
    raise exception '% always posts on its own trigger — it cannot be switched off.', coalesce(r.name, r.label);
  end if;

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
end $function$;
revoke all on function public.acct_automation_save(uuid, boolean, uuid, uuid, text, text, text, text, text) from public, anon;
grant execute on function public.acct_automation_save(uuid, boolean, uuid, uuid, text, text, text, text, text) to authenticated;

do $chk$
declare v_contract record; v_charge record; v_other_car_off int;
begin
  select always_runs, enabled, notes into v_contract from acct_automation_rules where rule_key = 'car.contract';
  select always_runs, enabled, notes into v_charge from acct_automation_rules where rule_key = 'car.charge';
  if not v_contract.always_runs or not v_contract.enabled then
    raise exception 'car.contract not marked always_runs/enabled';
  end if;
  if not v_charge.always_runs or not v_charge.enabled then
    raise exception 'car.charge not marked always_runs/enabled';
  end if;
  if v_contract.notes not like '%cannot be turned off%' or v_charge.notes not like '%cannot be turned off%' then
    raise exception 'notes not updated as expected';
  end if;
  -- the other four car rows are untouched: still real, off-by-default toggles
  select count(*) into v_other_car_off from acct_automation_rules
   where module = 'car' and rule_key not in ('car.contract','car.charge') and always_runs = false;
  if v_other_car_off <> 4 then
    raise exception 'expected the other 4 car rules to stay always_runs=false, got %', v_other_car_off;
  end if;
end $chk$;
