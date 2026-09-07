-- The trade vouchers navigate by the same numeric sequence as the GL ones.

create or replace function trade_doc_nav(p_type text, p_id uuid, p_dir text)
returns uuid language plpgsql stable security definer set search_path to 'public' as $function$
declare v_no text; v_seq numeric; v_id uuid; v_co uuid := auth_company_id();
begin
  if p_id is not null then
    select doc_no, coalesce(doc_no_seq(doc_no), 0) into v_no, v_seq
      from trade_documents where id = p_id and company_id = v_co;
  end if;
  if p_dir = 'prev' then
    select id into v_id from trade_documents
      where company_id = v_co and doc_type = p_type
        and (v_no is null or (coalesce(doc_no_seq(doc_no), 0), doc_no) < (v_seq, v_no))
      order by coalesce(doc_no_seq(doc_no), 0) desc, doc_no desc limit 1;
  else
    select id into v_id from trade_documents
      where company_id = v_co and doc_type = p_type
        and (v_no is null or (coalesce(doc_no_seq(doc_no), 0), doc_no) > (v_seq, v_no))
      order by coalesce(doc_no_seq(doc_no), 0) asc, doc_no asc limit 1;
  end if;
  return v_id;
end $function$;

revoke all on function trade_doc_nav(text, uuid, text) from public, anon;
grant execute on function trade_doc_nav(text, uuid, text) to authenticated;
