-- Car Expense becomes one sheet per vehicle, not one voucher per line.
--
-- The screen made you pick a vehicle every single time, even the second
-- expense on the same car — registration today, insurance next week, customs
-- the week after, each one its own trip through the vehicle picker, with
-- nothing on screen to say the car already had three expenses on it. The
-- accounting was always right (car_expense_save already keys everything off
-- vehicle_id and posts each line the moment it is known, which is correct —
-- a customs bill that arrives before the car does has to post then, not wait
-- for a batch), so nothing here changes what gets posted. It changes what the
-- user has to do to post it: pick the vehicle once, land on that car's own
-- expense sheet, and every "+ Add Expense" after that no longer asks.
--
-- The one thing the screen could not do without help from SQL is tell a
-- vehicle with expenses already on it apart from one that has none — the old
-- flat table was 500 rows across every car, and finding "does CAR-000042
-- already have a line" in it client-side would have meant reading the whole
-- table, which is exactly the trap the 1000-row note in CLAUDE.md warns about.
-- car_expense_vehicle_summary() answers it in SQL instead, aggregated once per
-- vehicle: how many lines, their total, and the most recent date. The
-- landing page uses it to split the picker (vehicles with nothing booked yet)
-- from a "vehicles with expenses" list (open the sheet, add another line) —
-- the same "unhide, don't rebuild" instinct as the rest of this codebase,
-- just applied to a picker instead of a screen.

create or replace function car_expense_vehicle_summary()
returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(x order by last_date desc), '[]'::jsonb) from (
    select
      jsonb_build_object(
        'vehicle_id', v.id,
        'label', concat_ws(' · ',
                   coalesce(nullif(concat_ws(' ', v.make, v.model, v.model_year::text), ''), pr.name),
                   coalesce(v.plate_no, v.vehicle_no)),
        'status', v.status::text,
        'cost', coalesce(v.total_cost, 0),
        'count', s.n,
        'total', s.amt,
        'last_date', s.last_date) as x,
      s.last_date
    from (
      select vehicle_id, count(*) as n, sum(amount) as amt, max(expense_date) as last_date
      from car_vehicle_expenses
      where company_id = auth_company_id()
      group by vehicle_id
    ) s
    join car_vehicles v on v.id = s.vehicle_id
    left join acct_products pr on pr.id = coalesce(v.product_id, v.source_product_id)
  ) t
  where is_staff();
$function$;

revoke all on function car_expense_vehicle_summary() from public, anon;
grant execute on function car_expense_vehicle_summary() to authenticated;
