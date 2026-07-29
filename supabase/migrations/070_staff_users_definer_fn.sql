-- 070_staff_users_definer_fn
-- Replace the staff_users VIEW (which joined auth.users and tripped the
-- security_definer_view / auth_users_exposed advisors) with a guarded
-- SECURITY DEFINER function, matching the pattern used throughout the app.
-- The function is company-scoped and staff-gated, so auth.users is never
-- reachable by anon/authenticated through PostgREST — only via this RPC, and
-- execution is granted to authenticated only (not anon/PUBLIC).

drop view if exists public.staff_users;

create or replace function public.staff_users_list(p_id uuid default null)
returns table (
  id uuid,
  full_name text,
  is_active boolean,
  company_id uuid,
  created_at timestamptz,
  username text,
  email text,
  phone text,
  department text,
  designation text,
  permissions jsonb
)
language sql
security definer
set search_path to 'public'
as $$
  select p.id,
         p.full_name,
         p.is_active,
         p.company_id,
         p.created_at,
         replace(u.email::text, '@vista.local'::text, ''::text) as username,
         p.email,
         p.phone,
         p.department,
         p.designation,
         p.permissions
  from public.profiles p
  join auth.users u on u.id = p.id
  where is_staff()
    and p.company_id = auth_company_id()
    and (p_id is null or p.id = p_id)
  order by p.created_at;
$$;

revoke all on function public.staff_users_list(uuid) from public, anon;
grant execute on function public.staff_users_list(uuid) to authenticated;
