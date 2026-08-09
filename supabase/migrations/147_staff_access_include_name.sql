-- 147 Fold full_name into staff_access() so the ERP layout drops its separate
-- profiles query on every page load (perf).
create or replace function public.staff_access()
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select jsonb_build_object(
    'is_admin', has_role('admin'),
    'full_name', (select full_name from profiles where id = auth.uid()),
    'permissions', coalesce((select permissions from profiles where id = auth.uid()), '{}'::jsonb)
  );
$function$;
