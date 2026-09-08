-- Add BRN manually: "column reference id is ambiguous".
--
-- Clicking ➕ Add BRN manually on a group failed instantly, before the panel
-- could even list anything.
--
-- list_group_available_brns is declared RETURNS TABLE(id uuid, brn text, …),
-- and in plpgsql those output names are VARIABLES in scope for the whole body.
-- Its very first statement is the group lookup:
--
--     select * into grp from umrah_groups where id = p_group;
--                                              ^^ unqualified
--
-- `id` there matches both the OUT variable and umrah_groups.id, so Postgres
-- refuses it rather than guessing. Nothing to do with BRNs: the function never
-- reached the availability query at all, which is why the error arrived the
-- moment the button was pressed.
--
-- Qualifying it is the whole fix. The BRN query below was already qualified
-- throughout and is unchanged — reprinted only because a function body cannot
-- be edited in place.
--
-- Checked the rest of the schema for the same trap (every plpgsql routine whose
-- RETURNS TABLE declares a name it then uses unqualified): this was the only
-- one.

create or replace function list_group_available_brns(p_group uuid)
returns table(id uuid, brn text, hotel_name text, city text,
              check_in date, check_out date, beds integer, available integer)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare grp umrah_groups%rowtype;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  -- Qualified: `id` on its own is also this function's first OUT parameter.
  select * into grp from umrah_groups g where g.id = p_group;
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

revoke all on function list_group_available_brns(uuid) from public, anon;
grant execute on function list_group_available_brns(uuid) to authenticated;
