-- ROLLBACK for 316_close_acct_hold_document.sql.
--
-- Puts acct_hold_document back the way migration 306 left it — EXECUTE to
-- PUBLIC, which includes anon and authenticated.
--
-- Only run this if closing it is shown to have broken something. Nothing in the
-- app calls acct_hold_document directly: it is reached from inside gl_submit,
-- trade_doc_post and payroll_post, which are SECURITY DEFINER and run as the
-- owner, so the grant is not what lets them in.

grant execute on function public.acct_hold_document(uuid, text, date, text, text, numeric, integer, text, uuid, uuid)
  to public;
