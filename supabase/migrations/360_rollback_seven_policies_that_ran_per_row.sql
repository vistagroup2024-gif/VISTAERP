-- Rollback of 360: puts the seven policies back to evaluating auth.uid() once
-- per row, and re-creates the two duplicate indexes.
--
-- There is no reason to run this. The `(select ...)` wrapper is not a behaviour
-- change — auth.uid() and has_role() are stable for the length of a statement,
-- so evaluating them once and evaluating them per row give the same answer,
-- which is why 360 could prove itself by reading the tables back as a real
-- admin and a real non-admin. Undoing it only makes every filtered read slower.
--
-- It exists so the change is reversible. The expressions below are the ones
-- 360 replaced, exactly as pg_policies reported them beforehand.

begin;

drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles
  for select to authenticated
  using ((id = auth.uid())
         or ((select is_staff()) and company_id = (select auth_company_id())));

drop policy if exists user_roles_read on public.user_roles;
create policy user_roles_read on public.user_roles
  for select to authenticated
  using ((user_id = auth.uid()) or (select is_staff()));

drop policy if exists staff_scopes_read on public.staff_scopes;
create policy staff_scopes_read on public.staff_scopes
  for select
  using ((user_id = auth.uid()) or has_role('admin'::app_role));

drop policy if exists ai_settings_own on public.ai_settings;
create policy ai_settings_own on public.ai_settings
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists ai_conv_own on public.ai_conversations;
create policy ai_conv_own on public.ai_conversations
  for all to authenticated
  using ((user_id = auth.uid()) and (select is_staff()))
  with check ((user_id = auth.uid()) and (select is_staff())
              and company_id = (select auth_company_id()));

drop policy if exists ai_pending_own on public.ai_pending_actions;
create policy ai_pending_own on public.ai_pending_actions
  for all to authenticated
  using ((user_id = auth.uid()) and (select is_staff()))
  with check ((user_id = auth.uid()) and (select is_staff())
              and company_id = (select auth_company_id()));

drop policy if exists ai_msg_own on public.ai_messages;
create policy ai_msg_own on public.ai_messages
  for all to authenticated
  using (exists (select 1 from ai_conversations c
                  where c.id = ai_messages.conversation_id and c.user_id = auth.uid()))
  with check (exists (select 1 from ai_conversations c
                       where c.id = ai_messages.conversation_id and c.user_id = auth.uid()));

create index if not exists idx_group_brn_alloc_group on public.group_brn_allocation (group_id);
create unique index if not exists idx_vendor_username
  on public.transport_vendors (lower(username)) where (username is not null);

do $chk$
declare v_n int;
begin
  select count(*) into v_n from pg_policies
   where schemaname='public' and policyname in
     ('profiles_self_read','user_roles_read','staff_scopes_read',
      'ai_settings_own','ai_conv_own','ai_pending_own','ai_msg_own');
  if v_n <> 7 then raise exception '360 rollback: % of the 7 policies exist, not 7', v_n; end if;
end $chk$;

commit;
