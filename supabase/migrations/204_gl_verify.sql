-- Ledger integrity verification: overall debit=credit and any individual entry
-- whose lines do not net to zero. Used by the acceptance/verification screen.
create or replace function gl_verify(p_company uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with per_entry as (
    select e.id, e.entry_no, e.entry_date,
      sum(l.debit) d, sum(l.credit) c
    from journal_entries e join journal_lines l on l.entry_id = e.id
    where e.company_id = p_company and e.status = 'posted'
    group by e.id, e.entry_no, e.entry_date
  )
  select jsonb_build_object(
    'total_debit',  coalesce((select sum(d) from per_entry),0),
    'total_credit', coalesce((select sum(c) from per_entry),0),
    'diff',         coalesce((select sum(d)-sum(c) from per_entry),0),
    'unbalanced', coalesce((select jsonb_agg(jsonb_build_object(
        'entry_no', entry_no, 'date', entry_date, 'diff', d - c))
      from per_entry where round(d - c, 2) <> 0), '[]'::jsonb)
  );
$$;
grant execute on function gl_verify(uuid) to authenticated;
