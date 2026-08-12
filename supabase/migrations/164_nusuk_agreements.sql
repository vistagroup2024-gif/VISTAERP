-- 164 Nusuk Agreements (hotel module).
--
-- Every hotel booking needs a Nusuk agreement with the hotel. Workflow per booking:
--   pending  → Create Agreement → 'sent' (sent to hotel)
--            → Add Agreement Details → 'completed'
-- On completion the agreed beds become a BRN in inventory (via add_brn) so visa
-- groups can consume them. beds purchased = BRN bed quantity.
--
-- NOTE: run this against the DB (Supabase SQL editor or MCP).

create table if not exists nusuk_agreements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default auth_company_id() references companies(id) on delete cascade,
  booking_id uuid not null references hotel_bookings(id) on delete cascade,
  status text not null default 'sent',            -- sent | completed
  agreement_no text, hotel_name text, city text,
  check_in date, check_out date, beds integer,
  group_company_id uuid references group_companies(id) on delete set null,
  brn_id uuid references brn_inventory(id) on delete set null,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  sent_at timestamptz default now(), completed_at timestamptz,
  unique (booking_id)
);
alter table nusuk_agreements enable row level security;
drop policy if exists nusuk_agreements_staff on nusuk_agreements;
create policy nusuk_agreements_staff on nusuk_agreements for all to authenticated
  using (company_id = auth_company_id() and is_staff())
  with check (company_id = auth_company_id() and is_staff());

-- List: every hotel booking with its agreement status.
create or replace function public.nusuk_agreement_list()
returns table(
  booking_id uuid, booking_no text, guest_name text, hotel text, city text,
  check_in date, check_out date, beds int, status text, agreement_no text,
  group_company_id uuid, group_company text, brn_id uuid
) language sql stable security definer set search_path to 'public' as $$
  select b.id, b.booking_no, b.guest_name,
         coalesce(h.name, b.hotel_name) as hotel, b.city,
         coalesce(na.check_in, b.check_in) as check_in,
         coalesce(na.check_out, b.check_out) as check_out,
         coalesce(na.beds, b.guests) as beds,
         coalesce(na.status, 'pending') as status,
         na.agreement_no, na.group_company_id, gc.name as group_company, na.brn_id
  from hotel_bookings b
  left join hotels h on h.id = b.hotel_id
  left join nusuk_agreements na on na.booking_id = b.id
  left join group_companies gc on gc.id = na.group_company_id
  where b.company_id = auth_company_id()
  order by b.created_at desc;
$$;
revoke all on function public.nusuk_agreement_list() from anon;

-- Step 1: create the agreement (sent to hotel).
create or replace function public.nusuk_agreement_create(p_booking uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  insert into nusuk_agreements(company_id, booking_id, status, sent_at)
  values (auth_company_id(), p_booking, 'sent', now())
  on conflict (booking_id) do update set status = 'sent', sent_at = now()
  where nusuk_agreements.status = 'pending' or nusuk_agreements.status is null;
end $$;
revoke all on function public.nusuk_agreement_create(uuid) from anon;

-- Step 2: add agreement details, complete, and create the BRN.
create or replace function public.nusuk_agreement_complete(
  p_booking uuid, p_agreement_no text, p_hotel_name text, p_city text,
  p_check_in date, p_check_out date, p_beds int, p_group_company uuid
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_brn uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if p_group_company is null then raise exception 'Company is required'; end if;
  if coalesce(p_beds,0) <= 0 then raise exception 'Beds must be greater than zero'; end if;
  -- Create the BRN exactly like a manual add (uses the agreement no as the BRN ref).
  v_brn := add_brn(p_group_company, p_hotel_name, p_agreement_no, p_city, p_check_in, p_check_out, p_beds);
  insert into nusuk_agreements(company_id, booking_id, status, agreement_no, hotel_name, city,
                               check_in, check_out, beds, group_company_id, brn_id, completed_at)
  values (auth_company_id(), p_booking, 'completed', p_agreement_no, p_hotel_name, p_city,
          p_check_in, p_check_out, p_beds, p_group_company, v_brn, now())
  on conflict (booking_id) do update set
    status = 'completed', agreement_no = excluded.agreement_no, hotel_name = excluded.hotel_name,
    city = excluded.city, check_in = excluded.check_in, check_out = excluded.check_out,
    beds = excluded.beds, group_company_id = excluded.group_company_id, brn_id = excluded.brn_id,
    completed_at = now();
  return v_brn;
end $$;
revoke all on function public.nusuk_agreement_complete(uuid, text, text, text, date, date, int, uuid) from anon;
