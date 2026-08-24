-- Add entry_id to ledger rows so the Ledger report drills down to the voucher.
create or replace function acct_ledger(
  p_company uuid, p_account_ids uuid[], p_from date, p_to date
) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'opening', coalesce((
      select sum(l.debit - l.credit) from journal_lines l
      join journal_entries e on e.id = l.entry_id
      where e.company_id = p_company and e.status = 'posted'
        and l.account_id = any(p_account_ids)
        and (p_from is null or e.entry_date < p_from)
    ), 0),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'entry_id', e.id, 'date', e.entry_date, 'entry_no', e.entry_no, 'account_id', l.account_id,
        'account', a.code || ' · ' || a.name, 'memo', coalesce(l.description, e.memo),
        'reference', e.reference, 'debit', l.debit, 'credit', l.credit
      ) order by e.entry_date, e.entry_no, l.created_at)
      from journal_lines l
      join journal_entries e on e.id = l.entry_id
      join accounts a on a.id = l.account_id
      where e.company_id = p_company and e.status = 'posted'
        and l.account_id = any(p_account_ids)
        and (p_from is null or e.entry_date >= p_from)
        and (p_to   is null or e.entry_date <= p_to)
    ), '[]'::jsonb)
  );
$$;
