-- Assignment confirmation gate. Auto-assign and manual assign now produce PROPOSED
-- assignments (assignment_confirmed=false) that agents/drivers can't see until staff
-- click "Confirm Assignments". Includes:
--   * transport_trips.assignment_confirmed column (+ backfill of existing assignments)
--   * transport_auto_assign / transport_assign_trip set assignment_confirmed
--   * transport_confirm_assignments(date) publishes + notifies affected agents
--   * transport_assign_trip notifies the agent when a PUBLISHED trip's driver changes
--   * b2b_transport_schedule hides driver details (reports "pending") until confirmed
-- Column DDL kept here; function bodies applied via migrations 197 / 197b / 197c.
alter table transport_trips add column if not exists assignment_confirmed boolean not null default false;
update transport_trips set assignment_confirmed = true
where assignment_confirmed = false
  and (driver_id is not null or vendor_id is not null
       or status in ('assigned','on_route','picked_up','completed','outsourced'));
