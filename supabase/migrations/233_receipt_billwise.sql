-- 233_receipt_billwise.sql
-- Bill-wise adjustment on the Receipt / Payment voucher: post the receipt/payment
-- AND settle specific outstanding bills of the party account in one step.
-- Reuses the existing open_items / allocations model (migration 207/208). Each
-- line may carry an `allocations` array [{open_item_id, amount}] for manual
-- bill-by-bill adjustment, or `fifo: true` to auto-allocate its amount oldest-
-- first. Anything unallocated stays "on account" (a credit/debit balance on the
-- party). Posts directly (like party_settle) so allocation is atomic with the
-- posting.
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

  -- Party/other lines: credit (receipt) or debit (payment) of each amount.
  for ln in select * from jsonb_array_elements(p_lines) loop
    amt := round(coalesce((ln->>'amount')::numeric, 0), 2);
    if amt <= 0 then continue; end if;
    total := total + amt;
    if p_kind = 'customer' then
      arr := arr || jsonb_build_array(jsonb_build_object('account_id', ln->>'account', 'debit', 0, 'credit', amt, 'description', ln->>'remarks'));
    else
      arr := arr || jsonb_build_array(jsonb_build_object('account_id', ln->>'account', 'debit', amt, 'credit', 0, 'description', ln->>'remarks'));
    end if;
  end loop;
  if total <= 0 then raise exception 'Enter at least one amount'; end if;

  -- Cash/bank contra line for the total.
  if p_kind = 'customer' then
    arr := jsonb_build_array(jsonb_build_object('account_id', p_cash_bank::text, 'debit', total, 'credit', 0, 'description', p_narration)) || arr;
  else
    arr := jsonb_build_array(jsonb_build_object('account_id', p_cash_bank::text, 'debit', 0, 'credit', total, 'description', p_narration)) || arr;
  end if;

  v := gl_post(p_company, p_date, p_narration, v_doc, case when p_kind='customer' then 'receipt' else 'payment' end, p_reference, arr);
  v_entry := (v->>'entry_id')::uuid;

  -- Apply allocations per line.
  for ln in select * from jsonb_array_elements(p_lines) loop
    amt := round(coalesce((ln->>'amount')::numeric, 0), 2);
    if amt <= 0 then continue; end if;
    if ln ? 'allocations' and jsonb_typeof(ln->'allocations') = 'array' and jsonb_array_length(ln->'allocations') > 0 then
      for a in select * from jsonb_array_elements(ln->'allocations') loop
        take := round(coalesce((a->>'amount')::numeric, 0), 2);
        if take <= 0 then continue; end if;
        select * into oi from open_items
          where id = (a->>'open_item_id')::uuid and company_id = p_company
            and account_id = (ln->>'account')::uuid and status = 'open' for update;
        if not found then continue; end if;
        take := least(take, oi.outstanding_base);
        if take <= 0 then continue; end if;
        insert into allocations(company_id, open_item_id, settle_entry_id, amount_base, note)
        values (p_company, oi.id, v_entry, take, 'Bill-wise');
        update open_items set outstanding_base = outstanding_base - take,
          status = case when outstanding_base - take <= 0.005 then 'settled' else 'open' end
          where id = oi.id;
      end loop;
    elsif coalesce((ln->>'fifo')::boolean, false) then
      perform allocate_fifo(p_company, (ln->>'account')::uuid, v_entry, amt, 'Auto FIFO');
    end if;
  end loop;

  perform acct_log(p_company, 'posted', v_doc, v->>'entry_no', jsonb_build_object('amount', total, 'billwise', true));
  return jsonb_build_object('pending', false, 'entry_no', v->>'entry_no', 'entry_id', v_entry);
end $function$;

grant execute on function gl_receipt_billwise(uuid, text, date, uuid, text, text, jsonb) to authenticated;
