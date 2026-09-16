-- Car Delivery Report — the dashboard's Delivery Status card, one row per
-- vehicle instead of summed. Status counts (sold/delivered/in_stock/
-- reserved/held) are the same car_vehicles.status dashboard_metrics()'s
-- own `cars` CTE already counts. A car sale's own "invoice" is the Car
-- Invoice (car_contracts — not a trade document, per how this ERP posts a
-- car sale), so invoice number/date/amount come from there.
create or replace function public.report_car_delivery(p_company uuid)
 RETURNS jsonb
 LANGUAGE sql STABLE
 SET search_path TO 'public'
AS $function$
-- Named the same way every other car-sales screen names a vehicle
-- (vehicleTitle() in car-sales/lib.ts): the Product Tree item it was bought
-- as, falling back to make/model/variant/year for a vehicle recorded before
-- an item was linked. Raw fields go out so the page uses that same helper
-- rather than a second name-formatting rule in SQL.
select coalesce(jsonb_agg(jsonb_build_object(
    'vehicle_id', v.id,
    'item', ap.name, 'make', v.make, 'model', v.model, 'variant', v.variant, 'model_year', v.model_year,
    'plate_no', v.plate_no, 'status', v.status,
    'customer', p.name, 'cost_centre', c.cost_center, 'tag_area', c.tag_area,
    'invoice_no', c.contract_no, 'invoice_date', c.contract_date, 'invoice_amount', c.net_payable,
    'delivered', v.status = 'delivered'
  ) order by c.contract_date desc nulls last, v.vehicle_no), '[]'::jsonb)
from car_vehicles v
left join car_contracts c on c.id = v.contract_id
left join parties p on p.id = coalesce(c.customer_id, v.current_customer_id)
left join acct_products ap on ap.id = v.product_id
where v.company_id = p_company;
$function$;

revoke all on function public.report_car_delivery(uuid) from public, anon;
grant execute on function public.report_car_delivery(uuid) to authenticated;

do $chk$
declare
  v_company uuid := '96f6b539-b491-4df7-91a2-80c7c8e7491d';
  v_admin   uuid := 'edf3fa71-27e2-4cb1-af62-9afd685abefe';
  v_result jsonb;
  v_delivered int;
  v_sold int;
  v_card_delivered numeric;
  v_card_sold numeric;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);

  select public.report_car_delivery(v_company) into v_result;
  select count(*) filter (where r->>'delivered' = 'true'),
         count(*) filter (where r->>'status' in ('sold', 'delivered'))
    into v_delivered, v_sold
  from jsonb_array_elements(v_result) r;

  select (public.dashboard_metrics() -> 'delivery_status' ->> 'delivered')::numeric,
         (public.dashboard_metrics() -> 'delivery_status' ->> 'sold')::numeric
    into v_card_delivered, v_card_sold;

  if v_delivered <> v_card_delivered then
    raise exception 'report_car_delivery self-check: delivered % does not match dashboard card delivered %', v_delivered, v_card_delivered;
  end if;
  if v_sold <> v_card_sold then
    raise exception 'report_car_delivery self-check: sold % does not match dashboard card sold %', v_sold, v_card_sold;
  end if;

  raise notice 'report_car_delivery self-check passed: vehicles=%, delivered=%, sold=%', jsonb_array_length(v_result), v_delivered, v_sold;
end;
$chk$;
