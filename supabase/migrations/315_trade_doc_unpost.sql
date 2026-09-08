-- Editing and deleting a POSTED trade voucher, with everything it did undone.
--
-- Until now the lock was a lie: trade_doc_save never refused a posted document,
-- it just re-ran trade_doc_post, which raises 'Already posted' — so the disabled
-- Save button was the only thing standing in the way, and enabling it would have
-- produced an error AFTER deleting the lines. trade_doc_delete refused outright.
--
-- What "undo everything" actually means for a trade document:
--
--   the journal entry        deleted, so the supplier's payable / the sale, the
--                            inventory or purchase account and the vehicle
--                            account all come off together
--   the stock movements      reversed and removed, so quantity AND value go back
--   vehicles a car PV made   deleted (their own BEFORE DELETE trigger releases
--                            the stock they hold)
--   the document             back to `open`, gl_entry and posted_at cleared
--
-- Editing is then unpost -> save -> post, in ONE transaction, so a failure
-- anywhere leaves the voucher exactly as it was.
--
-- WHAT IT REFUSES, AND WHY
-- ------------------------
-- A voucher can undo what IT did. It cannot undo what another document did on
-- top of it, and pretending otherwise is how a ledger starts lying. So:
--
--   * a later trade document was raised from this one   -> delete that first
--   * a vehicle this purchase created is on a contract
--     or no longer in stock                             -> undo that sale first
--   * reversing the stock would drive a balance negative -> the goods have gone
--
-- Each refusal names the document or vehicle in the way, so it is an order of
-- operations rather than a dead end.
--
-- WHO MAY DO IT
-- -------------
-- Admins, and anyone the admin has explicitly ticked for it. Note the word
-- explicitly: staff_doc_right treats an EMPTY doc_rights map as "everything
-- allowed", which is right for ordinary data entry and wrong for reaching into
-- posted accounts — every current user has an empty map. staff_doc_right_strict
-- is the same read without that fallback, mirroring staff_perm_strict.

-- ---------------------------------------------------------------- rights ----

create or replace function staff_doc_right_strict(p_doc text, p_right text)
returns boolean language plpgsql stable security definer set search_path to 'public'
as $function$
declare v jsonb;
begin
  if has_role('admin') then return true; end if;
  select doc_rights into v from profiles where id = auth.uid();
  -- No "empty means yes" here: the right has to be ticked.
  return coalesce((v -> p_doc ->> p_right)::boolean, false);
end $function$;

create or replace function staff_require_doc_strict(p_doc text, p_right text)
returns void language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if p_doc is null then return; end if;
  if not staff_doc_right_strict(p_doc, p_right) then
    raise exception 'This voucher is posted. Changing or deleting it needs the "Edit/Delete Posted" right on this screen, which an administrator grants.';
  end if;
end $function$;

-- --------------------------------------------------------------- unpost ----

create or replace function trade_doc_unpost(p_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  d          trade_documents;
  v_co       uuid := auth_company_id();
  mv         record;
  v_have     numeric(18,3);
  v_signed   numeric(18,2);
  v_entry_no text;
  v_moves    int := 0;
  v_vehicles int := 0;
  v_blocked  text;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;

  select * into d from trade_documents where id = p_id and company_id = v_co;
  if not found then raise exception 'Document not found'; end if;
  if d.gl_entry is null then
    return jsonb_build_object('unposted', false, 'reason', 'not posted');
  end if;
  if d.status = 'awaiting_approval' then
    raise exception 'This voucher is awaiting authorisation and cannot be changed.';
  end if;

  -- 1. Anything raised FROM this document has to go first.
  select string_agg(t.doc_no, ', ' order by t.doc_no) into v_blocked
  from trade_documents t
  where t.company_id = v_co and t.source_doc_id = d.id;
  if v_blocked is not null then
    raise exception '% has already been loaded into %. Delete or unpost that first.', d.doc_no, v_blocked;
  end if;

  -- 2. Vehicles this purchase created may only go while they are still plain
  --    stock. Once one is on a contract or sold, the SALE has to be undone
  --    before the purchase can be.
  select string_agg(v.vehicle_no, ', ' order by v.vehicle_no) into v_blocked
  from car_vehicles v
  where v.source_trade_doc = p_id
    and (v.contract_id is not null or v.status not in ('in_stock', 'ordered'));
  if v_blocked is not null then
    raise exception 'Vehicle % from % is sold or on a contract. Undo that first, then this purchase can be changed.', v_blocked, d.doc_no;
  end if;

  delete from car_vehicles where source_trade_doc = p_id;
  get diagnostics v_vehicles = row_count;

  -- 3. Reverse the stock this document moved, using each movement's OWN
  --    recorded quantity and value. Running the engine backwards instead would
  --    value the reversal at TODAY's weighted average, which has moved on since
  --    — the goods would come out at the wrong money.
  --
  --    qty is stored signed (+ receipt, - issue); value is always the magnitude.
  for mv in
    select * from stock_movements
    where company_id = v_co and reference = d.doc_no
    order by created_at desc
  loop
    v_signed := case when mv.qty < 0 then -mv.value else mv.value end;

    select qty into v_have from stock_balances
    where company_id = v_co and item_id = mv.item_id and warehouse_id = mv.warehouse_id
    for update;

    if coalesce(v_have, 0) - mv.qty < 0 then
      raise exception 'Cannot change %: only % of the % it received are still in stock — the rest has been issued.',
        d.doc_no, coalesce(v_have, 0), abs(mv.qty);
    end if;

    update stock_balances
       set qty = qty - mv.qty, value = value - v_signed
     where company_id = v_co and item_id = mv.item_id and warehouse_id = mv.warehouse_id;

    delete from stock_movements where id = mv.id;
    v_moves := v_moves + 1;
  end loop;

  -- 4. The ledger entry itself.
  select entry_no into v_entry_no from journal_entries where id = d.gl_entry;
  delete from journal_lines  where entry_id = d.gl_entry;
  delete from journal_entries where id = d.gl_entry and company_id = v_co;

  update trade_documents
     set gl_entry = null, posted_at = null, status = 'open', updated_at = now()
   where id = p_id;

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_co, auth.uid(), 'trade_doc_unpost', 'trade_document', p_id,
          jsonb_build_object('doc_no', d.doc_no, 'doc_type', d.doc_type,
                             'entry_no', v_entry_no, 'total', d.total,
                             'stock_movements_reversed', v_moves,
                             'vehicles_removed', v_vehicles,
                             'reason', p_reason));

  return jsonb_build_object('unposted', true, 'entry_no', v_entry_no,
                            'stock_movements_reversed', v_moves,
                            'vehicles_removed', v_vehicles);
end $function$;

-- Internal engine: not granted to anybody, so the only way in is through
-- trade_doc_save / trade_doc_delete, which carry the rights check.
revoke all on function trade_doc_unpost(uuid, text) from public, anon, authenticated;

revoke all on function staff_doc_right_strict(text, text)   from public, anon;
revoke all on function staff_require_doc_strict(text, text)  from public, anon;
grant execute on function staff_doc_right_strict(text, text)  to authenticated;
grant execute on function staff_require_doc_strict(text, text) to authenticated;

-- ---------------------------------------------------------------- delete ----

create or replace function trade_doc_delete(p_id uuid)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare d trade_documents; v_co uuid := auth_company_id();
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  perform staff_require_trade_right(p_id, 'delete');

  select * into d from trade_documents where id = p_id and company_id = v_co;
  if not found then raise exception 'Document not found'; end if;

  -- A posted voucher can be deleted, but only by somebody explicitly allowed to
  -- reach into posted accounts — and only after everything it did is undone.
  if d.gl_entry is not null then
    perform staff_require_doc_strict(d.doc_type, 'edit_posted');
    perform trade_doc_unpost(p_id, 'deleted');
  end if;

  delete from trade_documents where id = p_id and company_id = v_co;
end $function$;

revoke all on function trade_doc_delete(uuid) from public, anon;
grant execute on function trade_doc_delete(uuid) to authenticated;

-- ------------------------------------------------------------------ save ----
-- Supersedes 314: this body carries BOTH the bill-level discount and the
-- unpost-then-repost path, so applying 315 alone is enough.

create or replace function trade_doc_save(p_type text, p_prefix text, p_id uuid, p_header jsonb, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_co uuid := auth_company_id(); v_id uuid := p_id; v_no text; ln jsonb; i int := 0;
  v_sub numeric(18,2) := 0; v_round numeric(18,2); v_disc numeric(18,2); v_total numeric(18,2);
  v_src uuid; v_car uuid; v_status text; v_gl uuid; v_posted jsonb;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if p_id is null then perform staff_require_doc(p_type, 'create');
  else perform staff_require_trade_right(p_id, 'edit'); end if;
  perform staff_require_scope_products(p_lines);

  v_round := round(coalesce((p_header->>'round_off')::numeric, 0), 2);
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
    select status, gl_entry into v_status, v_gl
    from trade_documents where id = v_id and company_id = v_co;
    if v_status = 'awaiting_approval' then
      raise exception 'This voucher is awaiting authorisation and cannot be changed.';
    end if;
    -- Editing a POSTED voucher: undo what it did, then let the save below post
    -- it again from what was actually typed. One transaction, so a refusal from
    -- trade_doc_unpost leaves the voucher untouched.
    if v_gl is not null then
      perform staff_require_doc_strict(p_type, 'edit_posted');
      perform trade_doc_unpost(v_id, 'edited');
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
