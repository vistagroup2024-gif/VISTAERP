-- Drawings Report — the DRAWING account group (3-02, subtype 'Drawing') the
-- chart of accounts already has: 5 named accounts (SS DRAWING, KHUBAIB
-- DRAWING, HAMMAD DRAWING, SS/PARCO, SS ZAKAT). Nothing new to classify —
-- subtype already marks exactly which accounts these are.
create or replace function public.report_drawings(p_company uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE sql STABLE
 SET search_path TO 'public'
AS $function$
with dr as (
  select l.account_id, a.name as account, e.entry_no as voucher, e.entry_date as date,
    l.debit - l.credit as amount, l.description as remarks,
    (select a2.name from journal_lines l2 join accounts a2 on a2.id = l2.account_id
       where l2.entry_id = e.id and l2.id <> l.id order by l2.credit desc limit 1) as credit_account
  from journal_lines l
  join journal_entries e on e.id = l.entry_id
  join accounts a on a.id = l.account_id
  where e.company_id = p_company and e.status = 'posted' and a.subtype = 'Drawing'
    and e.entry_date between coalesce(p_from, '0001-01-01') and coalesce(p_to, '9999-12-31')
)
select jsonb_build_object(
  'total', coalesce((select sum(amount) from dr), 0),
  'by_account', (select coalesce(jsonb_agg(jsonb_build_object('name', account, 'amount', s) order by s desc), '[]'::jsonb)
                 from (select account, sum(amount) as s from dr group by account) x),
  'monthly', (select coalesce(jsonb_agg(jsonb_build_object('month', m, 'amount', s) order by m), '[]'::jsonb)
              from (select to_char(date, 'YYYY-MM') as m, sum(amount) as s from dr group by 1) y),
  'rows', (select coalesce(jsonb_agg(jsonb_build_object(
      'voucher', voucher, 'date', date, 'account', account, 'amount', amount,
      'credit_account', credit_account, 'remarks', remarks
    ) order by date desc), '[]'::jsonb) from dr)
);
$function$;

revoke all on function public.report_drawings(uuid, date, date) from public, anon;
grant execute on function public.report_drawings(uuid, date, date) to authenticated;

do $chk$
declare
  v_company uuid := '96f6b539-b491-4df7-91a2-80c7c8e7491d';
  v_admin   uuid := 'edf3fa71-27e2-4cb1-af62-9afd685abefe';
  v_result numeric;
  v_direct numeric;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);

  select (public.report_drawings(v_company, '2000-01-01', current_date) ->> 'total')::numeric into v_result;
  select coalesce(sum(l.debit - l.credit), 0) into v_direct
    from journal_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id
   where e.company_id = v_company and e.status = 'posted' and a.subtype = 'Drawing';

  if abs(v_result - v_direct) > 0.01 then
    raise exception 'report_drawings self-check: total % does not match direct sum %', v_result, v_direct;
  end if;

  raise notice 'report_drawings self-check passed: total=%', v_result;
end;
$chk$;
