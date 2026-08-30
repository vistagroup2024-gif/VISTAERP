-- 234_journal_billwise.sql
-- Bill-wise adjustment on the Journal Voucher: post the JV and settle specific
-- outstanding bills of a party line against the JV entry. Mirrors
-- gl_receipt_billwise but for journal-style lines (each line may carry an
-- `allocations` array [{open_item_id, amount}]). gl_post already enforces the
-- debit=credit balance.
create or replace function gl_journal_billwise(p_company uuid, p_date date, p_narration text, p_reference text, p_lines jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v jsonb; arr jsonb := '[]'::jsonb; ln jsonb; a jsonb; d numeric(18,2); c numeric(18,2);
  take numeric(18,2); oi open_items%rowtype; v_entry uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  for ln in select * from jsonb_array_elements(p_lines) loop
    d := round(coalesce((ln->>'debit')::numeric,0),2); c := round(coalesce((ln->>'credit')::numeric,0),2);
    if d = 0 and c = 0 then continue; end if;
    arr := arr || jsonb_build_array(jsonb_build_object('account_id', ln->>'account', 'debit', d, 'credit', c,
      'description', ln->>'remarks', 'cost_center', ln->>'cost_center', 'tag_area', ln->>'tag_area'));
  end loop;
  v := gl_post(p_company, p_date, p_narration, 'gl_journal', 'gl_journal', p_reference, arr);
  v_entry := (v->>'entry_id')::uuid;
  for ln in select * from jsonb_array_elements(p_lines) loop
    if ln ? 'allocations' and jsonb_typeof(ln->'allocations') = 'array' and jsonb_array_length(ln->'allocations') > 0 then
      for a in select * from jsonb_array_elements(ln->'allocations') loop
        take := round(coalesce((a->>'amount')::numeric,0),2);
        if take <= 0 then continue; end if;
        select * into oi from open_items where id = (a->>'open_item_id')::uuid and company_id = p_company
          and account_id = (ln->>'account')::uuid and status = 'open' for update;
        if not found then continue; end if;
        take := least(take, oi.outstanding_base);
        if take <= 0 then continue; end if;
        insert into allocations(company_id, open_item_id, settle_entry_id, amount_base, note)
        values (p_company, oi.id, v_entry, take, 'Bill-wise JV');
        update open_items set outstanding_base = outstanding_base - take,
          status = case when outstanding_base - take <= 0.005 then 'settled' else 'open' end where id = oi.id;
      end loop;
    end if;
  end loop;
  perform acct_log(p_company, 'posted', 'gl_journal', v->>'entry_no', jsonb_build_object('billwise', true));
  return jsonb_build_object('pending', false, 'entry_no', v->>'entry_no', 'entry_id', v_entry);
end $function$;

grant execute on function gl_journal_billwise(uuid, date, text, text, jsonb) to authenticated;
