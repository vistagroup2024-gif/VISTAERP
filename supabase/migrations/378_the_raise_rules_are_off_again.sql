-- 378 — The three raise rules are off again.
--
-- Migration 377 switched on the automation rules that raise the Visa,
-- Transport and Hotel invoices. That was not asked for: the request was for
-- the invoices to be vouchers that CAN be raised automatically, and whether
-- the rules are on is the business's decision on Accounting → Automation, as
-- it is for every other rule there. Applied to production by hand the moment
-- it was raised; kept here so the repo says what the database does.
begin;
update acct_automation_rules set enabled = false, updated_at = now()
 where rule_key in ('visa.group_created', 'transport.trip_completed', 'hotel.vendor_confirmed') and kind = 'trigger';
commit;
