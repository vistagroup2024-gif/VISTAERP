-- 252_trade_doc_gl_costing.sql
-- Trade-document GL posting + Sales Costing report.
--  * Purchase Voucher posts: Dr Inventory (stock lines) / Dr Purchases (non-stock)
--    / Cr Supplier, and receives stock. Purchase Return reverses it.
--  * Sales Return posts: Dr Sales Returns / Cr Customer, and takes stock back
--    (Dr Inventory / Cr COGS at product purchase rate) for stock items.
--  * Orders / quotations / MRN / delivery note stay paperwork (no GL).
--  * Sales Costing = profit-per-sale report (revenue vs cost vs margin) built on
--    the module invoices that carry a cost (Visa today; others as they gain cost).

alter table trade_documents add column if not exists warehouse_id uuid references warehouses(id);
alter table trade_documents add column if not exists gl_entry uuid;
alter table trade_documents add column if not exists posted_at timestamptz;

-- Post a trade document to the GL (+ stock). Idempotent.
create or replace function trade_doc_post(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d trade_documents; v_co uuid := auth_company_id(); ln record; is_stk boolean; prc numeric;
        v_stock numeric(18,2) := 0; v_other numeric(18,2) := 0; v_cogs_val numeric(18,2) := 0;
        v_party uuid; v_inv uuid; v_pur uuid; v_sr uuid; v_cogs uuid; v_ro uuid;
        lines jsonb := '[]'::jsonb; g jsonb; v_dr numeric(18,2); v_cr numeric(18,2); v_diff numeric(18,2); mv jsonb;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into d from trade_documents where id = p_id and company_id = v_co;
  if not found then raise exception 'Document not found'; end if;
  if d.gl_entry is not null then raise exception 'Already posted'; end if;
  if d.doc_type not in ('purchase_voucher','purchase_return','sales_return') then
    raise exception 'This document type does not post to the GL';
  end if;

  -- Stock movements per line (balances only; one combined GL entry below).
  for ln in select l.*, pr.is_stock, pr.purchase_rate from trade_document_lines l
            left join acct_products pr on pr.id = l.product_id where l.doc_id = p_id order by l.sort loop
    is_stk := coalesce(ln.is_stock, false) and ln.product_id is not null;
    if is_stk then
      if d.warehouse_id is null then raise exception 'Choose a warehouse before posting (stock item present)'; end if;
      if d.doc_type = 'purchase_voucher' then
        perform stock_move('receipt', ln.product_id, d.warehouse_id, ln.quantity, coalesce(nullif(ln.rate,0), ln.amount/nullif(ln.quantity,0)), d.doc_date, d.doc_no, 'Purchase '||d.doc_no, false, null);
        v_stock := v_stock + ln.amount;
      elsif d.doc_type = 'purchase_return' then
        mv := stock_move('issue', ln.product_id, d.warehouse_id, ln.quantity, 0, d.doc_date, d.doc_no, 'Purch return '||d.doc_no, false, null);
        v_stock := v_stock + (mv->>'value')::numeric;
      elsif d.doc_type = 'sales_return' then
        prc := coalesce(nullif(ln.purchase_rate,0), 0);
        if prc > 0 then
          perform stock_move('receipt', ln.product_id, d.warehouse_id, ln.quantity, prc, d.doc_date, d.doc_no, 'Sales return '||d.doc_no, false, null);
          v_cogs_val := v_cogs_val + round(ln.quantity * prc, 2);
        end if;
      end if;
    else
      v_other := v_other + ln.amount;
    end if;
  end loop;

  v_inv := acct_ensure_named(v_co, 'Inventory', 'asset', '1', 'Current Asset');
  v_ro  := acct_ensure_named(v_co, 'Round Off', 'expense', '5', 'Indirect Expense');

  if d.doc_type = 'purchase_voucher' or d.doc_type = 'purchase_return' then
    v_party := ensure_party_account(v_co, d.party_id, 'supplier');
    v_pur := acct_ensure_named(v_co, 'Purchases', 'expense', '5', 'COGS');
    if d.doc_type = 'purchase_voucher' then
      if v_stock > 0 then lines := lines || jsonb_build_array(jsonb_build_object('account_id', v_inv::text, 'debit', v_stock, 'credit', 0, 'description', 'Stock '||d.doc_no)); end if;
      if v_other > 0 then lines := lines || jsonb_build_array(jsonb_build_object('account_id', v_pur::text, 'debit', v_other, 'credit', 0, 'description', 'Purchase '||d.doc_no)); end if;
      lines := lines || jsonb_build_array(jsonb_build_object('account_id', v_party::text, 'debit', 0, 'credit', d.total, 'description', coalesce(d.narration, d.doc_no), 'cost_center', d.cost_center, 'tag_area', d.tag_area));
    else -- purchase_return
      lines := lines || jsonb_build_array(jsonb_build_object('account_id', v_party::text, 'debit', d.total, 'credit', 0, 'description', coalesce(d.narration, d.doc_no), 'cost_center', d.cost_center, 'tag_area', d.tag_area));
      if v_stock > 0 then lines := lines || jsonb_build_array(jsonb_build_object('account_id', v_inv::text, 'debit', 0, 'credit', v_stock, 'description', 'Stock '||d.doc_no)); end if;
      if v_other > 0 then lines := lines || jsonb_build_array(jsonb_build_object('account_id', v_pur::text, 'debit', 0, 'credit', v_other, 'description', 'Purchase '||d.doc_no)); end if;
    end if;
  else -- sales_return
    v_party := ensure_party_account(v_co, d.party_id, 'customer');
    v_sr := acct_ensure_named(v_co, 'Sales Returns', 'income', '4', 'Revenue');
    lines := lines || jsonb_build_array(
      jsonb_build_object('account_id', v_sr::text, 'debit', d.total, 'credit', 0, 'description', 'Sales return '||d.doc_no, 'cost_center', d.cost_center, 'tag_area', d.tag_area),
      jsonb_build_object('account_id', v_party::text, 'debit', 0, 'credit', d.total, 'description', coalesce(d.narration, d.doc_no)));
    if v_cogs_val > 0 then
      v_cogs := acct_ensure_named(v_co, 'Cost of Goods Sold', 'expense', '5', 'COGS');
      lines := lines || jsonb_build_array(
        jsonb_build_object('account_id', v_inv::text, 'debit', v_cogs_val, 'credit', 0, 'description', 'Stock return '||d.doc_no),
        jsonb_build_object('account_id', v_cogs::text, 'debit', 0, 'credit', v_cogs_val, 'description', 'COGS reversal '||d.doc_no));
    end if;
  end if;

  -- Universal balancer: any price/cost or round-off difference → Round Off.
  select coalesce(sum((x->>'debit')::numeric),0), coalesce(sum((x->>'credit')::numeric),0)
    into v_dr, v_cr from jsonb_array_elements(lines) x;
  v_diff := round(v_dr - v_cr, 2);
  if v_diff <> 0 then
    if v_diff > 0 then lines := lines || jsonb_build_array(jsonb_build_object('account_id', v_ro::text, 'debit', 0, 'credit', v_diff, 'description', 'Round off'));
    else lines := lines || jsonb_build_array(jsonb_build_object('account_id', v_ro::text, 'debit', -v_diff, 'credit', 0, 'description', 'Round off')); end if;
  end if;

  g := gl_post(v_co, d.doc_date, coalesce(d.narration, d.doc_no), 'gl_trade_'||d.doc_type, d.doc_no, lines);
  update trade_documents set gl_entry = (g->>'entry_id')::uuid, posted_at = now(), status = 'posted' where id = p_id;
  return jsonb_build_object('posted', true, 'entry_no', g->>'entry_no');
end $$;

grant execute on function trade_doc_post(uuid) to authenticated;

-- Sales Costing: profit per sale (revenue, cost, margin). Visa invoices today;
-- other module invoices join in as they gain a cost figure.
create or replace function report_sales_costing(p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'date' desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'source', 'Visa', 'doc_no', vi.doc_no, 'date', vi.doc_date,
      'revenue', vi.sell_amount, 'cost', vi.cost_amount, 'profit', vi.sell_amount - vi.cost_amount,
      'margin', case when vi.sell_amount <> 0 then round((vi.sell_amount - vi.cost_amount) / vi.sell_amount * 100, 1) else 0 end) x
    from visa_invoices vi
    where vi.company_id = auth_company_id()
      and (p_from is null or vi.doc_date >= p_from) and (p_to is null or vi.doc_date <= p_to)
  ) t;
$$;

grant execute on function report_sales_costing(date, date) to authenticated;
