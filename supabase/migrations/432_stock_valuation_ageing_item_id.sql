-- Stock Valuation and Ageing Analysis return an item's NAME only, never its
-- id -- so neither report could link into Stock Movement (which filters by
-- p_items uuid[]) for a Valuation -> Movement or Ageing -> Movement
-- drilldown. Purely additive: one more field in each jsonb_build_object,
-- every existing field and value unchanged.

CREATE OR REPLACE FUNCTION public.stock_valuation_report(p_as_of date DEFAULT NULL::date, p_wh uuid DEFAULT NULL::uuid, p_items uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with agg as (
    select m.item_id, m.warehouse_id, sum(m.qty) qty, sum(sign(m.qty) * m.value) value
    from stock_movements m
    where m.company_id = auth_company_id()
      and (p_as_of is null or m.doc_date <= p_as_of)
      and (p_wh is null or m.warehouse_id = p_wh)
      and (p_items is null or m.item_id = any(p_items))
    group by m.item_id, m.warehouse_id
  ),
  tot as (select nullif(sum(value), 0) t from agg)
  select coalesce(jsonb_agg(jsonb_build_object(
    'item', pr.name, 'item_id', pr.id, 'uom', pr.uom, 'warehouse', w.name,
    'qty', a.qty, 'value', a.value,
    'avg_cost', case when a.qty <> 0 then round(a.value / a.qty, 2) else 0 end,
    'share', round(a.value / coalesce((select t from tot), 1) * 100, 2),
    'reorder_level', pr.reorder_level,
    'low', (pr.reorder_level > 0 and a.qty <= pr.reorder_level))
    order by pr.name, w.name), '[]'::jsonb)
  from agg a
  join acct_products pr on pr.id = a.item_id
  join warehouses w on w.id = a.warehouse_id
  where a.qty <> 0 or a.value <> 0;
$function$;

CREATE OR REPLACE FUNCTION public.stock_ageing_analysis(p_as_of date DEFAULT NULL::date, p_wh uuid DEFAULT NULL::uuid, p_items uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare v_co uuid := auth_company_id(); v_as date := coalesce(p_as_of, current_date);
        r record; v_out jsonb := '[]'::jsonb;
        v_issue numeric; lot record; v_take numeric; v_left numeric;
        b0 numeric; b1 numeric; b2 numeric; b3 numeric; b4 numeric; v_val numeric; v_age int;
begin
  for r in
    select pr.id, pr.name, pr.uom
    from acct_products pr
    where pr.company_id = v_co and is_stock_item(pr.id) and not pr.is_group and pr.is_active
      and (p_items is null or pr.id = any(p_items))
    order by pr.name
  loop
    select coalesce(sum(-m.qty), 0) into v_issue from stock_movements m
      where m.company_id = v_co and m.item_id = r.id and m.qty < 0 and m.doc_date <= v_as
        and (p_wh is null or m.warehouse_id = p_wh);

    b0 := 0; b1 := 0; b2 := 0; b3 := 0; b4 := 0; v_val := 0;
    for lot in
      select m.doc_date, m.qty, case when m.qty <> 0 then m.value / m.qty else 0 end rate
      from stock_movements m
      where m.company_id = v_co and m.item_id = r.id and m.qty > 0 and m.doc_date <= v_as
        and (p_wh is null or m.warehouse_id = p_wh)
      order by m.doc_date, m.created_at
    loop
      v_take := least(lot.qty, v_issue);
      v_issue := v_issue - v_take;
      v_left := lot.qty - v_take;
      if v_left <= 0 then continue; end if;
      v_age := v_as - lot.doc_date;
      if    v_age <= 30  then b0 := b0 + v_left;
      elsif v_age <= 60  then b1 := b1 + v_left;
      elsif v_age <= 90  then b2 := b2 + v_left;
      elsif v_age <= 180 then b3 := b3 + v_left;
      else                    b4 := b4 + v_left; end if;
      v_val := v_val + round(v_left * lot.rate, 2);
    end loop;

    if b0 + b1 + b2 + b3 + b4 > 0 then
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'item', r.name, 'item_id', r.id, 'uom', r.uom,
        'qty', b0 + b1 + b2 + b3 + b4, 'value', v_val,
        'd0_30', b0, 'd31_60', b1, 'd61_90', b2, 'd91_180', b3, 'd180_plus', b4));
    end if;
  end loop;
  return v_out;
end $function$;

revoke all on function public.stock_valuation_report(date, uuid, uuid[]) from public, anon;
grant execute on function public.stock_valuation_report(date, uuid, uuid[]) to authenticated;

revoke all on function public.stock_ageing_analysis(date, uuid, uuid[]) from public, anon;
grant execute on function public.stock_ageing_analysis(date, uuid, uuid[]) to authenticated;
