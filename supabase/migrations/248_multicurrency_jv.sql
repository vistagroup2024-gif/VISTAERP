-- 248_multicurrency_jv.sql
-- #18 Multi-currency Journal Voucher. Amounts are entered in a foreign currency
-- with an exchange rate; the GL is posted in base (SAR) = foreign × rate, and the
-- entry records the original currency + rate for reference. Approval rules still
-- apply (via gl_submit) on the base amount.
alter table journal_entries add column if not exists fx_currency char(3);
alter table journal_entries add column if not exists fx_rate numeric(18,6);

create or replace function gl_journal_fx(
  p_company uuid, p_date date, p_narration text, p_reference text,
  p_currency char(3), p_rate numeric, p_lines jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare ln jsonb; arr jsonb := '[]'::jsonb; v jsonb; v_rate numeric(18,6) := coalesce(nullif(p_rate,0), 1);
        v_memo text;
begin
  v_memo := coalesce(p_narration,'');
  if upper(coalesce(p_currency,'SAR')) <> 'SAR' then
    v_memo := trim(both ' ' from v_memo || ' (' || p_currency || ' @ ' || v_rate || ')');
  end if;
  for ln in select * from jsonb_array_elements(p_lines) loop
    arr := arr || jsonb_build_array(jsonb_build_object(
      'account_id', ln->>'account',
      'debit',  round(coalesce((ln->>'debit')::numeric,0) * v_rate, 2),
      'credit', round(coalesce((ln->>'credit')::numeric,0) * v_rate, 2),
      'description', ln->>'remarks',
      'cost_center', ln->>'cost_center', 'tag_area', ln->>'tag_area'));
  end loop;
  v := gl_submit(p_company, p_date, v_memo, 'gl_journal', p_reference, arr);
  -- Stamp fx on the posted entry (pending vouchers keep it in the memo only).
  if (v->>'entry_id') is not null then
    update journal_entries set fx_currency = upper(coalesce(p_currency,'SAR')), fx_rate = v_rate
      where id = (v->>'entry_id')::uuid;
  end if;
  return v;
end $$;

grant execute on function gl_journal_fx(uuid, date, text, text, char, numeric, jsonb) to authenticated;
