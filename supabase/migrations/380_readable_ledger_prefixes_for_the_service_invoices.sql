-- 380 — Readable ledger prefixes for the four service invoices.
--
-- The ledger entry behind a trade document is numbered from its own sequence
-- (gl_trade_<type>). The four service invoices had none seeded, so gl_post
-- fell back to the ambiguous 'GL_-' for the transport ones raised on the
-- 14th. Seeded readable, in the family of JPV- / JSI- / JSR- / JPR-, and the
-- fallback row repaired.
begin;
insert into doc_sequences(company_id, doc_type, prefix)
select c.id, t.doc_type, t.prefix
  from companies c cross join (values
    ('gl_trade_air_ticket_invoice', 'JAT-'),
    ('gl_trade_visa_invoice',       'JVI-'),
    ('gl_trade_transport_invoice',  'JTI-'),
    ('gl_trade_hotel_invoice',      'JHI-')) t(doc_type, prefix)
on conflict (company_id, doc_type) do update set prefix = excluded.prefix where doc_sequences.prefix = 'GL_-';
do $$
begin
  if exists (select 1 from doc_sequences where doc_type like 'gl_trade_%' and prefix = 'GL_-') then
    raise exception '380: a gl_trade sequence still carries the fallback prefix';
  end if;
end $$;
commit;
