-- The Ledger, for as many accounts as you like, the way a ledger is read.
--
-- acct_ledger has always taken an ARRAY of account ids and has always been
-- called with exactly one, because that is all the screen could ask for. Worse,
-- when it was handed several it summed them into ONE running balance — which is
-- not a ledger of three accounts, it is a ledger of a thing that does not
-- exist.
--
-- This returns a BLOCK PER ACCOUNT, each with its own opening balance, its own
-- rows and its own total, and a grand total under the lot. That is what a
-- printed ledger is.
--
-- TWO COLUMNS THAT WERE MISSING, and both are the reason a ledger is readable
-- at all:
--
--   Account   the OTHER side of the entry. Reading the Driving Licence account,
--             what you want beside each line is "Rajhi Bank" — where the money
--             came from. Every line of the same voucher on the opposite side,
--             joined; a simple two-line voucher gives exactly one name.
--   Tag Area  carried on the journal line, and one of the two things a voucher
--             is analysed by. It was already stored and never shown.
--
-- The options are the ones that change what comes back rather than how it looks
-- — anything purely visual is the screen's business, not a round trip:
--
--   p_only_with_balance   drop accounts that neither opened with anything nor
--                         moved. On a 177-account chart this is the difference
--                         between a report and a phone book.
--   p_moved_only          drop accounts that did not MOVE in the period, even
--                         if they carry an opening balance.
--   p_sort                'code' (default), 'name', or 'balance' (largest
--                         closing balance first).
--
-- security definer, like acct_ledger, and it applies the same restriction:
-- staff_scope_ids('account') intersects the requested list, so a restricted
-- user asking for an account they may not see gets nothing back for it rather
-- than an error that tells them it exists.

create or replace function acct_ledger_multi(
  p_company uuid,
  p_account_ids uuid[],
  p_from date default null,
  p_to date default null,
  p_only_with_balance boolean default false,
  p_moved_only boolean default false,
  p_sort text default 'code')
returns jsonb language sql stable security definer set search_path to 'public'
as $function$
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
  -- Everything before the window: the opening balance.
  opening as (
    select l.account_id, coalesce(sum(l.debit - l.credit), 0) as bal
    from journal_lines l
    join journal_entries e on e.id = l.entry_id
    where e.company_id = p_company and e.status = 'posted'
      and l.account_id in (select id from acct)
      and (p_from is null or e.entry_date < p_from)
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

revoke all on function acct_ledger_multi(uuid, uuid[], date, date, boolean, boolean, text) from public, anon;
grant execute on function acct_ledger_multi(uuid, uuid[], date, date, boolean, boolean, text) to authenticated;
