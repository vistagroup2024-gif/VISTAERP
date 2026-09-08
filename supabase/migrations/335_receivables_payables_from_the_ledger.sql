-- The dashboard was understating what the business is owed by three quarters.
--
-- Receivables and Payables were read from `open_items` — the invoice and bill
-- subsystem. But a car sale, a visa invoice, a transport charge and a hotel
-- booking all debit the customer's account DIRECTLY and never create an open
-- item. Nineteen accounts carried a receivable balance; eight of them were
-- represented. So the card said:
--
--     Receivable    47,505.00      really    199,133.48
--     Payable        5,546.50      really    113,301.55
--     Net           41,958.50      really     85,831.93
--
-- Both now come off the ledger, which is the only place that knows all of it.
-- Overdue still comes from open_items, because only an open item carries a due
-- date — it is a floor on what is late, not the whole of it, and the card's
-- description says so.
--
-- `open_items` was also being read with NO COMPANY FILTER. One company today,
-- so it changed nothing, but it would have quietly summed every company's
-- balances into one number the day a second was added.
--
-- Found by checking each dashboard figure against an independent query rather
-- than by reading the code — the same sweep confirmed every other card on both
-- dashboard_metrics and dashboard_module_metrics matches its source exactly.

do $mig$
declare
  v_def text; v_new text; i_start int; i_end int;
  new_cte constant text := $cte$  open_ar_ap as (
    -- Receivable and Payable come off the LEDGER, not off open_items.
    -- open_items only knows the invoices and bills raised through that path; a
    -- car sale, a visa invoice or a transport charge debits the customer's
    -- account directly and never creates one.
    select
      (select coalesce(sum(g.debit - g.credit), 0) from gl g where g.subtype = 'Receivable') as ar,
      (select coalesce(sum(g.credit - g.debit), 0) from gl g where g.subtype = 'Payable') as ap,
      -- Only an open item carries a due date, so overdue is only what the
      -- invoice and bill subsystem knows. It is a floor, not all that is late.
      coalesce(sum(o.outstanding_base) filter (where o.direction = 'D' and o.due_date < current_date), 0) as ar_overdue,
      coalesce(sum(o.outstanding_base) filter (where o.direction = 'C' and o.due_date < current_date), 0) as ap_overdue
    from open_items o
    where o.status = 'open' and o.company_id = (select id from co)
  ),
$cte$;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'dashboard_metrics';

  if v_def like '%g.subtype = ''Receivable''%' then
    raise notice 'Already applied.'; return;
  end if;

  i_start := position('  open_ar_ap as (' in v_def);
  i_end   := position('  td as (' in v_def);
  if i_start = 0 or i_end = 0 or i_end <= i_start then
    raise exception 'Cannot locate the open_ar_ap block.';
  end if;
  if (select count(*) from regexp_matches(v_def, '  open_ar_ap as \(', 'g')) <> 1
     or (select count(*) from regexp_matches(v_def, '  td as \(', 'g')) <> 1 then
    raise exception 'A boundary appears more than once — refusing to cut blind.';
  end if;
  if position('  gl as (' in v_def) = 0 or position('  gl as (' in v_def) > i_start then
    raise exception 'The gl CTE is not defined before open_ar_ap.';
  end if;

  v_new := substring(v_def for i_start - 1) || new_cte || substring(v_def from i_end);

  if v_new not like '%as ar,%' or v_new not like '%as ap,%'
     or v_new not like '%as ar_overdue,%' or v_new not like '%as ap_overdue%' then
    raise exception 'The replacement lost one of the four figures.';
  end if;

  execute v_new;
  raise notice 'Receivables and payables now read the ledger.';
end $mig$;
