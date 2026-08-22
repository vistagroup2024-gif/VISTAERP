-- Per-trip pax (used by extra trips that carry fewer passengers than the whole booking).
-- transport_sync_trips now persists it. Full body applied via migration 189; the only
-- change vs the prior version is the new `pax` column being stored on insert/update.
alter table transport_trips add column if not exists pax integer;
