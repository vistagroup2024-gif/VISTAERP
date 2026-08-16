-- Nusuk agreements should only surface bookings whose vendor purchase is confirmed
-- (vendor_confirmed onwards), or that already have a nusuk agreement started.
CREATE OR REPLACE FUNCTION public.nusuk_agreement_list()
 RETURNS TABLE(booking_id uuid, booking_no text, guest_name text, hotel text, city text, check_in date, check_out date, beds integer, status text, agreement_no text, group_company_id uuid, group_company text, brn_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    and b.status <> 'cancelled'
    and (
      na.id is not null
      or exists (
        select 1 from hotel_purchase_bookings p
        where p.booking_id = b.id
          and p.vendor_status in ('vendor_confirmed','hcn_pending','hcn_received')
      )
    )
  order by b.created_at desc;
$function$;
