-- ============================================================
-- VISTA ERP - 022 Group Companies master
-- Selectable company names for the visa group form (Settings > Companies).
-- (Applied to remote DB via Supabase MCP; kept here for history.)
-- ============================================================

create table if not exists group_companies (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  name        text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists idx_group_companies_company on group_companies(company_id);
alter table group_companies enable row level security;
create policy group_companies_staff on group_companies for all to authenticated
  using (company_id = auth_company_id() and is_staff())
  with check (company_id = auth_company_id() and is_staff());

alter table umrah_groups add column if not exists group_company_id uuid references group_companies(id) on delete set null;

insert into group_companies(company_id, name)
select id, name from companies
where not exists (select 1 from group_companies gc where gc.company_id = companies.id);

create or replace function delete_group_company(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c group_companies%rowtype;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into c from group_companies where id = p_id;
  if not found then raise exception 'Company not found'; end if;
  if exists (select 1 from umrah_groups where group_company_id = p_id) then
    raise exception 'Cannot delete: this company is used by one or more visa groups.';
  end if;
  delete from group_companies where id = p_id;
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (c.company_id, auth.uid(), 'group_company_deleted', 'group_companies', p_id, jsonb_build_object('name', c.name));
end $$;
revoke all on function delete_group_company(uuid) from anon, public;
grant execute on function delete_group_company(uuid) to authenticated;
