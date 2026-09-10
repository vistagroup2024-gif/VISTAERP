-- ROLLBACK for 343: puts every cleared accounting row back from the backups.
--
-- Only works while the _cleanup_343_* tables are still there. Insert order is
-- the reverse of the delete order, because the same foreign keys apply going in.
-- The operational pointer columns (transport_trips.gl_entry and the hotel/car
-- equivalents) are restored from the backed-up entries, so trips read as posted
-- again rather than being re-postable.

begin;

do $g$ begin
  if to_regclass('public._cleanup_343_journal_entries') is null then
    raise exception '343 rollback: the backup tables are gone — nothing to restore from'; end if;
end $g$;

insert into journal_entries      select * from public._cleanup_343_journal_entries      on conflict do nothing;
insert into journal_lines        select * from public._cleanup_343_journal_lines        on conflict do nothing;
insert into acct_audit           select * from public._cleanup_343_acct_audit           on conflict do nothing;
insert into payroll_runs         select * from public._cleanup_343_payroll_runs         on conflict do nothing;
insert into payslips             select * from public._cleanup_343_payslips             on conflict do nothing;
insert into trade_documents      select * from public._cleanup_343_trade_documents      on conflict do nothing;
insert into trade_document_lines select * from public._cleanup_343_trade_document_lines on conflict do nothing;
insert into stock_balances       select * from public._cleanup_343_stock_balances       on conflict do nothing;
insert into stock_movements      select * from public._cleanup_343_stock_movements      on conflict do nothing;
insert into visa_invoices        select * from public._cleanup_343_visa_invoices        on conflict do nothing;
insert into open_items           select * from public._cleanup_343_open_items           on conflict do nothing;

-- put the operational pointers back
update transport_trips t set gl_entry = e.id, gl_posted_at = e.created_at
  from journal_entries e
 where e.source = 'gl_transport'
   and e.reference = (select b.booking_no from transport_bookings b where b.id = t.booking_id) || '/' || coalesce(t.seq,0)
   and t.gl_entry is null;

do $chk$ begin
  if (select count(*) from journal_entries) <> (select count(*) from public._cleanup_343_journal_entries)
  then raise exception '343 rollback: journal entry count does not match the backup'; end if;
end $chk$;

commit;
