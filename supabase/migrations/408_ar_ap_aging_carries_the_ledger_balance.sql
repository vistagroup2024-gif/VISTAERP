-- ar_ap_aging() only ever showed accounts with an OPEN ITEM — so a party
-- whose bills are fully allocated but who still carries a real ledger
-- balance (a receipt saved ON ACCOUNT, nothing picked in the popup; an
-- opening balance; anything posted straight to the account with no bill
-- raised) was invisible on this report, the exact trap CLAUDE.md already
-- names: "a receipt saved on account reduces the ledger and not the bills,
-- and the report then ages more than is owed." The dashboard's own A/R & A/P
-- card reads the ledger for the same reason.
--
-- Extended rather than duplicated: the existing bucket/total definition
-- (unchanged) still answers "what is billed and when is it due"; a new
-- `ledger_balance` column, and rows for any Receivable/Payable account with a
-- real balance even if it never carried an open item, answers "what do they
-- actually owe" — the same figure dashboard_metrics()'s ar_ap block already
-- computes, so this report's own total foots to the dashboard card.
create or replace function public.ar_ap_aging(p_company uuid, p_kind text, p_as_of date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with items as (
    select o.account_id, o.outstanding_base ob, (p_as_of - coalesce(o.due_date, o.doc_date)) age
    from open_items o
    where o.company_id = p_company and o.status = 'open'
      and o.direction = case when p_kind = 'supplier' then 'C' else 'D' end
  ),
  billed as (
    select account_id,
      sum(ob) total,
      sum(ob) filter (where age < 0) not_due,
      sum(ob) filter (where age between 0 and 30) b0,
      sum(ob) filter (where age between 31 and 60) b1,
      sum(ob) filter (where age between 61 and 90) b2,
      sum(ob) filter (where age between 91 and 180) b3,
      sum(ob) filter (where age > 180) b4
    from items group by account_id
  ),
  ledger as (
    -- Same sign convention dashboard_metrics() uses for its own ar/ap: a
    -- customer's balance is debit-credit, a supplier's is credit-debit — both
    -- read as a positive number when money is genuinely owed. Posted-only
    -- filtering happens INSIDE the subquery (an inner join to
    -- journal_entries), not as a condition on an outer left join — putting it
    -- on the outer join's own ON clause would still sum every DRAFT/VOID
    -- line, since only the entry-side columns go null, not the journal_lines
    -- row itself. Caught by this migration's own self-check before it shipped
    -- (123500 real vs 103500 with the leak).
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
      coalesce(b.total, 0) as total, coalesce(b.not_due, 0) as not_due,
      coalesce(b.b0, 0) as b0, coalesce(b.b1, 0) as b1, coalesce(b.b2, 0) as b2,
      coalesce(b.b3, 0) as b3, coalesce(b.b4, 0) as b4,
      coalesce(l.balance, 0) as ledger_balance
    from billed b
    full outer join ledger l on l.account_id = b.account_id
    where coalesce(b.total, 0) <> 0 or coalesce(l.balance, 0) <> 0
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'account_id', r.account_id, 'code', a.code, 'name', a.name, 'phone', a.phone,
      'total', r.total, 'not_due', r.not_due, 'b0', r.b0, 'b1', r.b1, 'b2', r.b2, 'b3', r.b3, 'b4', r.b4,
      'ledger_balance', r.ledger_balance
    ) order by a.name), '[]'::jsonb)
  from rows r join accounts a on a.id = r.account_id;
$function$;

do $chk$
declare
  v_company uuid := '96f6b539-b491-4df7-91a2-80c7c8e7491d';
  v_admin   uuid := 'edf3fa71-27e2-4cb1-af62-9afd685abefe';
  v_ar jsonb; v_ap jsonb;
  v_ar_ledger numeric; v_ap_ledger numeric;
  v_card_ar numeric; v_card_ap numeric;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);

  select public.ar_ap_aging(v_company, 'customer') into v_ar;
  select public.ar_ap_aging(v_company, 'supplier') into v_ap;
  select coalesce(sum((r->>'ledger_balance')::numeric), 0) into v_ar_ledger from jsonb_array_elements(v_ar) r;
  select coalesce(sum((r->>'ledger_balance')::numeric), 0) into v_ap_ledger from jsonb_array_elements(v_ap) r;

  select (public.dashboard_metrics() -> 'ar_ap' ->> 'ar')::numeric into v_card_ar;
  select (public.dashboard_metrics() -> 'ar_ap' ->> 'ap')::numeric into v_card_ap;

  if abs(v_ar_ledger - v_card_ar) > 0.01 then
    raise exception 'ar_ap_aging self-check: AR ledger total % does not match dashboard card ar %', v_ar_ledger, v_card_ar;
  end if;
  if abs(v_ap_ledger - v_card_ap) > 0.01 then
    raise exception 'ar_ap_aging self-check: AP ledger total % does not match dashboard card ap %', v_ap_ledger, v_card_ap;
  end if;

  raise notice 'ar_ap_aging self-check passed: ar_ledger=%, ap_ledger=%, ar_rows=%, ap_rows=%',
    v_ar_ledger, v_ap_ledger, jsonb_array_length(v_ar), jsonb_array_length(v_ap);
end;
$chk$;
