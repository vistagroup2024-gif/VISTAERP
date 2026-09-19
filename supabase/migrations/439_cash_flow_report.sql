-- The Cash Flow dashboard card used to open the Ledger filtered to Cash/Bank
-- accounts, which read as "just show me the whole ledger" once you clicked
-- through it — this is the real report that belongs there instead.
--
-- report_cash_flow() answers three things a professional cash flow report
-- always carries: where the cash balance came from and went to this period
-- (a direct-method statement split into Operating/Investing/Financing,
-- exactly the shape QuickBooks/Xero/SAP show), a monthly in/out/net trend,
-- and a short-term forecast of what is already committed to arrive or leave
-- (open receivables/payables bucketed by due date, the same due/overdue/
-- next-30/later shape ar_ap_aging and the car customer report already use,
-- so it never disagrees with those on what "due" means).
--
-- Cash/bank accounts are identified the SAME way report_cash_bank() already
-- does — by chart-of-accounts path under the 1-02 (Cash) and 1-03 (Bank)
-- groups, not by subtype — so this report's balance can never drift from
-- what the Cash & Bank card/report already shows for the same date; the
-- migration's own rehearsal cross-checked both.
--
-- The categorised split (direct method) works by looking, for every posted
-- entry that touches a cash/bank account within the period, at that same
-- entry's OTHER (non-cash) lines and summing (credit - debit) per category.
-- Double-entry guarantees this sums exactly to the period's net cash
-- movement — nothing is estimated or apportioned. A transfer between two of
-- the company's own cash/bank accounts (a Contra voucher) has no non-cash
-- line at all, so it is correctly excluded rather than double-counted as
-- both an inflow and an outflow.
create or replace function public.report_cash_flow(p_company uuid, p_from date, p_to date)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  with
    cash_grp as (select path from accounts where company_id = p_company and code = '1-02'),
    bank_grp as (select path from accounts where company_id = p_company and code = '1-03'),
    cash_bank_accts as (
      select a.id from accounts a
      where a.company_id = p_company and a.is_postable
        and (a.path like (select path from cash_grp) || '/%' or a.path like (select path from bank_grp) || '/%')
    ),
    acct_opening as (
      select coalesce(sum(a.opening_balance * case when a.opening_is_debit then 1 else -1 end), 0) as v
      from accounts a where a.id in (select id from cash_bank_accts)
    ),
    movements as (
      select e.entry_date, l.debit, l.credit
      from journal_lines l join journal_entries e on e.id = l.entry_id
      where e.company_id = p_company and e.status = 'posted' and l.account_id in (select id from cash_bank_accts)
    ),
    bal_before_from as (
      select (select v from acct_opening) + coalesce(sum(debit - credit) filter (where entry_date < p_from), 0) as v from movements
    ),
    bal_asof_to as (
      select (select v from acct_opening) + coalesce(sum(debit - credit) filter (where entry_date <= p_to), 0) as v from movements
    ),
    bal_today as (
      select (select v from acct_opening) + coalesce(sum(debit - credit) filter (where entry_date <= current_date), 0) as v from movements
    ),
    monthly as (
      select date_trunc('month', entry_date)::date as mth,
        coalesce(sum(debit), 0) as cash_in, coalesce(sum(credit), 0) as cash_out
      from movements
      where entry_date between p_from and p_to
      group by 1
    ),
    cash_entries as (
      select distinct l.entry_id
      from journal_lines l join journal_entries e on e.id = l.entry_id
      where e.company_id = p_company and e.status = 'posted' and l.account_id in (select id from cash_bank_accts)
        and e.entry_date between p_from and p_to
    ),
    noncash as (
      select l.debit, l.credit, a.type as nature, a.subtype
      from journal_lines l
      join journal_entries e on e.id = l.entry_id
      join accounts a on a.id = l.account_id
      where l.entry_id in (select entry_id from cash_entries)
        and l.account_id not in (select id from cash_bank_accts)
    ),
    categorized as (
      select
        case
          when subtype = 'Receivable' then 'Received from Customers'
          when subtype = 'Payable' then 'Paid to Suppliers'
          when subtype in ('Fixed Asset', 'Accumulated Depreciation') then 'Fixed Assets'
          when subtype = 'Drawing' then 'Owner Drawings'
          when subtype = 'Equity' then 'Capital Contributions'
          when nature = 'income' then 'Other Income'
          when nature = 'expense' and subtype = 'COGS' then 'Cost of Sales Paid'
          when nature = 'expense' then 'Operating Expenses'
          else 'Other'
        end as category,
        case
          when subtype in ('Fixed Asset', 'Accumulated Depreciation') then 'investing'
          when subtype in ('Drawing', 'Equity') then 'financing'
          else 'operating'
        end as section,
        (credit - debit) as net
      from noncash
    ),
    cat_agg as (
      select section, category, sum(net) as amount from categorized group by section, category
    ),
    sections as (
      select jsonb_agg(jsonb_build_object(
          'key', section,
          'label', case section when 'operating' then 'Operating Activities' when 'investing' then 'Investing Activities' else 'Financing Activities' end,
          'lines', lines, 'total', tot
        ) order by case section when 'operating' then 1 when 'investing' then 2 else 3 end) as sections
      from (
        select section,
          jsonb_agg(jsonb_build_object('category', category, 'amount', amount) order by abs(amount) desc) as lines,
          sum(amount) as tot
        from cat_agg group by section
      ) s
    ),
    fc_items as (
      select o.direction, o.outstanding_base as amt, coalesce(o.due_date, o.doc_date) as eff
      from open_items o
      where o.company_id = p_company and o.status = 'open'
    ),
    fc as (
      select direction,
        coalesce(sum(amt) filter (where eff <= current_date and date_trunc('month', eff) = date_trunc('month', current_date)), 0) as due,
        coalesce(sum(amt) filter (where eff <= current_date and date_trunc('month', eff) < date_trunc('month', current_date)), 0) as overdue,
        coalesce(sum(amt) filter (where eff > current_date and (eff - current_date) between 1 and 30), 0) as next30,
        coalesce(sum(amt) filter (where eff > current_date and (eff - current_date) > 30), 0) as later
      from fc_items group by direction
    )
  select jsonb_build_object(
    'opening_balance', (select v from bal_before_from),
    'closing_balance', (select v from bal_asof_to),
    'current_balance', (select v from bal_today),
    'monthly', coalesce((select jsonb_agg(jsonb_build_object(
        'month', to_char(mth, 'YYYY-MM'), 'cash_in', cash_in, 'cash_out', cash_out, 'net', cash_in - cash_out
      ) order by mth) from monthly), '[]'::jsonb),
    'sections', coalesce((select sections from sections), '[]'::jsonb),
    'forecast', jsonb_build_object(
      'receivables', coalesce((select jsonb_build_object('overdue', overdue, 'due', due, 'next30', next30, 'later', later) from fc where direction = 'D'), jsonb_build_object('overdue', 0, 'due', 0, 'next30', 0, 'later', 0)),
      'payables', coalesce((select jsonb_build_object('overdue', overdue, 'due', due, 'next30', next30, 'later', later) from fc where direction = 'C'), jsonb_build_object('overdue', 0, 'due', 0, 'next30', 0, 'later', 0))
    )
  );
$function$;

revoke all on function public.report_cash_flow(uuid, date, date) from public, anon;
grant execute on function public.report_cash_flow(uuid, date, date) to authenticated;
