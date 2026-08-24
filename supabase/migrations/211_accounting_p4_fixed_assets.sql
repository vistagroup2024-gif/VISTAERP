-- ============================================================
-- VISTA ERP — Accounting rebuild, PHASE 4 (part 3)
-- Fixed-asset register + straight-line depreciation run.
-- ============================================================

-- Depreciation expense + accumulated-depreciation (contra-asset) accounts.
select acct_seed_node('96f6b539-b491-4df7-91a2-80c7c8e7491d','5-06','Depreciation','expense','5',false,'Indirect Expense');
select acct_seed_node('96f6b539-b491-4df7-91a2-80c7c8e7491d','1-01-09','Accumulated Depreciation','asset','1-01',false,'Accumulated Depreciation');
select acct_rebuild_paths('96f6b539-b491-4df7-91a2-80c7c8e7491d');

create table if not exists fixed_assets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  asset_account_id uuid references accounts(id),   -- the asset ledger account
  cost numeric(18,2) not null,
  salvage numeric(18,2) not null default 0,
  purchase_date date not null,
  life_months int not null default 60,
  method text not null default 'straight_line',
  accumulated numeric(18,2) not null default 0,
  depreciated_to date,                              -- last period depreciated (month end)
  status text not null default 'active',            -- active / disposed
  created_at timestamptz not null default now()
);
alter table fixed_assets enable row level security;
drop policy if exists fixed_assets_staff on fixed_assets;
create policy fixed_assets_staff on fixed_assets for all to authenticated
  using (company_id = auth_company_id() and is_staff()) with check (company_id = auth_company_id() and is_staff());

create or replace function fa_monthly(p_asset fixed_assets) returns numeric
language sql immutable as $$
  select round(greatest(p_asset.cost - p_asset.salvage, 0) / greatest(p_asset.life_months, 1), 2);
$$;

-- Post one month of straight-line depreciation for every asset not yet depreciated for
-- the given period (month end). Dr Depreciation (5-06), Cr Accumulated Depreciation.
create or replace function depreciation_run(p_company uuid, p_period date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a fixed_assets%rowtype; v_dep uuid; v_acc uuid; m numeric(18,2); n int := 0; total numeric(18,2) := 0; v jsonb;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select id into v_dep from accounts where company_id = p_company and code = '5-06';
  select id into v_acc from accounts where company_id = p_company and code = '1-01-09';
  if v_dep is null or v_acc is null then raise exception 'Depreciation accounts missing'; end if;

  for a in select * from fixed_assets where company_id = p_company and status = 'active'
      and purchase_date <= p_period and (depreciated_to is null or depreciated_to < p_period)
  loop
    m := fa_monthly(a);
    if a.accumulated + m > a.cost - a.salvage then m := a.cost - a.salvage - a.accumulated; end if;
    if m <= 0 then continue; end if;
    v := gl_post(p_company, p_period, 'Depreciation — '||a.name, 'gl_journal', 'depreciation', a.name,
      jsonb_build_array(
        jsonb_build_object('account_id', v_dep::text, 'debit', m, 'credit', 0, 'description', 'Depreciation '||a.name),
        jsonb_build_object('account_id', v_acc::text, 'debit', 0, 'credit', m, 'description', 'Accum. dep '||a.name)));
    update fixed_assets set accumulated = accumulated + m, depreciated_to = p_period where id = a.id;
    n := n + 1; total := total + m;
  end loop;
  perform acct_log(p_company, 'depreciation_run', 'gl_journal', to_char(p_period,'YYYY-MM'), jsonb_build_object('assets', n, 'total', total));
  return jsonb_build_object('assets', n, 'total', total);
end $$;

grant execute on function depreciation_run(uuid,date) to authenticated;
