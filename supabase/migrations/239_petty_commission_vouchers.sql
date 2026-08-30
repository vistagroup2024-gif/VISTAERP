-- 239_petty_commission_vouchers.sql
-- Accounting Phase 3 (batch 2) — Petty Cash Voucher (#4) and Commission Voucher
-- (#10). Both are payment-style vouchers, so they reuse the exact gl_payment
-- posting shape (cash/bank credited, expense/party lines debited, cost_center /
-- tag_area carried) via gl_submit — no new posting engine. They only differ by
-- the `source` stamped on the entry, which gives each its own document series and
-- makes the shared voucher record-management RPCs (gl_voucher_get / _find / _nav
-- / _update / _void) treat them as separate registers automatically.

-- Petty Cash: identical to gl_payment but source = 'gl_petty'.
create or replace function gl_petty(p_company uuid, p_date date, p_cash_bank uuid, p_narration text, p_reference text, p_lines jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare ln jsonb; arr jsonb := '[]'::jsonb; total numeric(18,2) := 0; amt numeric(18,2);
begin
  for ln in select * from jsonb_array_elements(p_lines) loop
    amt := round(coalesce((ln->>'amount')::numeric,0),2);
    if amt = 0 then continue; end if;
    total := total + amt;
    arr := arr || jsonb_build_array(jsonb_build_object('account_id', ln->>'account', 'debit', amt, 'credit', 0,
      'description', ln->>'remarks', 'cost_center', ln->>'cost_center', 'tag_area', ln->>'tag_area'));
  end loop;
  arr := jsonb_build_array(jsonb_build_object('account_id', p_cash_bank::text, 'debit', 0, 'credit', total, 'description', p_narration)) || arr;
  return gl_submit(p_company, p_date, p_narration, 'gl_petty', p_reference, arr);
end $function$;

-- Commission: identical to gl_payment but source = 'gl_commission'. The salesperson
-- is the debited line account; the cost center is carried per line as usual.
create or replace function gl_commission(p_company uuid, p_date date, p_cash_bank uuid, p_narration text, p_reference text, p_lines jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare ln jsonb; arr jsonb := '[]'::jsonb; total numeric(18,2) := 0; amt numeric(18,2);
begin
  for ln in select * from jsonb_array_elements(p_lines) loop
    amt := round(coalesce((ln->>'amount')::numeric,0),2);
    if amt = 0 then continue; end if;
    total := total + amt;
    arr := arr || jsonb_build_array(jsonb_build_object('account_id', ln->>'account', 'debit', amt, 'credit', 0,
      'description', ln->>'remarks', 'cost_center', ln->>'cost_center', 'tag_area', ln->>'tag_area'));
  end loop;
  arr := jsonb_build_array(jsonb_build_object('account_id', p_cash_bank::text, 'debit', 0, 'credit', total, 'description', p_narration)) || arr;
  return gl_submit(p_company, p_date, p_narration, 'gl_commission', p_reference, arr);
end $function$;

grant execute on function gl_petty(uuid, date, uuid, text, text, jsonb) to authenticated;
grant execute on function gl_commission(uuid, date, uuid, text, text, jsonb) to authenticated;

-- Seed a dedicated PETTY CASH ledger per company (idempotent) so the Petty Cash
-- voucher has its own cash book, placed beside the existing CASH account.
insert into accounts (company_id, code, name, type, subtype, is_postable, is_group, status, currency, opening_balance, opening_is_debit, sort_order, parent_id)
select c.company_id,
       coalesce(g.code, '1-02') || '-PC',
       'PETTY CASH', 'asset', 'Cash', true, false, 'active', 'SAR', 0, true, 900,
       g.parent_id
from (select distinct company_id from accounts) c
cross join lateral (
  select a.parent_id, p.code
  from accounts a left join accounts p on p.id = a.parent_id
  where a.company_id = c.company_id and a.subtype = 'Cash' and a.is_group = false
  order by a.code limit 1
) g
where not exists (
  select 1 from accounts x where x.company_id = c.company_id and x.subtype = 'Cash' and upper(x.name) = 'PETTY CASH'
)
and not exists (
  select 1 from accounts y where y.company_id = c.company_id and y.code = coalesce(g.code, '1-02') || '-PC'
);

-- Let record-management (edit / void / browse / next-doc) treat Petty Cash and
-- Commission as manual vouchers, exactly like Receipt/Payment/Contra/Journal.
create or replace function acct_is_manual_voucher(p_source text)
 returns boolean language sql immutable
as $$ select p_source in ('gl_receipt','gl_payment','gl_contra','gl_journal','gl_petty','gl_commission') $$;
