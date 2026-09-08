-- Due and Overdue were counting the same instalment twice.
--
-- The Car Customer Balances card shows four figures, and two of them overlapped:
--
--   Due      unpaid instalments dated ANYWHERE in the current calendar month,
--            including days already gone
--   Overdue  unpaid instalments dated before TODAY
--
-- So an instalment dated earlier this month and still unpaid was in both. On
-- production, CI-000003's first instalment was due 8 September; at 00:45 on 9
-- September it appeared as 6,833.34 Due AND 6,833.34 Overdue, reading as though
-- 13,666.68 was at stake when it was half that. It had been overdue for
-- forty-five minutes.
--
-- The two are now disjoint, and the boundary is the one the business uses:
-- AN INSTALMENT IS OVERDUE ONCE THE MONTH IT WAS DUE IN HAS ENDED. This month's
-- instalment stays Due for the whole month however far past its date, which is
-- how a monthly instalment is actually chased — nobody calls a customer overdue
-- on the 9th for something dated the 8th.
--
--   Due      = unpaid, due date inside this month     (unchanged)
--   Overdue  = unpaid, due date before this month     (was: before today)
--
-- Due + Overdue is now everything owed up to the end of this month, with
-- nothing counted twice, and both stay subsets of Outstanding.
--
-- The service-charge card is deliberately NOT changed. Its three figures do not
-- overlap the same way: "this month" there is what was BILLED this month, not
-- what is owed, and its overdue is a plain subset of outstanding.
--
-- The one line is changed in the live definition rather than the whole of
-- dashboard_metrics being retyped — it is a long function and copying it to
-- alter twenty characters is how the rest of it gets changed by accident. The
-- patch refuses unless it finds exactly its anchor and changes exactly that.

do $$
declare
  v_def text; v_new text;
  anchor constant text := 'and i.due_date < current_date), 0) as overdue,';
  repl   constant text := 'and i.due_date < (select month_start from bounds)), 0) as overdue,';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'dashboard_metrics';
  if v_def is null then
    raise exception 'dashboard_metrics is not there.';
  end if;

  if position(repl in v_def) > 0 then
    raise notice 'Already applied — Due and Overdue are separate.';
    return;
  end if;

  -- exactly one occurrence, or the anchor is not what it was
  if (select count(*) from regexp_matches(v_def,
        'and i\.due_date < current_date\), 0\) as overdue,', 'g')) <> 1 then
    raise exception 'Expected exactly one car-instalment overdue rule to change.';
  end if;

  v_new := replace(v_def, anchor, repl);
  if length(v_new) - length(v_def) <> 20 then
    raise exception 'The patch changed % characters, not the 20 it should.',
      length(v_new) - length(v_def);
  end if;

  execute v_new;
  raise notice 'Car instalments are overdue once their month has ended.';
end $$;

-- ---------------------------------------------------------------------------
-- Second pass, after the first was still wrong on two counts.
--
-- DUE STARTS ON THE DUE DATE, NOT ON THE FIRST OF ITS MONTH. Due was every
-- unpaid instalment dated anywhere in this month, so one dated the 20th was
-- already "due" on the 1st. It is due when its date arrives:
--     Due     = unpaid, due date has arrived, its month has not ended
--     Overdue = unpaid, its month has ended
-- Still disjoint, and now neither counts money that is not yet askable for.
--
-- OUTSTANDING WAS NOT OUTSTANDING. It summed the instalment schedule, but the
-- schedule is not what the customer owes: the advance is on the invoice and not
-- in the schedule. CI-000003 scheduled 82,000 against a real ledger balance of
-- 123,000 (122,000 car + 1,000 service charge). It is the customers' LEDGER
-- balance now, read off their accounts — which is only possible because 331 put
-- car receivables on the customer's own account instead of a control bucket.
--
-- The card gains a Total (Due + Overdue), which is safe to add precisely
-- because the two no longer overlap.
--
-- Applied as three exact anchored replacements against the live definition; see
-- migration 334's earlier note on why this function is not retyped.

-- ---------------------------------------------------------------------------
-- Third pass. Two more things the card was not saying.
--
-- THE ADVANCE IS DUE TOO. It has its own date (car_contracts.advance_due_date)
-- and is paid by a receipt allocated to it, but it lives outside the instalment
-- schedule — so it appeared nowhere. CI-000003's 40,000 was due on 8 September
-- and the card showed only the 6,833.34 instalment. Due is 46,833.34.
--
-- AND THE MONTHLY SERVICE CHARGE IS THE SAME MONEY. It is owed by the same
-- customer against the same car, so it is folded in rather than kept on a card
-- of its own; the separate "Car Monthly Charges" card is gone. Seeing charges
-- alone is a report by cost centre, not a second tile saying a third of the
-- story.
--
-- All three now flow through one car_due_items list — instalment, advance,
-- service charge, each with the date it became askable — and one rule buckets
-- them. That is also why Total is safe: nothing can be in two buckets.
--
-- The whole car_money block is replaced by position (from its own start to the
-- next CTE) rather than by matching its old text, after checking each boundary
-- appears exactly once. dashboard_metrics is far too long to retype.
