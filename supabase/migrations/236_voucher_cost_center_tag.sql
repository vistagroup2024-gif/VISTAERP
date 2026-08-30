-- 236_voucher_cost_center_tag.sql
-- Cost Center + Tag Area on Receipt / Payment vouchers. journal_lines already
-- carries cost_center / tag_area; the Journal voucher already stamps them
-- (gl_journal / gl_journal_billwise). Extend gl_receipt, gl_payment and
-- gl_receipt_billwise so each posted line carries the cost_center / tag_area sent
-- from the voucher. (The cash/bank contra line is an asset movement and is left
-- untagged.)
create or replace function gl_receipt(p_company uuid, p_date date, p_cash_bank uuid, p_narration text, p_reference text, p_lines jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare ln jsonb; arr jsonb := '[]'::jsonb; total numeric(18,2) := 0; amt numeric(18,2);
begin
  for ln in select * from jsonb_array_elements(p_lines) loop
    amt := round(coalesce((ln->>'amount')::numeric,0),2);
    if amt = 0 then continue; end if;
    total := total + amt;
    arr := arr || jsonb_build_array(jsonb_build_object('account_id', ln->>'account', 'debit', 0, 'credit', amt,
      'description', ln->>'remarks', 'cost_center', ln->>'cost_center', 'tag_area', ln->>'tag_area'));
  end loop;
  arr := jsonb_build_array(jsonb_build_object('account_id', p_cash_bank::text, 'debit', total, 'credit', 0, 'description', p_narration)) || arr;
  return gl_submit(p_company, p_date, p_narration, 'gl_receipt', p_reference, arr);
end $function$;

create or replace function gl_payment(p_company uuid, p_date date, p_cash_bank uuid, p_narration text, p_reference text, p_lines jsonb)
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
  return gl_submit(p_company, p_date, p_narration, 'gl_payment', p_reference, arr);
end $function$;

create or replace function gl_receipt_billwise(
  p_company uuid, p_kind text, p_date date, p_cash_bank uuid,
  p_narration text, p_reference text, p_lines jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v jsonb; arr jsonb := '[]'::jsonb; total numeric(18,2) := 0; v_entry uuid;
  ln jsonb; a jsonb; amt numeric(18,2); take numeric(18,2); oi open_items%rowtype;
  v_doc text := case when p_kind = 'customer' then 'gl_receipt' else 'gl_payment' end;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  for ln in select * from jsonb_array_elements(p_lines) loop
    amt := round(coalesce((ln->>'amount')::numeric, 0), 2);
    if amt <= 0 then continue; end if;
    total := total + amt;
    if p_kind = 'customer' then
      arr := arr || jsonb_build_array(jsonb_build_object('account_id', ln->>'account', 'debit', 0, 'credit', amt,
        'description', ln->>'remarks', 'cost_center', ln->>'cost_center', 'tag_area', ln->>'tag_area'));
    else
      arr := arr || jsonb_build_array(jsonb_build_object('account_id', ln->>'account', 'debit', amt, 'credit', 0,
        'description', ln->>'remarks', 'cost_center', ln->>'cost_center', 'tag_area', ln->>'tag_area'));
    end if;
  end loop;
  if total <= 0 then raise exception 'Enter at least one amount'; end if;
  if p_kind = 'customer' then
    arr := jsonb_build_array(jsonb_build_object('account_id', p_cash_bank::text, 'debit', total, 'credit', 0, 'description', p_narration)) || arr;
  else
    arr := jsonb_build_array(jsonb_build_object('account_id', p_cash_bank::text, 'debit', 0, 'credit', total, 'description', p_narration)) || arr;
  end if;
  v := gl_post(p_company, p_date, p_narration, v_doc, case when p_kind='customer' then 'receipt' else 'payment' end, p_reference, arr);
  v_entry := (v->>'entry_id')::uuid;
  for ln in select * from jsonb_array_elements(p_lines) loop
    amt := round(coalesce((ln->>'amount')::numeric, 0), 2);
    if amt <= 0 then continue; end if;
    if ln ? 'allocations' and jsonb_typeof(ln->'allocations') = 'array' and jsonb_array_length(ln->'allocations') > 0 then
      for a in select * from jsonb_array_elements(ln->'allocations') loop
        take := round(coalesce((a->>'amount')::numeric, 0), 2);
        if take <= 0 then continue; end if;
        select * into oi from open_items where id = (a->>'open_item_id')::uuid and company_id = p_company
          and account_id = (ln->>'account')::uuid and status = 'open' for update;
        if not found then continue; end if;
        take := least(take, oi.outstanding_base);
        if take <= 0 then continue; end if;
        insert into allocations(company_id, open_item_id, settle_entry_id, amount_base, note)
        values (p_company, oi.id, v_entry, take, 'Bill-wise');
        update open_items set outstanding_base = outstanding_base - take,
          status = case when outstanding_base - take <= 0.005 then 'settled' else 'open' end where id = oi.id;
      end loop;
    elsif coalesce((ln->>'fifo')::boolean, false) then
      perform allocate_fifo(p_company, (ln->>'account')::uuid, v_entry, amt, 'Auto FIFO');
    end if;
  end loop;
  perform acct_log(p_company, 'posted', v_doc, v->>'entry_no', jsonb_build_object('amount', total, 'billwise', true));
  return jsonb_build_object('pending', false, 'entry_no', v->>'entry_no', 'entry_id', v_entry);
end $function$;
