-- Found while verifying the Cash & Bank dashboard card's new drill-down: with
-- the Ledger's From date left blank, acct_ledger_multi()'s opening balance
-- included EVERY posted entry ("p_from is null or e.entry_date < p_from" is
-- true for every row once p_from is null) — and the same entry is also a
-- "move" inside the window for the same reason, so it was counted twice.
-- CASH read a closing balance of -19,976 for a single -9,988 posted line.
--
-- With no From date there is no "before the window" — nothing is a prior
-- balance, everything is a move — so opening is 0 rather than everything.
create or replace function public.acct_ledger_multi(
  p_company uuid, p_account_ids uuid[], p_from date default null, p_to date default null,
  p_only_with_balance boolean default false, p_moved_only boolean default false, p_sort text default 'code'
)
returns jsonb
language sql stable security definer set search_path to 'public' as $function$
  with allowed as (
    select case when staff_scope_ids('account') is null then p_account_ids
                else array(select unnest(p_account_ids) intersect select unnest(staff_scope_ids('account')))
           end as ids
  ),
  acct as (
    select a.id, a.code, a.name, a.parent_id,
           (select g.name from accounts g where g.id = a.parent_id) as group_name
    from accounts a
    where a.company_id = p_company
      and a.id in (select unnest(ids) from allowed)
  ),
  -- Everything before the window: the opening balance. With no From date
  -- there is no "before" — nothing is prior, so opening is 0 and every
  -- posted entry falls into moves instead, once and only once.
  opening as (
    select l.account_id, coalesce(sum(l.debit - l.credit), 0) as bal
    from journal_lines l
    join journal_entries e on e.id = l.entry_id
    where e.company_id = p_company and e.status = 'posted'
      and l.account_id in (select id from acct)
      and p_from is not null and e.entry_date < p_from
    group by l.account_id
  ),
  -- Everything inside it, with the other side of each voucher alongside.
  moves as (
    select l.account_id, e.id as entry_id, e.entry_date, e.entry_no, e.reference,
           coalesce(l.description, e.memo) as memo,
           l.tag_area, l.cost_center, l.debit, l.credit, l.created_at,
           (select string_agg(distinct a2.name, ', ')
              from journal_lines o
              join accounts a2 on a2.id = o.account_id
             where o.entry_id = e.id
               and o.account_id <> l.account_id
               -- The opposite side. A receipt's contra is what was credited.
               and ((l.debit > 0 and o.credit > 0) or (l.credit > 0 and o.debit > 0))
           ) as contra
    from journal_lines l
    join journal_entries e on e.id = l.entry_id
    where e.company_id = p_company and e.status = 'posted'
      and l.account_id in (select id from acct)
      and (p_from is null or e.entry_date >= p_from)
      and (p_to   is null or e.entry_date <= p_to)
  ),
  block as (
    select a.id, a.code, a.name, a.group_name,
           coalesce(o.bal, 0) as opening,
           coalesce((select sum(m.debit)  from moves m where m.account_id = a.id), 0) as total_debit,
           coalesce((select sum(m.credit) from moves m where m.account_id = a.id), 0) as total_credit,
           (select count(*) from moves m where m.account_id = a.id) as row_count,
           coalesce((select jsonb_agg(jsonb_build_object(
              'entry_id', m.entry_id, 'date', m.entry_date, 'entry_no', m.entry_no,
              'tag_area', m.tag_area, 'cost_center', m.cost_center,
              'contra', m.contra, 'memo', m.memo, 'reference', m.reference,
              'debit', m.debit, 'credit', m.credit)
              order by m.entry_date, doc_no_seq(m.entry_no), m.entry_no, m.created_at)
             from moves m where m.account_id = a.id), '[]'::jsonb) as rows
    from acct a left join opening o on o.account_id = a.id
  ),
  kept as (
    select * from block b
    where (not p_moved_only or b.row_count > 0)
      and (not p_only_with_balance
           or b.opening <> 0 or b.total_debit <> 0 or b.total_credit <> 0)
  )
  select jsonb_build_object(
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', k.id, 'code', k.code, 'name', k.name, 'group', k.group_name,
        'opening', k.opening, 'total_debit', k.total_debit, 'total_credit', k.total_credit,
        'closing', k.opening + k.total_debit - k.total_credit,
        'rows', k.rows)
        order by
          case when p_sort = 'name' then k.name end,
          case when p_sort = 'balance' then -abs(k.opening + k.total_debit - k.total_credit) end,
          k.code)
      from kept k), '[]'::jsonb),
    'grand_debit',  coalesce((select sum(total_debit)  from kept), 0),
    'grand_credit', coalesce((select sum(total_credit) from kept), 0),
    'accounts_shown', (select count(*) from kept),
    'accounts_asked', (select count(*) from acct)
  );
$function$;

revoke all on function public.acct_ledger_multi(uuid, uuid[], date, date, boolean, boolean, text) from public, anon;
grant execute on function public.acct_ledger_multi(uuid, uuid[], date, date, boolean, boolean, text) to authenticated;

do $chk$
declare
  v_admin uuid := 'edf3fa71-27e2-4cb1-af62-9afd685abefe';
  v_co uuid := '96f6b539-b491-4df7-91a2-80c7c8e7491d';
  v_cash_id uuid;
  v_closing_bounded numeric;
  v_closing_unbounded numeric;
  v_dashboard_balance numeric;
begin
  if not exists (select 1 from profiles where id = v_admin) then
    raise exception 'acct_ledger_multi self-check: reference admin profile not found';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);

  select id into v_cash_id from accounts where company_id = v_co and code = '1-02-01';
  if v_cash_id is null then
    raise exception 'acct_ledger_multi self-check: reference CASH account not found';
  end if;

  select (public.dashboard_metrics()->'cash_bank'->>'balance')::numeric into v_dashboard_balance;

  select (r->'accounts'->0->>'closing')::numeric
    into v_closing_unbounded
    from (select public.acct_ledger_multi(v_co, array[v_cash_id], null, null, false, false, 'code') as r) x;

  select (r->'accounts'->0->>'closing')::numeric
    into v_closing_bounded
    from (select public.acct_ledger_multi(v_co, array[v_cash_id], '2000-01-01'::date, current_date, false, false, 'code') as r) x;

  -- With no From date, the ledger must read the same closing balance as one
  -- bounded from a date safely before every posted entry — that agreement is
  -- the whole point of this fix.
  if abs(v_closing_unbounded - v_closing_bounded) > 0.01 then
    raise exception 'acct_ledger_multi self-check: unbounded closing % does not match bounded closing %',
      v_closing_unbounded, v_closing_bounded;
  end if;

  raise notice 'acct_ledger_multi self-check passed: CASH closing (no From) = %, matches bounded = %, dashboard cash_bank.balance = %',
    v_closing_unbounded, v_closing_bounded, v_dashboard_balance;
end;
$chk$;
