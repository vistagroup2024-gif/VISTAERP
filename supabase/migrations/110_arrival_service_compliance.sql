-- ============================================================
-- VISTA ERP - 110 Arrival service compliance
-- Every Visa Group using Vista's visa must reach arrival via Transport (a booking)
-- OR Tafweej (a Vista tafweej record). arrival_service = declared choice; completion
-- is derived (transport_exists_for_group / arrival_tafweej_at). arrival_compliance()
-- feeds the admin dashboard widget. (Applied via Supabase MCP; kept for history.)
-- ============================================================
alter table umrah_groups add column if not exists arrival_service text;
alter table umrah_groups add column if not exists arrival_tafweej_at timestamptz;
alter table umrah_groups add column if not exists arrival_tafweej_by uuid;

create or replace function public.transport_exists_for_group(p_group_no text, p_gc uuid)
returns boolean language sql stable set search_path to 'public' as $$
  select exists (
    select 1 from transport_bookings b
    where b.nusuk_group_no is not null and p_group_no is not null
      and b.nusuk_group_no = p_group_no
      and (p_gc is null or b.group_company_id is null or b.group_company_id = p_gc)
      and b.status <> 'cancelled');
$$;

create or replace function public.arrival_service_state(p_group uuid)
returns text language sql stable set search_path to 'public' as $$
  select case
    when g.arrival_tafweej_at is not null then 'tafweej'
    when transport_exists_for_group(g.group_no, g.group_company_id) then 'transport'
    else 'pending' end
  from umrah_groups g where g.id = p_group;
$$;

create or replace function public.set_group_arrival_service(p_group uuid, p_option text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if p_option is not null and p_option not in ('transport','tafweej') then raise exception 'Invalid option'; end if;
  update umrah_groups set arrival_service = p_option where id = p_group and company_id = auth_company_id();
  if not found then raise exception 'Group not found'; end if;
end $$;

create or replace function public.mark_group_tafweej(p_group uuid, p_done boolean default true)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  update umrah_groups set
    arrival_tafweej_at = case when p_done then now() else null end,
    arrival_tafweej_by = case when p_done then auth.uid() else null end,
    arrival_service = case when p_done then 'tafweej' else arrival_service end
  where id = p_group and company_id = auth_company_id();
  if not found then raise exception 'Group not found'; end if;
end $$;

create or replace function public.arrival_compliance(p_days int default 30)
returns table(id uuid, group_no text, arrival_date date, pax int, agency text,
              arrival_service text, days_to_arrival int)
language sql stable security definer set search_path to 'public' as $$
  select g.id, g.group_no, g.arrival_date, g.pax,
         coalesce(a.agency_name, p.name) as agency, g.arrival_service,
         (g.arrival_date - current_date) as days_to_arrival
  from umrah_groups g
  left join b2b_agents a on a.agent_party_id = g.agent_id
  left join parties p on p.id = g.agent_id
  where g.company_id = auth_company_id()
    and coalesce(g.workflow_status,'pending') <> 'rejected'
    and g.arrival_date is not null and g.arrival_date >= current_date
    and g.arrival_date <= current_date + p_days
    and arrival_service_state(g.id) = 'pending'
  order by g.arrival_date;
$$;
revoke all on function public.arrival_compliance(int) from anon;
