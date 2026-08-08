-- 144 Fix processed groups showing raw "Process" instead of Ready to Allocate /
-- Ready to Allocate (partial) / Waiting BRN. Cause: brn_availability_map() runs the
-- ~7s nested planner live and intermittently exceeded the authenticated role's 8s
-- statement timeout, so the map came back null and every process group fell back to
-- "Process". Fix: cache readiness on umrah_groups.brn_avail — read it on the page
-- (instant), seed it when a group is processed, and bulk-refresh off the request path.
alter table umrah_groups add column if not exists brn_avail text;

create or replace function public.refresh_brn_availability()
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  update umrah_groups g set brn_avail = brn_availability(g.id)
  where coalesce(g.workflow_status,'pending') = 'process' and coalesce(g.visa_type,'normal') <> 'long_stay';
  update umrah_groups set brn_avail = null
  where brn_avail is not null
    and (coalesce(workflow_status,'pending') <> 'process' or coalesce(visa_type,'normal') = 'long_stay');
end $function$;
alter function public.refresh_brn_availability() set statement_timeout = '120s';
grant execute on function public.refresh_brn_availability() to authenticated, service_role;

-- set_group_decision now seeds the processed group's brn_avail immediately (one group).
-- (Full body applied via MCP; adds brn_avail update to the existing function.)

select public.refresh_brn_availability();
