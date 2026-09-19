-- 462 added a Tag Area field to the Vehicles screen (Car Sales → Vehicles →
-- Edit) so a car's tag area could be set or corrected directly there. The
-- business doesn't use that screen — Masters already has Tag Areas, and it's
-- picked on the two screens that actually matter: the Purchase Voucher line
-- (which is what carries it onto the vehicle, per 462) and the Car Invoice.
-- A third place to set the same thing, on a screen nobody opens, was a field
-- with no door to it — so the Vehicles UI and this parameter are both gone.
--
-- Nothing about the fix itself changes: car_vehicles.tag_area still exists,
-- car_vehicle_ensure_ordered and car_vehicle_from_trade_doc still carry it
-- off the Purchase Voucher/Order line, and car_tag_area() still falls back to
-- it before a sale. Only the manual-edit path is removed.

create or replace function public.car_vehicle_save(p_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := auth_company_id(); v_id uuid; v_no text;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if p_id is null then
    v_no := 'CAR-' || lpad(nextval('car_vehicle_seq')::text, 6, '0');
    insert into car_vehicles(company_id, vehicle_no, created_by) values (v_company, v_no, auth.uid())
      returning id into v_id;
  else
    v_id := p_id;
  end if;

  update car_vehicles set
    product_id    = nullif(p->>'product_id','')::uuid,
    vin           = nullif(p->>'vin',''),
    plate_no      = nullif(p->>'plate_no',''),
    make          = nullif(p->>'make',''),
    model         = nullif(p->>'model',''),
    variant       = nullif(p->>'variant',''),
    model_year    = nullif(p->>'model_year','')::int,
    color         = nullif(p->>'color',''),
    engine_no     = nullif(p->>'engine_no',''),
    purchase_date = nullif(p->>'purchase_date','')::date,
    supplier_id   = nullif(p->>'supplier_id','')::uuid,
    purchase_cost = coalesce(nullif(p->>'purchase_cost','')::numeric, 0),
    purchase_vat  = coalesce(nullif(p->>'purchase_vat','')::numeric, 0),
    current_location = nullif(p->>'current_location',''),
    status        = coalesce(nullif(p->>'status','')::car_vehicle_status, status),
    ownership     = coalesce(nullif(p->>'ownership','')::car_ownership_status, ownership),
    notes         = nullif(p->>'notes',''),
    updated_at    = now()
  where id = v_id and company_id = v_company;

  return v_id;
end $$;
revoke all on function public.car_vehicle_save(uuid, jsonb) from anon;
grant execute on function public.car_vehicle_save(uuid, jsonb) to authenticated;
