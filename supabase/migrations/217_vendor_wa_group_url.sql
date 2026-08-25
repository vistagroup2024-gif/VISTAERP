-- Supplier vendors have their own WhatsApp dispatch group; a vendor-driver is an
-- individual and gets trip details directly on their own number.
alter table transport_vendors add column if not exists wa_group_url text;
