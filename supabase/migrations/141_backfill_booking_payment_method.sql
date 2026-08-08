-- 141 Backfill transport_bookings.payment_method so the trip-completion cash-received
-- prompt keys off it. Legacy rows were null (field was hidden for agents). B2B-agent
-- bookings are credit (No Cash); customers / direct bookings are Cash.
update transport_bookings b set payment_method = 'no_cash'
  from parties p
  where p.id = b.agent_id and p.party_type = 'b2b_agent' and b.payment_method is null;
update transport_bookings set payment_method = 'cash' where payment_method is null;
