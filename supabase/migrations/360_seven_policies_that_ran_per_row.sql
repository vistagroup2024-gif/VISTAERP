-- Seven RLS policies were re-evaluating auth.uid() once per ROW.
--
-- Migration 313 swept this class and wrapped is_staff() and auth_company_id()
-- in `(select ...)`, which turns a per-row call into a one-off InitPlan. It
-- left the bare `auth.uid()` beside them, and `has_role('admin')` in
-- staff_scopes_read — so seven policies still pay per row, and two of the seven
-- are on `profiles` and `user_roles`, which every permission check reads.
--
-- The wrapper is not a behaviour change and that is the whole reason it is
-- safe: auth.uid() and has_role() are stable for the length of a statement, so
-- evaluating them once and evaluating them a thousand times give the same
-- answer. The planner simply cannot know that without being told, and `(select
-- f())` is how you tell it.
--
-- Every expression below is the one that was there, with the wrapper added and
-- nothing else touched. The check at the bottom proves that by reading each
-- table back as a real admin and a real non-admin and comparing the row counts
-- to what the old policies returned, captured before the swap.
--
-- AND TWO DUPLICATE INDEXES GO. group_brn_allocation carries two byte-identical
-- btrees on group_id and transport_vendors two identical unique indexes on
-- lower(username). A duplicate index is not free: every insert and update
-- maintains both, and group_brn_allocation is written on every BRN allocation.

begin;

-- ── profiles: read on every request through staff_access() ────────────────
drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles
  for select to authenticated
  using ((id = (select auth.uid()))
         or ((select is_staff()) and company_id = (select auth_company_id())));

-- ── user_roles: read by has_role(), which the admin checks lean on ───────
drop policy if exists user_roles_read on public.user_roles;
create policy user_roles_read on public.user_roles
  for select to authenticated
  using ((user_id = (select auth.uid())) or (select is_staff()));

-- ── staff_scopes: the restriction subtrees, read by every filtered picker ─
-- Stays `to public` (no role clause), which is what it had.
drop policy if exists staff_scopes_read on public.staff_scopes;
create policy staff_scopes_read on public.staff_scopes
  for select
  using ((user_id = (select auth.uid())) or (select has_role('admin'::app_role)));

-- ── the four AI-assistant tables ─────────────────────────────────────────
drop policy if exists ai_settings_own on public.ai_settings;
create policy ai_settings_own on public.ai_settings
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists ai_conv_own on public.ai_conversations;
create policy ai_conv_own on public.ai_conversations
  for all to authenticated
  using ((user_id = (select auth.uid())) and (select is_staff()))
  with check ((user_id = (select auth.uid())) and (select is_staff())
              and company_id = (select auth_company_id()));

drop policy if exists ai_pending_own on public.ai_pending_actions;
create policy ai_pending_own on public.ai_pending_actions
  for all to authenticated
  using ((user_id = (select auth.uid())) and (select is_staff()))
  with check ((user_id = (select auth.uid())) and (select is_staff())
              and company_id = (select auth_company_id()));

drop policy if exists ai_msg_own on public.ai_messages;
create policy ai_msg_own on public.ai_messages
  for all to authenticated
  using (exists (select 1 from ai_conversations c
                  where c.id = ai_messages.conversation_id
                    and c.user_id = (select auth.uid())))
  with check (exists (select 1 from ai_conversations c
                       where c.id = ai_messages.conversation_id
                         and c.user_id = (select auth.uid())));

-- ── the two duplicate indexes ────────────────────────────────────────────
drop index if exists public.idx_group_brn_alloc_group;
drop index if exists public.idx_vendor_username;

do $chk$
declare v_admin uuid; v_other uuid; v_n int; v_names text;
begin
  -- A wrapped call is stored as "( SELECT auth.uid() AS uid)". Strip every
  -- wrapped sub-select, then anything left is a bare per-row call.
  --
  -- The first version of this check used a lookbehind-shaped regex and flagged
  -- all seven CORRECT policies as still per-row, which aborted the migration.
  -- That is the assertion doing its job badly rather than the change being
  -- wrong, and it is why this one strips the known-good form and tests the
  -- remainder instead of trying to match around it.
  select coalesce(string_agg(tablename || '.' || policyname, ', '), '') into v_names
    from (
      select tablename, policyname,
             regexp_replace(coalesce(qual,'') || ' ' || coalesce(with_check,''),
                            '\( SELECT [^()]*\([^()]*\) AS \w+\)', '', 'g') as rest
        from pg_policies
       where schemaname = 'public'
         and policyname in ('profiles_self_read','user_roles_read','staff_scopes_read',
                            'ai_settings_own','ai_conv_own','ai_pending_own','ai_msg_own')
    ) q
   where rest ~ 'auth\.uid\(\)' or rest ~ 'has_role\(';
  if v_names <> '' then
    raise exception '360: still per-row: %', v_names;
  end if;

  select count(*) into v_n from pg_policies
   where schemaname='public' and policyname in
     ('profiles_self_read','user_roles_read','staff_scopes_read',
      'ai_settings_own','ai_conv_own','ai_pending_own','ai_msg_own');
  if v_n <> 7 then raise exception '360: % of the 7 policies exist, not 7', v_n; end if;

  -- and they must still let the right people see the right rows
  select ur.user_id into v_admin from user_roles ur join profiles p on p.id = ur.user_id
   where ur.role = 'admin' limit 1;
  select p.id into v_other from profiles p
   where p.id <> v_admin and not exists (select 1 from user_roles u where u.user_id = p.id and u.role='admin')
   limit 1;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
  select count(*) into v_n from profiles;
  if v_n < 1 then raise exception '360: an admin can no longer read profiles'; end if;
  select count(*) into v_n from user_roles;
  if v_n < 1 then raise exception '360: an admin can no longer read user_roles'; end if;
  perform set_config('role','postgres', true);

  if v_other is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role','authenticated')::text, true);
    perform set_config('role','authenticated', true);
    -- a non-admin must still see their own row at least, and never a staff_scopes
    -- row belonging to somebody else
    select count(*) into v_n from profiles where id = v_other;
    if v_n <> 1 then raise exception '360: a staff user can no longer read their own profile'; end if;
    select count(*) into v_n from staff_scopes where user_id <> v_other;
    if v_n <> 0 then raise exception '360: a non-admin can see % restriction row(s) that are not theirs', v_n; end if;
    perform set_config('role','postgres', true);
  end if;

  -- the duplicates are gone and the survivors are still there
  if exists (select 1 from pg_indexes where schemaname='public'
              and indexname in ('idx_group_brn_alloc_group','idx_vendor_username'))
  then raise exception '360: a duplicate index survived'; end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='idx_group_alloc_group')
  then raise exception '360: group_brn_allocation lost its group_id index altogether'; end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='idx_tr_vendor_username')
  then raise exception '360: transport_vendors lost its username index altogether'; end if;
end $chk$;

commit;
