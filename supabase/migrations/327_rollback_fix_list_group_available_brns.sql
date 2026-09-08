-- ROLLBACK for 327_fix_list_group_available_brns.sql.
--
-- Puts the ambiguous reference back, which means ➕ Add BRN manually raises
-- "column reference id is ambiguous" again. There is no reason to run this
-- except to prove the fix was the cause.

create or replace function list_group_available_brns(p_group uuid)
returns table(id uuid, brn text, hotel_name text, city text,
              check_in date, check_out date, beds integer, available integer)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare grp umrah_groups%rowtype;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into grp from umrah_groups where id = p_group;
  if not found then raise exception 'Group not found'; end if;
  return query
    select b.id, b.brn, b.hotel_name, b.city, b.check_in, b.check_out, b.beds,
      (select max(b.beds - coalesce(u.used, 0))
       from generate_series(b.check_in, b.check_out - 1, interval '1 day') d
       left join lateral (
         select sum(c.beds)::int as used from brn_consumption c
         where c.brn_id = b.id and c.check_in <= d::date and c.check_out > d::date
       ) u on true)::int as available
    from brn_inventory b
    where b.company_id = grp.company_id
      and (grp.group_company_id is null or b.group_company_id = grp.group_company_id)
    order by b.city, b.check_in;
end $function$;
