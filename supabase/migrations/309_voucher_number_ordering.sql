-- Voucher numbers sort as numbers, not as text.
--
-- ‹ Previous and Next › walked the numbers as strings, so Rct:9 came after
-- Rct:10 and a ledger printed its entries in that order too. The sequence is
-- the trailing run of digits in every prefix the ERP issues, and that is what
-- the ordering compares; the number itself is still the tie-break, so two
-- prefixes sharing a sequence stay stable.

create or replace function doc_no_seq(p_no text)
returns numeric language sql immutable parallel safe set search_path to 'public' as $function$
  -- The trailing run of digits, which is the sequence in every prefix the ERP
  -- issues (Rct:12, JPV-00012, VI-00012). No trailing digits — a number typed
  -- by hand, say — gives null, and those sort together at the end.
  select nullif((regexp_match(coalesce(p_no, ''), '(\d+)\s*$'))[1], '')::numeric;
$function$;

create or replace function gl_voucher_nav(p_source text, p_entry uuid, p_dir text)
returns uuid language plpgsql stable security definer set search_path to 'public' as $function$
declare v_no text; v_seq numeric; v_id uuid; v_co uuid := auth_company_id();
begin
  if p_entry is not null then
    select entry_no, coalesce(doc_no_seq(entry_no), 0) into v_no, v_seq
      from journal_entries where id = p_entry and company_id = v_co;
  end if;
  if p_dir = 'prev' then
    select id into v_id from journal_entries
      where company_id = v_co and source = p_source and status <> 'void'
        and (v_no is null or (coalesce(doc_no_seq(entry_no), 0), entry_no) < (v_seq, v_no))
      order by coalesce(doc_no_seq(entry_no), 0) desc, entry_no desc limit 1;
  else
    select id into v_id from journal_entries
      where company_id = v_co and source = p_source and status <> 'void'
        and (v_no is null or (coalesce(doc_no_seq(entry_no), 0), entry_no) > (v_seq, v_no))
      order by coalesce(doc_no_seq(entry_no), 0) asc, entry_no asc limit 1;
  end if;
  return v_id;
end $function$;

-- The ledger prints in the same order the navigation walks.
create or replace function acct_ledger(p_company uuid, p_account_ids uuid[], p_from date, p_to date)
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  with allowed as (
    select case when staff_scope_ids('account') is null then p_account_ids
                else array(select unnest(p_account_ids) intersect select unnest(staff_scope_ids('account')))
           end as ids
  )
  select jsonb_build_object(
    'opening', coalesce((
      select sum(l.debit - l.credit) from journal_lines l
      join journal_entries e on e.id = l.entry_id
      where e.company_id = p_company and e.status = 'posted'
        and l.account_id in (select unnest(ids) from allowed)
        and (p_from is null or e.entry_date < p_from)
    ), 0),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'entry_id', e.id, 'date', e.entry_date, 'entry_no', e.entry_no, 'account_id', l.account_id,
        'account', a.code || ' · ' || a.name, 'memo', coalesce(l.description, e.memo),
        'reference', e.reference, 'debit', l.debit, 'credit', l.credit
      ) order by e.entry_date, doc_no_seq(e.entry_no), e.entry_no, l.created_at)
      from journal_lines l
      join journal_entries e on e.id = l.entry_id
      join accounts a on a.id = l.account_id
      where e.company_id = p_company and e.status = 'posted'
        and l.account_id in (select unnest(ids) from allowed)
        and (p_from is null or e.entry_date >= p_from)
        and (p_to   is null or e.entry_date <= p_to)
    ), '[]'::jsonb)
  );
$function$;

revoke all on function doc_no_seq(text) from public, anon;
revoke all on function gl_voucher_nav(text, uuid, text) from public, anon;
revoke all on function acct_ledger(uuid, uuid[], date, date) from public, anon;
grant execute on function doc_no_seq(text) to authenticated;
grant execute on function gl_voucher_nav(text, uuid, text) to authenticated;
grant execute on function acct_ledger(uuid, uuid[], date, date) to authenticated;
