-- Amount to collect from the passenger (cash), which may differ from the trip fare
-- (e.g. an agent asks us to collect 250 on a 200 trip). NULL = collect the fare.
-- transport_save_booking persists collect_amount (see migration 190b in repo history).
alter table transport_bookings add column if not exists collect_amount numeric;
