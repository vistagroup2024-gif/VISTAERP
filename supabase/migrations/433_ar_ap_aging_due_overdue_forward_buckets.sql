-- ar_ap_aging()'s buckets were backward: "0-30" meant already 0-30 days
-- overdue. For a business whose bills are mostly future-dated instalments
-- (most open items have a due date months out), that read as "everything is
-- 0" and hid the one useful question: what is coming due, and when. The
-- buckets now look FORWARD from p_as_of (0-30/31-60/61-90/91-180/180+ days
-- UNTIL due), and what has already arrived is reported separately as
-- `due` (arrived, its month has not ended) / `overdue` (its month has
-- ended) / `total_due` (the two added — same Due/Overdue split
-- dashboard_metrics()'s car_due_items and car_customer_balances() already
-- use, generalised here off any Receivable/Payable account's own due date
-- instead of an instalment schedule). `not_due`/`b0..b4` are gone —
-- nothing else in the codebase reads them.
create or replace function public.ar_ap_aging(p_company uuid, p_kind text, p_as_of date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with items as (
    select o.account_id, o.outstanding_base ob, coalesce(o.due_date, o.doc_date) as eff_date
    from open_items o
    where o.company_id = p_company and o.status = 'open'
      and o.direction = case when p_kind = 'supplier' then 'C' else 'D' end
  ),
  billed as (
    select account_id,
      sum(ob) total,
      sum(ob) filter (where eff_date <= p_as_of and date_trunc('month', eff_date) = date_trunc('month', p_as_of)) as due,
      sum(ob) filter (where eff_date <= p_as_of and date_trunc('month', eff_date) < date_trunc('month', p_as_of)) as overdue,
      sum(ob) filter (where eff_date > p_as_of and (eff_date - p_as_of) between 1 and 30) as f0,
      sum(ob) filter (where eff_date > p_as_of and (eff_date - p_as_of) between 31 and 60) as f1,
      sum(ob) filter (where eff_date > p_as_of and (eff_date - p_as_of) between 61 and 90) as f2,
      sum(ob) filter (where eff_date > p_as_of and (eff_date - p_as_of) between 91 and 180) as f3,
      sum(ob) filter (where eff_date > p_as_of and (eff_date - p_as_of) > 180) as f4
    from items group by account_id
  ),
  ledger as (
    select a.id as account_id,
      (case when p_kind = 'supplier' then -1 else 1 end) * coalesce(gl.bal, 0) as balance
    from accounts a
    left join (
      select l.account_id, sum(l.debit - l.credit) as bal
      from journal_lines l
      join journal_entries e on e.id = l.entry_id and e.status = 'posted'
      group by l.account_id
    ) gl on gl.account_id = a.id
    where a.company_id = p_company and a.is_postable
      and a.subtype = case when p_kind = 'supplier' then 'Payable' else 'Receivable' end
  ),
  rows as (
    select coalesce(b.account_id, l.account_id) as account_id,
      coalesce(b.total, 0) as total,
      coalesce(b.due, 0) as due, coalesce(b.overdue, 0) as overdue,
      coalesce(b.f0, 0) as f0, coalesce(b.f1, 0) as f1, coalesce(b.f2, 0) as f2,
      coalesce(b.f3, 0) as f3, coalesce(b.f4, 0) as f4,
      coalesce(l.balance, 0) as ledger_balance
    from billed b
    full outer join ledger l on l.account_id = b.account_id
    where coalesce(b.total, 0) <> 0 or coalesce(l.balance, 0) <> 0
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'account_id', r.account_id, 'code', a.code, 'name', a.name, 'phone', a.phone,
      'total', r.total, 'due', r.due, 'overdue', r.overdue, 'total_due', r.due + r.overdue,
      'f0', r.f0, 'f1', r.f1, 'f2', r.f2, 'f3', r.f3, 'f4', r.f4,
      'ledger_balance', r.ledger_balance
    ) order by a.name), '[]'::jsonb)
  from rows r join accounts a on a.id = r.account_id;
$function$;

revoke all on function public.ar_ap_aging(uuid, text, date) from public, anon;
grant execute on function public.ar_ap_aging(uuid, text, date) to authenticated;
