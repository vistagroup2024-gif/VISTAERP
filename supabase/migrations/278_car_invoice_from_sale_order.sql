-- 278_car_invoice_from_sale_order.sql
-- The car branch of the workflow: a Sale Order on a car cost centre is invoiced
-- in Car Sales, not with a Sales Invoice. This gives that step the same Load
-- list as the rest of the chain, so a car Sale Order stops showing as pending
-- once its Car Invoice exists.

-- Car Sale Orders nothing has invoiced yet — the mirror of trade_doc_pending()
-- for the one step that lives outside the trade-document engine.
create or replace function car_pending_sale_orders()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'doc_no', d.doc_no, 'doc_date', d.doc_date,
    'party_name', (select p.name from parties p where p.id = d.party_id),
    'cost_center', d.cost_center, 'reference', d.reference, 'total', d.total,
    'lines', (select count(*) from trade_document_lines l where l.doc_id = d.id))
    order by d.doc_date desc, d.doc_no desc), '[]'::jsonb)
  from trade_documents d
  where d.company_id = auth_company_id()
    and d.doc_type = 'sale_order'
    and is_car_cost_center(d.cost_center)
    and coalesce(d.status, 'open') not in ('cancelled', 'closed')
    and not exists (select 1 from car_contracts c where c.company_id = d.company_id and c.source_doc_id = d.id);
$$;

-- Link a Car Invoice to the Sale Order it came from. Kept separate from
-- car_contract_save so that function — which owns the vehicle, the ownership
-- flag and the installment schedule — does not have to be re-stated to add a
-- single column, and cannot drift from it.
create or replace function car_contract_link_source(p_contract uuid, p_doc uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_co uuid := auth_company_id();
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if p_doc is null then return; end if;
  if not exists (select 1 from trade_documents d
                 where d.id = p_doc and d.company_id = v_co and d.doc_type = 'sale_order') then
    raise exception 'Sale Order not found';
  end if;
  if exists (select 1 from car_contracts c
             where c.company_id = v_co and c.source_doc_id = p_doc and c.id <> p_contract) then
    raise exception 'That Sale Order has already been invoiced.';
  end if;
  update car_contracts set source_doc_id = p_doc where id = p_contract and company_id = v_co;
  if not found then raise exception 'Car Invoice not found'; end if;
end $$;

grant execute on function car_pending_sale_orders() to authenticated;
grant execute on function car_contract_link_source(uuid, uuid) to authenticated;
