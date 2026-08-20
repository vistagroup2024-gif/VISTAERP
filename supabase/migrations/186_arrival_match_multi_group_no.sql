-- A single transport booking can cover several groups by listing multiple Nusuk group
-- numbers in one field (e.g. "480900663868 , 480900620333"). The arrival-compliance
-- match was exact-equality, so a combined value matched no single group and those
-- groups stayed "pending" in Arrival Service. Now match the group's number against any
-- token of the booking's nusuk_group_no (split on comma/semicolon/slash/whitespace).
create or replace function public.transport_exists_for_group(p_group_no text, p_gc uuid)
returns boolean language sql stable set search_path to 'public' as $function$
  select exists (
    select 1 from transport_bookings b
    where b.nusuk_group_no is not null and p_group_no is not null
      and b.status <> 'cancelled'
      and (p_gc is null or b.group_company_id is null or b.group_company_id = p_gc)
      and exists (
        select 1 from unnest(regexp_split_to_array(b.nusuk_group_no, '[,;/[:space:]]+')) tok
        where btrim(tok) <> '' and btrim(tok) = btrim(p_group_no)
      )
  );
$function$;
