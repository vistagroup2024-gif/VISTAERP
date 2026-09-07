-- The ERP runs on Saudi time.
--
-- Postgres was answering in UTC, so for the first three hours of every Saudi
-- day `current_date`, `now()::date` and `localtimestamp` were still on
-- YESTERDAY. A voucher saved at 01:00 in Riyadh was dated the previous day, a
-- report asked for "today" covered the wrong one, and the login window
-- (`is_staff()` reads the Saudi wall clock) opened and closed three hours late.
--
-- Setting the timezone on the roles rather than on the database means every
-- session — PostgREST, the cron endpoints, psql — starts in Asia/Riyadh
-- without anything having to remember to say so.
--
-- Nothing stored moves. A `timestamptz` is an absolute instant and only its
-- rendering changes; a `date` is a wall-clock day and is not converted at all.
-- Saudi Arabia has no daylight saving, so the offset is a flat +03 all year.

alter role authenticated set timezone = 'Asia/Riyadh';
alter role anon          set timezone = 'Asia/Riyadh';
alter role service_role  set timezone = 'Asia/Riyadh';
alter role postgres      set timezone = 'Asia/Riyadh';
