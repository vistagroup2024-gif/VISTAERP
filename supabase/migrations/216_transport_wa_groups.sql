-- WhatsApp group links for Transport Operations "Send" actions. Mirror of applied migration.
create table if not exists transport_wa_config (
  company_id uuid primary key references companies(id) on delete cascade,
  driver_group_url text
);
alter table transport_wa_config enable row level security;
drop policy if exists twa_staff on transport_wa_config;
create policy twa_staff on transport_wa_config for all to authenticated
  using (company_id = auth_company_id() and is_staff()) with check (company_id = auth_company_id() and is_staff());
alter table b2b_agents add column if not exists wa_group_url text;
