-- The scheduled jobs check the secret themselves, not just their route.
--
-- CRON_SECRET is checked in /api/cron/*, and that check is sound — but the
-- routes call the database through the ORDINARY client, and a scheduler has no
-- Supabase session, so every one of those calls is made as `anon`. The five
-- routines therefore had to be anon-callable, and were, with no gate of their
-- own. The anon key ships in the browser bundle, so anyone holding it could
-- skip the route and call the routine directly:
--
--   car_monthly_run()             generates monthly service charges AND POSTS
--                                 THE JOURNALS, for every company
--   refresh_brn_availability()    writes brn_avail across the Umrah groups
--   generate_hotel_reminders()    \
--   generate_hotel_hcn_reminders()  raise reminder rows
--   generate_tafweej_reminders()  /
--
-- They stay anon-callable — they have to be, there is no service-role key in
-- this project — but each one now takes the secret and refuses without it. That
-- is the shape push_dispatch_targets, push_mark_notified and push_prune have
-- always had; these five were simply never brought into line.
--
-- THE SECRET LIVES IN TWO PLACES AND MUST MATCH: `cron_config.secret` here, and
-- CRON_SECRET in the deployment environment, which the route passes through. Set
-- one without the other and the jobs stop rather than run unprotected — which is
-- the safe way round for them to fail.
--
-- The bodies are not retyped. Each definition is read back, its signature
-- widened and the guard inserted after its own `begin`, then checked: the guard
-- has to be present, the body has to be otherwise unchanged, and the old
-- no-argument version is dropped only once its replacement exists. A `drop` and
-- `create` resets a function's grants, so they are re-stated afterwards rather
-- than assumed — that is the trap migration 293 was written to clean up.

create table if not exists cron_config (
  id boolean primary key default true check (id),
  secret text not null
);
alter table cron_config enable row level security;
-- No policy: unreachable except through the definer routines below, the same
-- way push_config is.

insert into cron_config (id, secret)
values (true, 'jFdzk3yjp_ZHKBDhr1g8WAKKLmrF1J39DmMlvotqbPCM-LE0C-9dgUpQc7GzW3Ki')
on conflict (id) do nothing;

do $$
declare
  r record; v_def text; v_new text; v_old text; v_body_before text; v_body_after text;
  guard constant text :=
    '  if p_secret is null or p_secret <> (select secret from cron_config) then'  || E'\n' ||
    '    raise exception ''Bad cron secret'';'                                    || E'\n' ||
    '  end if;';
begin
  for r in
    select unnest(array['car_monthly_run','refresh_brn_availability',
                        'generate_hotel_reminders','generate_hotel_hcn_reminders',
                        'generate_tafweej_reminders']) as fn
  loop
    -- Only the no-argument version is of interest; a gated one already exists
    -- if this migration has run before.
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn and p.pronargs = 0;
    if v_def is null then
      raise notice '% is already gated (or gone).', r.fn;
      continue;
    end if;

    v_old := 'public.' || r.fn || '()';
    if position(v_old in v_def) = 0 then
      raise exception 'Cannot gate %: its own signature is not where it should be.', r.fn;
    end if;

    -- widen the signature, then put the guard at the top of the body
    v_new := replace(v_def, v_old, 'public.' || r.fn || '(p_secret text)');
    if position(E'\nbegin\n' in v_new) = 0 then
      raise exception 'Cannot gate %: it has no begin line to hang the guard on.', r.fn;
    end if;
    v_new := replace(v_new, E'\nbegin\n', E'\nbegin\n' || guard || E'\n');

    -- the body either side of the guard must be untouched
    v_body_before := substring(v_def from position('AS $function$' in v_def));
    v_body_after  := replace(substring(v_new from position('AS $function$' in v_new)),
                             guard || E'\n', '');
    if v_body_after <> v_body_before then
      raise exception 'Cannot gate %: the body changed by more than its guard.', r.fn;
    end if;

    execute v_new;
    execute format('drop function public.%I()', r.fn);

    -- create/drop resets the grants, so they are said again. anon is deliberate:
    -- the scheduler has no session, and the secret is what stands in front.
    execute format('revoke all on function public.%I(text) from public', r.fn);
    execute format('grant execute on function public.%I(text) to anon, authenticated', r.fn);
    raise notice 'Gated %.', r.fn;
  end loop;
end $$;

-- Supabase grants SELECT on a new public table to anon and authenticated by
-- default. RLS with no policy would already return nothing, but push_config —
-- the table this one is modelled on — has the grant revoked as well, and a
-- secret should not lean on one gate where the neighbour uses two.
revoke all on table cron_config from anon, authenticated;
