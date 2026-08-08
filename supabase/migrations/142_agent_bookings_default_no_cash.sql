-- 142 Agency bookings default to No Cash regardless of party_type. Some agencies are
-- stored as party_type 'customer', so classify by name: only the walk-in "CASH
-- CUSTOMER" party and direct (no-agent) bookings are Cash. Only rewrites auto-set
-- values (null / cash), preserving any manually chosen method.
update transport_bookings b set payment_method = 'no_cash'
  from parties p
  where p.id = b.agent_id
    and upper(trim(p.name)) <> 'CASH CUSTOMER'
    and (b.payment_method is null or b.payment_method = 'cash');
update transport_bookings set payment_method = 'cash' where payment_method is null;
