-- Transactions Report — every posted journal line, filterable by date,
-- account, cost centre and transaction type (the entry's own `source`:
-- gl_receipt, gl_payment, purchase_voucher, car_sale, ... — the same field
-- the existing Voucher Register shows per entry, here at LINE level so it
-- can carry an account, a debit/credit and a cost centre each). Currency
-- reads the entry's own fx stamp (gl_voucher_stamp_fx) where one exists,
-- SAR otherwise, per how foreign-currency vouchers are posted in this ERP.
create or replace function public.report_transactions(p_company uuid, p_from date, p_to date,
  p_account_ids uuid[] default null, p_cost_centres text[] default null, p_txn_type text[] default null)
 RETURNS jsonb
 LANGUAGE sql STABLE
 SET search_path TO 'public'
AS $function$
select coalesce(jsonb_agg(jsonb_build_object(
    'entry_id', e.id, 'voucher_no', e.entry_no, 'date', e.entry_date,
    'source', coalesce(e.source, 'journal'), 'reference', e.reference,
    'account', a.name, 'account_id', a.id,
    'debit', l.debit, 'credit', l.credit, 'currency', coalesce(e.fx_currency, 'SAR'),
    'cost_centre', coalesce(l.cost_center, 'Unassigned'), 'tag_area', l.tag_area,
    'remarks', coalesce(l.description, e.memo)
  ) order by e.entry_date desc, e.entry_no desc), '[]'::jsonb)
from journal_lines l
join journal_entries e on e.id = l.entry_id
join accounts a on a.id = l.account_id
where e.company_id = p_company and e.status = 'posted'
  and e.entry_date between coalesce(p_from, '0001-01-01') and coalesce(p_to, '9999-12-31')
  and (p_account_ids is null or a.id = any(p_account_ids))
  and (p_cost_centres is null or l.cost_center = any(p_cost_centres))
  and (p_txn_type is null or coalesce(e.source, 'journal') = any(p_txn_type));
$function$;

revoke all on function public.report_transactions(uuid, date, date, uuid[], text[], text[]) from public, anon;
grant execute on function public.report_transactions(uuid, date, date, uuid[], text[], text[]) to authenticated;

do $chk$
declare
  v_company uuid := '96f6b539-b491-4df7-91a2-80c7c8e7491d';
  v_admin   uuid := 'edf3fa71-27e2-4cb1-af62-9afd685abefe';
  v_result jsonb;
  v_debit numeric;
  v_credit numeric;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);

  select public.report_transactions(v_company, '2000-01-01', current_date) into v_result;
  select coalesce(sum((r->>'debit')::numeric), 0), coalesce(sum((r->>'credit')::numeric), 0)
    into v_debit, v_credit
  from jsonb_array_elements(v_result) r;

  -- Every posted journal entry balances, so the whole line-level report must too.
  if abs(v_debit - v_credit) > 0.01 then
    raise exception 'report_transactions self-check: debit % does not equal credit % across all posted lines', v_debit, v_credit;
  end if;

  raise notice 'report_transactions self-check passed: lines=%, debit=%, credit=%', jsonb_array_length(v_result), v_debit, v_credit;
end;
$chk$;
