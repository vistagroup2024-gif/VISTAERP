-- Purchase Voucher: one discount on the whole bill, and the total that posts
-- takes it off.
--
-- Discount used to be a per-line column. Two things were wrong with that. A
-- supplier's bill carries ONE discount at the bottom, so entering it meant
-- spreading it across the lines by hand and hoping the pieces added up. And
-- nothing did anything with it: trade_doc_save computed the document total from
-- the LINE AMOUNTS alone, so the discount column moved the "landed cost" figure
-- under the grid and never reached the total, the supplier's payable, or the GL.
--
-- The voucher now carries it as `meta.discount`, and this is what makes the
-- posted figure agree with the Net Total on screen:
--
--     total = subtotal - discount + round_off
--
-- Nothing else about posting changes. trade_doc_post_now already builds every
-- ledger line from d.total, so crediting the supplier the discounted amount
-- follows from this one change; the stock lines are built from the line amounts
-- and are deliberately left alone, because a discount on the bill does not
-- change what arrived in the warehouse.
--
-- Only documents that send meta.discount are affected. Everything already saved
-- has no such key, coalesces to 0, and totals exactly as it does today.

create or replace function trade_doc_save(p_type text, p_prefix text, p_id uuid, p_header jsonb, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_co uuid := auth_company_id(); v_id uuid := p_id; v_no text; ln jsonb; i int := 0;
  v_sub numeric(18,2) := 0; v_round numeric(18,2); v_disc numeric(18,2); v_total numeric(18,2);
  v_src uuid; v_car uuid; v_status text; v_posted jsonb;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if p_id is null then perform staff_require_doc(p_type, 'create');
  else perform staff_require_trade_right(p_id, 'edit'); end if;
  perform staff_require_scope_products(p_lines);

  v_round := round(coalesce((p_header->>'round_off')::numeric, 0), 2);
  -- The bill-level discount, off the document total. Absent = 0, so every
  -- voucher saved before this migration totals exactly as it did.
  v_disc  := round(coalesce((p_header->'meta'->>'discount')::numeric, 0), 2);
  v_src := nullif(p_header->>'source_doc_id','')::uuid;
  v_car := nullif(p_header->>'source_car_contract','')::uuid;

  select coalesce(sum(round(coalesce((x->>'amount')::numeric,0),2)), 0) into v_sub
  from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) x;
  v_total := v_sub - v_disc + v_round;

  if p_type = 'sales_invoice' and is_car_cost_center(p_header->>'cost_center') then
    raise exception 'A car sale is invoiced in Car Sales, not with a Sales Invoice.';
  end if;

  if v_id is not null then
    select status into v_status from trade_documents where id = v_id and company_id = v_co;
    if v_status = 'awaiting_approval' then
      raise exception 'This voucher is awaiting authorisation and cannot be changed.';
    end if;
  end if;

  if v_src is not null and exists (
    select 1 from trade_documents t
    where t.company_id = v_co and t.doc_type = p_type and t.source_doc_id = v_src
      and (v_id is null or t.id <> v_id)) then
    raise exception 'That document has already been loaded into another %.', p_type;
  end if;
  if v_car is not null and exists (
    select 1 from trade_documents t
    where t.company_id = v_co and t.doc_type = p_type and t.source_car_contract = v_car
      and (v_id is null or t.id <> v_id)) then
    raise exception 'That Car Invoice has already been loaded into another %.', p_type;
  end if;

  if v_id is null then
    insert into doc_sequences(company_id, doc_type, prefix)
    values (v_co, 'trade_'||p_type, coalesce(nullif(p_prefix,''), upper(left(p_type,3))||'-'))
    on conflict (company_id, doc_type) do nothing;
    v_no := next_doc_number(v_co, 'trade_'||p_type);
    insert into trade_documents(company_id, doc_type, doc_no, doc_date, party_id, cost_center, tag_area,
      reference, narration, terms, mode_of_payment, due_date, delivery_date, currency, round_off,
      subtotal, total, status, meta, source_doc_id, source_car_contract, created_by)
    values (v_co, p_type, v_no, coalesce(nullif(p_header->>'doc_date','')::date, current_date),
      nullif(p_header->>'party_id','')::uuid, nullif(p_header->>'cost_center',''), nullif(p_header->>'tag_area',''),
      nullif(p_header->>'reference',''), nullif(p_header->>'narration',''), nullif(p_header->>'terms',''),
      nullif(p_header->>'mode_of_payment',''), nullif(p_header->>'due_date','')::date,
      nullif(p_header->>'delivery_date','')::date, coalesce(nullif(p_header->>'currency',''),'SAR'),
      v_round, v_sub, v_total, coalesce(nullif(p_header->>'status',''),'open'),
      coalesce(p_header->'meta','{}'::jsonb), v_src, v_car, auth.uid())
    returning id, doc_no into v_id, v_no;
  else
    update trade_documents set
      doc_date = coalesce(nullif(p_header->>'doc_date','')::date, current_date),
      party_id = nullif(p_header->>'party_id','')::uuid,
      cost_center = nullif(p_header->>'cost_center',''), tag_area = nullif(p_header->>'tag_area',''),
      reference = nullif(p_header->>'reference',''), narration = nullif(p_header->>'narration',''),
      terms = nullif(p_header->>'terms',''), mode_of_payment = nullif(p_header->>'mode_of_payment',''),
      due_date = nullif(p_header->>'due_date','')::date,
      delivery_date = nullif(p_header->>'delivery_date','')::date,
      currency = coalesce(nullif(p_header->>'currency',''),'SAR'),
      round_off = v_round, subtotal = v_sub, total = v_total,
      meta = coalesce(p_header->'meta','{}'::jsonb),
      source_doc_id = coalesce(v_src, source_doc_id),
      source_car_contract = coalesce(v_car, source_car_contract),
      updated_at = now()
    where id = v_id and company_id = v_co;
    if not found then raise exception 'Document not found'; end if;
    select doc_no into v_no from trade_documents where id = v_id;
    delete from trade_document_lines where doc_id = v_id;
  end if;

  for ln in select * from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) loop
    i := i + 1;
    if coalesce(nullif(ln->>'item_name',''), nullif(ln->>'product_id','')) is null
       and round(coalesce((ln->>'amount')::numeric,0),2) = 0 then continue; end if;
    insert into trade_document_lines(doc_id, sort, product_id, item_name, units, quantity, rate, amount, link1, meta)
    values (v_id, i, nullif(ln->>'product_id','')::uuid, nullif(ln->>'item_name',''), nullif(ln->>'units',''),
      round(coalesce((ln->>'quantity')::numeric,0),3), round(coalesce((ln->>'rate')::numeric,0),2),
      round(coalesce((ln->>'amount')::numeric,0),2), nullif(ln->>'link1',''), coalesce(ln->'meta','{}'::jsonb));
  end loop;

  if p_header ? 'warehouse_id' and nullif(p_header->>'warehouse_id','') is not null then
    update trade_documents set warehouse_id = (p_header->>'warehouse_id')::uuid where id = v_id;
  end if;

  if p_type in ('purchase_voucher','purchase_return','sales_return','sales_invoice') then
    v_posted := trade_doc_post(v_id);
  end if;
  return coalesce(v_posted, '{}'::jsonb) || jsonb_build_object('id', v_id, 'doc_no', v_no);
end $function$;

revoke all on function trade_doc_save(text, text, uuid, jsonb, jsonb) from public, anon;
grant execute on function trade_doc_save(text, text, uuid, jsonb, jsonb) to authenticated;
