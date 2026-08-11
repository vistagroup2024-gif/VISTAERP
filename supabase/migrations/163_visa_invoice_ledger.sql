-- 163 Visa invoice ledger (mirrors the transport trip ledger).
--
-- Tracks whether a Visa Group's invoice has been created in the external accounting
-- software. Ticking is one-way for staff; only an admin may untick. A ledger RPC
-- feeds the Visa Invoices screen. Because visa invoicing happens AFTER the visa is
-- issued, guard_group_update() is extended to also exempt the invoice-* fields (like
-- the arrival-service fields) so staff can tick an issued group.
--
-- NOTE: run this against the DB (Supabase SQL editor or MCP).

alter table umrah_groups add column if not exists invoice_created boolean not null default false;
alter table umrah_groups add column if not exists invoice_created_at timestamptz;
alter table umrah_groups add column if not exists invoice_created_by uuid;

-- Extend the issued-group guard to also allow invoice-* only edits (post-issuance).
create or replace function guard_group_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare n umrah_groups := new;
begin
  if old.visa_status = 'issued' then
    if new.visa_status = 'issued' and not has_role('admin') then
      -- Arrival service and invoice tracking happen AFTER issuance; allow staff to
      -- change only those fields on an issued group. Any other change stays blocked.
      n.arrival_service    := old.arrival_service;
      n.arrival_tafweej_at := old.arrival_tafweej_at;
      n.arrival_tafweej_by := old.arrival_tafweej_by;
      n.invoice_created    := old.invoice_created;
      n.invoice_created_at := old.invoice_created_at;
      n.invoice_created_by := old.invoice_created_by;
      if n is distinct from old then
        raise exception 'This group has an issued visa — only a Super Admin can edit it.';
      end if;
    end if;
    if has_role('admin') and (new is distinct from old) then
      insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
      values (old.company_id, auth.uid(), 'group_override_edit', 'umrah_group', old.id,
              jsonb_build_object('group_no', old.group_no));
    end if;
  end if;
  return new;
end $$;

-- Tick / untick a group's invoice-created flag. One-way for staff; untick = admin.
create or replace function public.visa_set_invoice_created(p_group uuid, p_done boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if p_done = false and not has_role('admin') then
    raise exception 'Only an admin can un-mark an invoice as created';
  end if;
  update umrah_groups set
    invoice_created = p_done,
    invoice_created_at = case when p_done then now() else null end,
    invoice_created_by = case when p_done then auth.uid() else null end
  where id = p_group and company_id = auth_company_id();
  if not found then raise exception 'Group not found'; end if;
end $$;
revoke all on function public.visa_set_invoice_created(uuid, boolean) from anon;

-- Ledger rows for the Visa Invoices screen.
create or replace function public.visa_invoice_ledger(p_from date, p_to date)
returns table(
  group_id uuid, visa_date date, company text, customer text, group_name text,
  group_no text, visa_type text, total_nights int, pax int, invoice_created boolean
) language sql stable security definer set search_path to 'public' as $$
  select g.id,
         coalesce(g.visa_issued_at::date, g.group_date) as visa_date,
         gc.name as company,
         coalesce(a.agency_name, p.name) as customer,
         g.group_name, g.group_no, g.visa_type,
         case when g.covered_from is not null and g.covered_to is not null
              then (g.covered_to - g.covered_from) else null end as total_nights,
         g.pax,
         coalesce(g.invoice_created, false) as invoice_created
  from umrah_groups g
  left join group_companies gc on gc.id = g.group_company_id
  left join b2b_agents a on a.agent_party_id = g.agent_id
  left join parties p on p.id = g.agent_id
  where g.company_id = auth_company_id()
    and coalesce(g.workflow_status,'pending') <> 'rejected'
    and coalesce(g.visa_issued_at::date, g.group_date) between p_from and p_to
  order by coalesce(g.visa_issued_at::date, g.group_date) desc, g.group_no;
$$;
revoke all on function public.visa_invoice_ledger(date, date) from anon;
