-- Add new sellable service types (separate migration: new enum values
-- cannot be used in the same transaction that adds them).
alter type service_type add value if not exists 'insurance';
alter type service_type add value if not exists 'ziyarat';
