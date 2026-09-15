-- 398 — Ledger layouts: which of the optional columns show, in what order,
-- and which of the four report options come with them, saved by name so a
-- layout is picked once rather than rebuilt every time. The old software's
-- "Configure" screen did the same thing; this is that, minus reordering —
-- a fixed column order with some columns shown and some not covers what was
-- actually asked for ("create a layout and see it with different layouts")
-- without a drag-and-drop editor nobody asked for.
--
-- Personal, not shared: like a saved search, a layout is the shape one person
-- wants the ledger read in, not a company standard everyone must use.

create table if not exists ledger_layouts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default auth_company_id() references companies(id) on delete cascade,
  created_by uuid not null default auth.uid(),
  name text not null,
  -- The optional columns, in the order they should appear. Date, Debit,
  -- Credit and Balance are the backbone of a ledger and are never optional,
  -- so they are not listed here — they are always drawn, in that order,
  -- around whatever this carries.
  columns jsonb not null default '["voucher","tag_area","account","remarks"]'::jsonb,
  only_balance boolean not null default true,
  moved_only boolean not null default false,
  page_break boolean not null default false,
  show_index boolean not null default false,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, created_by, name)
);
alter table ledger_layouts enable row level security;
drop policy if exists ledger_layouts_own on ledger_layouts;
create policy ledger_layouts_own on ledger_layouts for all to authenticated
  using (company_id = auth_company_id() and created_by = auth.uid() and is_staff())
  with check (company_id = auth_company_id() and created_by = auth.uid() and is_staff());

-- ── list: the caller's own layouts for this company, default first ─────────
create or replace function public.ledger_layouts_list()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', l.id, 'name', l.name, 'columns', l.columns,
    'only_balance', l.only_balance, 'moved_only', l.moved_only,
    'page_break', l.page_break, 'show_index', l.show_index, 'is_default', l.is_default)
    order by l.is_default desc, l.name), '[]'::jsonb)
  from ledger_layouts l
  where l.company_id = auth_company_id() and l.created_by = auth.uid() and is_staff();
$function$;
revoke all on function public.ledger_layouts_list() from public, anon;
grant execute on function public.ledger_layouts_list() to authenticated;

-- ── save: create or update one of the caller's own layouts ─────────────────
create or replace function public.ledger_layout_save(
  p_id uuid, p_name text, p_columns jsonb,
  p_only_balance boolean, p_moved_only boolean, p_page_break boolean, p_show_index boolean,
  p_is_default boolean default false)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_co uuid := auth_company_id(); v_id uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'Name the layout first'; end if;

  -- Only one default per user — clear any other before this one can claim it.
  if p_is_default then
    update ledger_layouts set is_default = false
     where company_id = v_co and created_by = auth.uid() and is_default and id is distinct from p_id;
  end if;

  if p_id is not null then
    update ledger_layouts set
      name = p_name, columns = coalesce(p_columns, columns),
      only_balance = p_only_balance, moved_only = p_moved_only,
      page_break = p_page_break, show_index = p_show_index,
      is_default = p_is_default, updated_at = now()
    where id = p_id and company_id = v_co and created_by = auth.uid()
    returning id into v_id;
    if v_id is null then raise exception 'Layout not found'; end if;
    return v_id;
  end if;

  insert into ledger_layouts(company_id, created_by, name, columns, only_balance, moved_only, page_break, show_index, is_default)
  values (v_co, auth.uid(), p_name, coalesce(p_columns, '["voucher","tag_area","account","remarks"]'::jsonb),
          p_only_balance, p_moved_only, p_page_break, p_show_index, p_is_default)
  on conflict (company_id, created_by, name) do update set
    columns = excluded.columns, only_balance = excluded.only_balance, moved_only = excluded.moved_only,
    page_break = excluded.page_break, show_index = excluded.show_index, is_default = excluded.is_default,
    updated_at = now()
  returning id into v_id;
  return v_id;
end $function$;
revoke all on function public.ledger_layout_save(uuid, text, jsonb, boolean, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.ledger_layout_save(uuid, text, jsonb, boolean, boolean, boolean, boolean, boolean) to authenticated;

-- ── delete: one of the caller's own layouts ─────────────────────────────────
create or replace function public.ledger_layout_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  delete from ledger_layouts where id = p_id and company_id = auth_company_id() and created_by = auth.uid();
end $function$;
revoke all on function public.ledger_layout_delete(uuid) from public, anon;
grant execute on function public.ledger_layout_delete(uuid) to authenticated;

do $chk$
declare v_auth boolean; v_anon boolean;
begin
  select has_function_privilege('authenticated', 'public.ledger_layouts_list()', 'execute'),
         has_function_privilege('anon', 'public.ledger_layouts_list()', 'execute') into v_auth, v_anon;
  if not v_auth or v_anon then raise exception 'ledger_layouts_list grants wrong: auth=%, anon=%', v_auth, v_anon; end if;

  select has_function_privilege('authenticated', 'public.ledger_layout_save(uuid,text,jsonb,boolean,boolean,boolean,boolean,boolean)', 'execute'),
         has_function_privilege('anon', 'public.ledger_layout_save(uuid,text,jsonb,boolean,boolean,boolean,boolean,boolean)', 'execute') into v_auth, v_anon;
  if not v_auth or v_anon then raise exception 'ledger_layout_save grants wrong: auth=%, anon=%', v_auth, v_anon; end if;

  select has_function_privilege('authenticated', 'public.ledger_layout_delete(uuid)', 'execute'),
         has_function_privilege('anon', 'public.ledger_layout_delete(uuid)', 'execute') into v_auth, v_anon;
  if not v_auth or v_anon then raise exception 'ledger_layout_delete grants wrong: auth=%, anon=%', v_auth, v_anon; end if;

  if not exists (select 1 from information_schema.tables where table_schema='public' and table_name='ledger_layouts') then
    raise exception 'ledger_layouts table missing';
  end if;
end $chk$;
