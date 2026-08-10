-- 161 Backfill transport_vehicles.upgrade_rank where NULL.
--
-- The vendor-list filter (Assign Vendor) and the auto-assign ladder both rank
-- vehicles by upgrade_rank (Camry=1, Starex=2, Staria=3, Luxury Staria=4; larger
-- coaches above). A NULL rank breaks this: a vendor whose vehicles are all
-- unranked is treated as rank 0 and silently hidden for any ranked booking.
--
-- This fills ONLY rows where upgrade_rank IS NULL — manually-set ranks are kept.
-- The documented ladder is mapped by name; any remaining (larger) vehicle is
-- ranked above by seating capacity so a bigger vehicle is always a valid upgrade
-- and no NULL survives.
--
-- NOTE: run this against the DB (Supabase SQL editor or MCP). Re-runnable / idempotent.

update transport_vehicles v set upgrade_rank = m.rank
from (
  select id,
    case
      when name ilike '%luxury%staria%' or name ilike '%vip%' then 4
      when name ilike '%staria%' then 3
      when name ilike '%starex%' or name ilike '%h-1%' or name ilike '%h1%' then 2
      when name ilike '%camry%' or name ilike '%sonata%' or name ilike '%sedan%' then 1
      else null
    end as rank
  from transport_vehicles
) m
where v.id = m.id and v.upgrade_rank is null and m.rank is not null;

update transport_vehicles v set upgrade_rank = 4 + d.r
from (
  select id, dense_rank() over (order by coalesce(seating_capacity,0)) as r
  from transport_vehicles where upgrade_rank is null
) d
where v.id = d.id and v.upgrade_rank is null;
