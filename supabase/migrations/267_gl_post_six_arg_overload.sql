-- 267_gl_post_six_arg_overload.sql
-- Seven call sites across six functions call gl_post with six arguments, but
-- gl_post takes seven (company, date, memo, doc_type, source, reference, lines)
-- and has no defaults — so the call does not resolve and the function raises
--   function gl_post(uuid, date, unknown, unknown, unknown, jsonb) does not exist
-- the moment it is reached. Broken today:
--
--   payroll_post           posting a payroll run to the GL
--   visa_invoice_post      posting a visa invoice
--   visa_group_post_gl     posting visa cost (called from visa_group_autopost,
--                          which swallows exceptions — so this failed silently)
--   transport_trip_post_gl posting a completed trip
--   commission_accrue      accruing sales commission
--   stock_move             the stock receipt and stock issue postings
--
-- This is the same bug already fixed in trade_doc_post (migration 262).
--
-- Rather than rewrite six long function bodies, give gl_post the six-argument
-- signature those callers assume. It is a legitimate convenience form — a
-- voucher's source is its doc_type unless it says otherwise, which is exactly
-- what the seven-argument callers pass anyway. The seven-argument version has no
-- default parameters, so the two signatures can never be ambiguous.
create or replace function gl_post(
  p_company uuid, p_date date, p_memo text, p_doc_type text, p_reference text, p_lines jsonb
) returns jsonb language sql security definer set search_path = public as $$
  select gl_post(p_company, p_date, p_memo, p_doc_type, p_doc_type, p_reference, p_lines);
$$;

grant execute on function gl_post(uuid, date, text, text, text, jsonb) to authenticated;
