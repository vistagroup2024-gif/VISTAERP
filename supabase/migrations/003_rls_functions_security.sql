-- ============================================================
-- VISTA ERP - 003 RLS, helper functions, sequences, triggers
-- ============================================================

create or replace function auth_company_id()
returns uuid language sql stable security definer set search_path = public as $$
  select company_id from profiles where id = auth.uid();
$$;

create or replace function has_role(p_role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles where user_id = auth.uid() and role = p_role);
$$;

create or replace function is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from user_roles
    where user_id = auth.uid()
      and role in ('admin','accounting','hr','sales','purchase','inventory','hotel_ops')
  );
$$;

create or replace function auth_party_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from parties where portal_user_id = auth.uid() limit 1;
$$;

create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

create or replace function next_doc_number(p_company uuid, p_doc_type text)
returns text language plpgsql security definer set search_path = public as $$
declare
  rec doc_sequences%rowtype;
  num text;
begin
  insert into doc_sequences(company_id, doc_type, prefix)
  values (p_company, p_doc_type, upper(left(p_doc_type,3)) || '-')
  on conflict (company_id, doc_type) do nothing;

  update doc_sequences
    set next_number = next_number + 1
    where company_id = p_company and doc_type = p_doc_type
    returning * into rec;

  num := rec.prefix || lpad((rec.next_number - 1)::text, rec.padding, '0');
  return num;
end;
$$;

alter table companies       enable row level security;
alter table branches        enable row level security;
alter table profiles        enable row level security;
alter table user_roles      enable row level security;
alter table currencies      enable row level security;
alter table exchange_rates  enable row level security;
alter table parties         enable row level security;
alter table doc_sequences   enable row level security;
alter table hotels          enable row level security;
alter table room_types      enable row level security;
alter table seasons         enable row level security;
alter table room_rates      enable row level security;
alter table allotments      enable row level security;
alter table packages        enable row level security;
alter table package_items   enable row level security;
alter table bookings        enable row level security;
alter table booking_pax     enable row level security;
alter table booking_items   enable row level security;
alter table invoices        enable row level security;
alter table invoice_lines   enable row level security;

create policy currencies_read on currencies for select to authenticated using (true);

create policy profiles_self_read on profiles for select to authenticated
  using (id = auth.uid() or (is_staff() and company_id = auth_company_id()));
create policy profiles_self_update on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy user_roles_read on user_roles for select to authenticated
  using (user_id = auth.uid() or is_staff());

create policy companies_staff on companies for all to authenticated
  using (id = auth_company_id() and is_staff())
  with check (id = auth_company_id() and is_staff());

create policy branches_staff on branches for all to authenticated
  using (company_id = auth_company_id() and is_staff())
  with check (company_id = auth_company_id() and is_staff());

create policy parties_staff on parties for all to authenticated
  using (company_id = auth_company_id() and is_staff())
  with check (company_id = auth_company_id() and is_staff());

create policy doc_sequences_staff on doc_sequences for all to authenticated
  using (company_id = auth_company_id() and is_staff())
  with check (company_id = auth_company_id() and is_staff());

create policy exchange_rates_staff on exchange_rates for all to authenticated
  using (is_staff()) with check (is_staff());

create policy hotels_staff on hotels for all to authenticated
  using (company_id = auth_company_id() and is_staff())
  with check (company_id = auth_company_id() and is_staff());

create policy seasons_staff on seasons for all to authenticated
  using (company_id = auth_company_id() and is_staff())
  with check (company_id = auth_company_id() and is_staff());

create policy allotments_staff on allotments for all to authenticated
  using (company_id = auth_company_id() and is_staff())
  with check (company_id = auth_company_id() and is_staff());

create policy packages_staff on packages for all to authenticated
  using (company_id = auth_company_id() and is_staff())
  with check (company_id = auth_company_id() and is_staff());

create policy room_types_staff on room_types for all to authenticated
  using (exists (select 1 from hotels h where h.id = hotel_id and h.company_id = auth_company_id()) and is_staff())
  with check (exists (select 1 from hotels h where h.id = hotel_id and h.company_id = auth_company_id()) and is_staff());

create policy room_rates_staff on room_rates for all to authenticated
  using (exists (select 1 from room_types rt join hotels h on h.id = rt.hotel_id
                 where rt.id = room_type_id and h.company_id = auth_company_id()) and is_staff())
  with check (exists (select 1 from room_types rt join hotels h on h.id = rt.hotel_id
                 where rt.id = room_type_id and h.company_id = auth_company_id()) and is_staff());

create policy package_items_staff on package_items for all to authenticated
  using (exists (select 1 from packages p where p.id = package_id and p.company_id = auth_company_id()) and is_staff())
  with check (exists (select 1 from packages p where p.id = package_id and p.company_id = auth_company_id()) and is_staff());

create policy bookings_staff on bookings for all to authenticated
  using (company_id = auth_company_id() and is_staff())
  with check (company_id = auth_company_id() and is_staff());
create policy bookings_agent_read on bookings for select to authenticated
  using (customer_id = auth_party_id());
create policy bookings_agent_insert on bookings for insert to authenticated
  with check (customer_id = auth_party_id() and has_role('b2b_agent'));

create policy booking_pax_access on booking_pax for all to authenticated
  using (exists (select 1 from bookings b where b.id = booking_id
                 and (b.company_id = auth_company_id() and is_staff() or b.customer_id = auth_party_id())))
  with check (exists (select 1 from bookings b where b.id = booking_id
                 and (b.company_id = auth_company_id() and is_staff() or b.customer_id = auth_party_id())));

create policy booking_items_access on booking_items for all to authenticated
  using (exists (select 1 from bookings b where b.id = booking_id
                 and (b.company_id = auth_company_id() and is_staff() or b.customer_id = auth_party_id())))
  with check (exists (select 1 from bookings b where b.id = booking_id
                 and (b.company_id = auth_company_id() and is_staff() or b.customer_id = auth_party_id())));

create policy invoices_staff on invoices for all to authenticated
  using (company_id = auth_company_id() and is_staff())
  with check (company_id = auth_company_id() and is_staff());
create policy invoices_agent_read on invoices for select to authenticated
  using (customer_id = auth_party_id());

create policy invoice_lines_access on invoice_lines for select to authenticated
  using (exists (select 1 from invoices i where i.id = invoice_id
                 and (i.company_id = auth_company_id() and is_staff() or i.customer_id = auth_party_id())));
create policy invoice_lines_staff_write on invoice_lines for all to authenticated
  using (exists (select 1 from invoices i where i.id = invoice_id and i.company_id = auth_company_id() and is_staff()))
  with check (exists (select 1 from invoices i where i.id = invoice_id and i.company_id = auth_company_id() and is_staff()));

create policy packages_agent_read on packages for select to authenticated
  using (status = 'active' and has_role('b2b_agent'));
create policy hotels_agent_read on hotels for select to authenticated
  using (is_active and has_role('b2b_agent'));
create policy room_types_agent_read on room_types for select to authenticated
  using (has_role('b2b_agent'));
create policy package_items_agent_read on package_items for select to authenticated
  using (has_role('b2b_agent'));
