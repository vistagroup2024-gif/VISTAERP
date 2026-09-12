-- Rollback of 359.
--
-- READ THIS BEFORE RUNNING IT. 359 closed two real holes:
--
--   * acct_automation_events / acct_automation_actions had RLS off while anon
--     held INSERT, UPDATE, DELETE and TRUNCATE on them. The anon key ships in
--     the browser bundle, so that was anybody. Those tables decide which events
--     post to the general ledger and to which accounts.
--   * car_post_charges_month was security definer, anon-callable and had no
--     gate of its own. It posts the monthly service-charge journal.
--
-- Undoing this re-opens both. There is no situation in which the ERP needs
-- either — nothing reads the registries except definer routines, and
-- car_post_charges_month has exactly one caller, which is definer. This file
-- exists so the change is reversible, not because reversing it is advisable.
--
-- The search_path pins are left in place: a pinned search_path cannot break
-- anything, and unpinning five pure functions would be undoing a fix for the
-- sake of symmetry.

begin;

alter table public.acct_automation_events  disable row level security;
alter table public.acct_automation_actions disable row level security;
drop policy if exists acct_automation_events_staff  on public.acct_automation_events;
drop policy if exists acct_automation_actions_staff on public.acct_automation_actions;
grant all on public.acct_automation_events  to anon, authenticated;
grant all on public.acct_automation_actions to anon, authenticated;

grant execute on function public.car_post_charges_month(uuid, date) to anon, authenticated;

do $chk$
begin
  if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relname='acct_automation_events' and c.relrowsecurity) <> 0
  then raise exception '359 rollback: RLS is still on acct_automation_events'; end if;
end $chk$;

commit;
