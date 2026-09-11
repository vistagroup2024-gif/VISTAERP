-- A Delivery Note says the goods LEFT. It does not say they ARRIVED.
--
-- The two are separate events in every ERP that handles physical goods — SAP,
-- Oracle, Odoo and Tally all keep a dispatch document and a proof of delivery —
-- because the gap between them is real. A car can sit on a transporter for a
-- week between the note being raised and the customer taking the keys.
--
-- Until now the ERP only had the first. That was tolerable while nothing
-- depended on the second; it stops being tolerable now, because the Monthly
-- Service Charge is meant to start when the customer HAS the car, not when the
-- paperwork was typed. Billing a customer from the wrong one of those two dates
-- charges them for a month they did not have the vehicle.
--
-- So: a tick and a date on the note itself, not a second document. One
-- confirmation is what the other systems add, and adding a whole screen for a
-- checkbox would be the wrong trade.
--
-- delivered_date is a DATE, not a timestamp, and it is the user's to set rather
-- than defaulting to "when the tick was pressed". The tick often goes on days
-- after the fact, and the charge is prorated by the day of the month, so a
-- delivered_date that quietly meant "when somebody remembered" would bill the
-- wrong month. It defaults to today only as a starting value on the screen.

begin;

alter table public.trade_documents
  add column if not exists delivered      boolean not null default false,
  add column if not exists delivered_date date,
  add column if not exists delivered_by   uuid references public.profiles(id) on delete set null,
  add column if not exists delivered_at   timestamptz;

-- A delivered note must say WHEN. Without this, `delivered` could be true with
-- no date, and the proration rule would have nothing to work from.
alter table public.trade_documents
  drop constraint if exists trade_documents_delivered_needs_a_date;
alter table public.trade_documents
  add constraint trade_documents_delivered_needs_a_date
  check (not delivered or delivered_date is not null);

-- How the service-charge run finds "when did this customer get the car".
create index if not exists trade_documents_delivered_car_idx
  on public.trade_documents (source_car_contract, delivered_date)
  where delivered and source_car_contract is not null;

comment on column public.trade_documents.delivered is
  'The customer actually received the goods. Distinct from the note existing, which only says they were dispatched.';

-- ── the tick ───────────────────────────────────────────────────────────────
create or replace function public.trade_doc_mark_delivered(
  p_id uuid, p_delivered boolean, p_date date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $f$
declare d trade_documents; v_co uuid; v_date date;
begin
  if not is_staff() then raise exception 'Not signed in'; end if;
  v_co := auth_company_id();

  select * into d from trade_documents where id = p_id and company_id = v_co;
  if not found then raise exception 'Document not found'; end if;
  if d.doc_type <> 'delivery_note' then
    raise exception 'Only a Delivery Note records a delivery';
  end if;

  -- Marking delivered is editing the note, so it takes the same right, the same
  -- entered-by-somebody-else rule and the same authorised rule as any other
  -- change to it.
  perform staff_require_trade_right(p_id, 'edit');

  if p_delivered then
    v_date := coalesce(p_date, d.delivered_date, current_date);
    if v_date > current_date then
      raise exception 'A delivery cannot be dated in the future';
    end if;
    if v_date < d.doc_date then
      raise exception 'The goods cannot have arrived before the note that sent them (%)', d.doc_date;
    end if;
    update trade_documents
       set delivered = true, delivered_date = v_date,
           delivered_by = auth.uid(), delivered_at = now(), updated_at = now()
     where id = p_id;
  else
    -- Clearing the date with the tick, so a note cannot sit un-delivered while
    -- still carrying the date it was delivered on.
    update trade_documents
       set delivered = false, delivered_date = null,
           delivered_by = null, delivered_at = null, updated_at = now()
     where id = p_id;
  end if;

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_co, auth.uid(),
          case when p_delivered then 'delivery_confirmed' else 'delivery_unconfirmed' end,
          'trade_document', p_id,
          jsonb_build_object('doc_no', d.doc_no, 'delivered_date', v_date,
                             'car_contract', d.source_car_contract));

  return jsonb_build_object('ok', true, 'delivered', p_delivered, 'delivered_date', v_date);
end $f$;
revoke all on function public.trade_doc_mark_delivered(uuid, boolean, date) from public, anon;
grant execute on function public.trade_doc_mark_delivered(uuid, boolean, date) to authenticated;

-- ── when did this customer get their car ───────────────────────────────────
-- The one place that answers it, so the service-charge run and any screen that
-- wants to show it cannot arrive at different dates. Definer on purpose: the
-- monthly run has to see every contract's delivery, not only the ones the
-- caller's product restrictions would show.
create or replace function public.car_contract_delivered_on(p_contract uuid)
returns date
language sql
stable security definer
set search_path to 'public'
as $f$
  select min(delivered_date) from trade_documents
   where source_car_contract = p_contract and delivered and delivered_date is not null;
$f$;
revoke all on function public.car_contract_delivered_on(uuid) from public, anon;
grant execute on function public.car_contract_delivered_on(uuid) to authenticated;

-- ── and the screen has to be able to SEE it ────────────────────────────────
-- trade_doc_get is what the voucher screen opens a document with. A column the
-- table has but this routine does not return is a column the screen cannot show
-- — the tick would read as un-delivered on every note, whatever was recorded.
create or replace function public.trade_doc_get(p_id uuid)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  select case when d.id is null then null else jsonb_build_object(
    'id', d.id, 'doc_type', d.doc_type, 'doc_no', d.doc_no, 'doc_date', d.doc_date, 'party_id', d.party_id,
    'party_name', (select name from parties p where p.id = d.party_id),
    'cost_center', d.cost_center, 'tag_area', d.tag_area, 'reference', d.reference, 'narration', d.narration,
    'terms', d.terms, 'mode_of_payment', d.mode_of_payment, 'due_date', d.due_date, 'delivery_date', d.delivery_date,
    'currency', d.currency, 'round_off', d.round_off, 'subtotal', d.subtotal, 'total', d.total, 'status', d.status, 'meta', d.meta,
    'gl_entry', d.gl_entry, 'warehouse_id', d.warehouse_id,
    'delivered', d.delivered, 'delivered_date', d.delivered_date,
    'delivered_by_name', (select full_name from profiles p where p.id = d.delivered_by),
    'source_doc_id', d.source_doc_id, 'source_car_contract', d.source_car_contract,
    'source_doc_no', coalesce(
      (select s.doc_no from trade_documents s where s.id = d.source_doc_id),
      (select c.contract_no from car_contracts c where c.id = d.source_car_contract)),
    'source_doc_type', (select s.doc_type from trade_documents s where s.id = d.source_doc_id),
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'product_id', l.product_id, 'item_name', l.item_name, 'units', l.units, 'quantity', l.quantity,
        'rate', l.rate, 'amount', l.amount, 'link1', l.link1, 'meta', l.meta) order by l.sort)
      from trade_document_lines l where l.doc_id = d.id), '[]'::jsonb)
  ) end
  from trade_documents d where d.id = p_id and d.company_id = auth_company_id();
$function$;

do $chk$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='trade_documents' and column_name='delivered_date')
  then raise exception '347: delivered_date is missing'; end if;
  if exists (select 1 from trade_documents where delivered and delivered_date is null)
  then raise exception '347: a note is delivered with no date'; end if;
  if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='trade_doc_get') not like '%delivered_date%'
  then raise exception '347: trade_doc_get does not return the delivery'; end if;
end $chk$;

commit;
