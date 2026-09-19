-- A posted trade voucher (Purchase Voucher and every other one built on
-- TradeVoucher.tsx) is locked behind one Save button: postedLock() disables
-- it unless the user holds "Edit/Delete Posted" AND trade_doc_unpost can
-- actually reverse it — which it correctly refuses once stock has moved on
-- (issued from a later document) or a later document has already loaded from
-- this one. That refusal is right: quantity, rate, party, the lines
-- themselves are all tied to stock and the ledger, and changing them after
-- the fact means reversing and redoing real postings.
--
-- Cost Centre and Tag Area are not tied to any of that — they are reporting
-- attribution, copied once into specific journal_lines when the document
-- posts (trade_doc_post_now) and never read back off trade_documents again.
-- So the same all-or-nothing lock that correctly protects quantity and
-- amount was also blocking a plain relabel that touches neither stock nor
-- how much anything is worth, with no way through short of the full
-- unpost/repost cycle — which is exactly the cycle that refuses when stock
-- has already moved on, the very case this is for.
--
-- trade_doc_set_attribution() is the lighter door: it updates
-- trade_documents.cost_center/tag_area directly, gated by the ordinary
-- 'edit' right (staff_require_trade_right — the same right an unposted edit
-- already needs, not the special 'edit_posted' right posted vouchers usually
-- need), and never touches trade_doc_unpost/trade_doc_post_now at all. If
-- the document is posted, it also corrects the matching journal_lines so a
-- report reading the ledger (P&L, Expense Report, Tag Area Costing) doesn't
-- keep showing the label that was just corrected — otherwise the fix would
-- look applied on the voucher and be invisible everywhere a number is
-- actually read from.
--
-- Which journal_lines those are isn't written down anywhere per doc type
-- (trade_doc_post_now decides it inline, differently for a Purchase Voucher's
-- one payable line than a Sales Invoice's sale line plus its COGS line), and
-- duplicating that per-type knowledge here would be exactly the "written
-- down three times" trap the document-chain design elsewhere in this schema
-- exists to avoid. So this reads it back off the ledger instead: a line
-- currently carrying the OLD (cost_center, tag_area) pair together is a line
-- the header put it on. Matched as a pair, not per field, because two
-- unrelated lines (a Sales Invoice's sale line and its COGS line) can share
-- a bare cost_center with no tag_area at all — matching cost_center alone
-- would catch both and mislabel the COGS line. The correction only runs when
-- EXACTLY ONE line matches; more than one (that ambiguous case) or none
-- leaves the ledger as it was and says so in the return value, rather than
-- guessing.

create or replace function public.trade_doc_set_attribution(p_id uuid, p_cost_center text, p_tag_area text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_co uuid := auth_company_id();
  d trade_documents%rowtype;
  v_cc text; v_ta text; v_match_count int; v_synced boolean := false;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;

  select * into d from trade_documents where id = p_id and company_id = v_co;
  if not found then raise exception 'Document not found'; end if;
  if d.status = 'awaiting_approval' then
    raise exception 'This voucher is awaiting authorisation and cannot be changed.';
  end if;

  perform staff_require_trade_right(p_id, 'edit');

  v_cc := nullif(btrim(coalesce(p_cost_center, '')), '');
  v_ta := nullif(btrim(coalesce(p_tag_area, '')), '');

  update trade_documents set cost_center = v_cc, tag_area = v_ta, updated_at = now()
   where id = p_id and company_id = v_co;

  if d.gl_entry is not null and (v_cc is distinct from d.cost_center or v_ta is distinct from d.tag_area) then
    select count(*) into v_match_count from journal_lines
     where entry_id = d.gl_entry
       and cost_center is not distinct from d.cost_center
       and tag_area is not distinct from d.tag_area;
    if v_match_count = 1 then
      update journal_lines set cost_center = v_cc, tag_area = v_ta
       where entry_id = d.gl_entry
         and cost_center is not distinct from d.cost_center
         and tag_area is not distinct from d.tag_area;
      v_synced := true;
    end if;
  end if;

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_co, auth.uid(), 'trade_doc_attribution_edited', 'trade_document', p_id,
          jsonb_build_object('doc_no', d.doc_no, 'doc_type', d.doc_type,
                              'cost_center_was', d.cost_center, 'cost_center_now', v_cc,
                              'tag_area_was', d.tag_area, 'tag_area_now', v_ta,
                              'posted', d.gl_entry is not null, 'ledger_synced', v_synced));

  return jsonb_build_object('cost_center', v_cc, 'tag_area', v_ta,
                             'posted', d.gl_entry is not null, 'ledger_synced', v_synced);
end $function$;

revoke all on function public.trade_doc_set_attribution(uuid, text, text) from public, anon;
grant execute on function public.trade_doc_set_attribution(uuid, text, text) to authenticated;
