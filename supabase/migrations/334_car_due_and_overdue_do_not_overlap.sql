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
