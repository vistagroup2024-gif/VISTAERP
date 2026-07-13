-- ============================================================
-- VISTA ERP - 021 Delete supplier bills & payments
-- delete_bill: reverse GL entry, unlink BRN, block if payments exist.
-- delete_payment: reverse GL entry, restore bill balance/status.
-- (Applied to remote DB via Supabase MCP; kept here for history.)
-- ============================================================

create or replace function delete_bill(p_bill uuid)
returns void language plpgsql security definer set search_path = public as $$
declare b bills%rowtype;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into b from bills where id = p_bill;
  if not found then raise exception 'Bill not found'; end if;
  if exists (select 1 from payments where bill_id = p_bill) then
    raise exception 'Cannot delete: this bill has recorded payments. Delete the payments first.';
  end if;
  delete from journal_entries where company_id = b.company_id and source = 'bill' and reference = b.bill_no;
  update brn_inventory set bill_id = null where bill_id = p_bill;
  delete from bills where id = p_bill;
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (b.company_id, auth.uid(), 'bill_deleted', 'bills', p_bill, jsonb_build_object('bill_no', b.bill_no));
end $$;

create or replace function delete_payment(p_payment uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p payments%rowtype; b bills%rowtype; v_new_paid numeric(18,2);
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into p from payments where id = p_payment;
  if not found then raise exception 'Payment not found'; end if;
  delete from journal_entries where company_id = p.company_id and source = 'billpay' and reference = p.payment_no;
  if p.bill_id is not null then
    select * into b from bills where id = p.bill_id;
    if found then
      v_new_paid := greatest(0, b.amount_paid - p.amount);
      update bills set amount_paid = v_new_paid,
        status = case when v_new_paid >= total then 'paid'
                      when v_new_paid > 0 then 'partially_paid' else 'issued' end
        where id = p.bill_id;
    end if;
  end if;
  delete from payments where id = p_payment;
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (p.company_id, auth.uid(), 'payment_deleted', 'payments', p_payment, jsonb_build_object('payment_no', p.payment_no));
end $$;

revoke all on function delete_bill(uuid) from anon, public;
revoke all on function delete_payment(uuid) from anon, public;
grant execute on function delete_bill(uuid) to authenticated;
grant execute on function delete_payment(uuid) to authenticated;
