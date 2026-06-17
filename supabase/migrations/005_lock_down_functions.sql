-- Tighten EXECUTE grants on SECURITY DEFINER functions.
-- handle_new_user is a trigger only: no role should call it via the API.
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- Auth/RLS helpers and the sequence generator: not needed by anon.
revoke all on function public.auth_company_id() from anon;
revoke all on function public.auth_party_id() from anon;
revoke all on function public.is_staff() from anon;
revoke all on function public.has_role(public.app_role) from anon;
revoke all on function public.next_doc_number(uuid, text) from anon;

-- The app calls next_doc_number and the helpers as an authenticated user;
-- keep authenticated EXECUTE on those (used by booking/invoice numbering).
grant execute on function public.next_doc_number(uuid, text) to authenticated;
grant execute on function public.auth_company_id() to authenticated;
grant execute on function public.auth_party_id() to authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.has_role(public.app_role) to authenticated;
