-- Undo 347. The columns are dropped, which loses every delivery confirmation
-- recorded through them — there is nowhere else that fact is written down. Do
-- not run this once deliveries have been confirmed and service charges billed
-- from them, or the charges will have been raised from a date the ERP can no
-- longer show.

begin;

drop function if exists public.car_contract_delivered_on(uuid);
drop function if exists public.trade_doc_mark_delivered(uuid, boolean, date);
drop index if exists public.trade_documents_delivered_car_idx;

alter table public.trade_documents
  drop constraint if exists trade_documents_delivered_needs_a_date;

alter table public.trade_documents
  drop column if exists delivered_at,
  drop column if exists delivered_by,
  drop column if exists delivered_date,
  drop column if exists delivered;

commit;
