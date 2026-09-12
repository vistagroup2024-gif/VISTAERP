-- Rollback of 370 — removes the tag areas imported from Tag_Area.xlsx.
--
-- IT REFUSES IF ANY OF THEM IS SPOKEN FOR, and there are three ways that can
-- happen. Tag areas are stored on vouchers as TEXT rather than as a reference,
-- so nothing in the database would stop these rows being deleted out from
-- under a voucher that names one — the check has to be written by hand:
--
--   journal_lines.tag_area     a posted line carrying the name
--   trade_documents.tag_area   a voucher header carrying the name
--   staff_scopes               a user restricted to one by id
--
-- The import ran when all three were empty. If they are not empty by the time
-- this is run, the tag area is in use and deleting it would leave a voucher
-- naming something that no longer exists.
--
-- Identification is by created_at inside the import's own transaction: every
-- row 370 made carries that one timestamp, because created_at defaults to
-- now() and now() is the transaction's start. That is also why this will not
-- touch a tag area added by hand afterwards.

begin;

do $rb$
declare
  v_ts  timestamptz;
  v_n   int;
  v_bad text;
  v_ids uuid[];
begin
  -- the import's timestamp is whatever the bulk of the table carries
  select created_at into v_ts from acct_tag_areas
   group by created_at order by count(*) desc limit 1;
  if v_ts is null then raise notice '370 rollback: no tag areas to remove'; return; end if;

  select count(*), array_agg(id) into v_n, v_ids
    from acct_tag_areas where created_at = v_ts;
  if v_n < 100 then
    raise exception '370 rollback: only % row(s) share that timestamp — that is not the import, refusing', v_n;
  end if;

  select string_agg(distinct t.name, ', ') into v_bad
    from acct_tag_areas t
   where t.id = any(v_ids)
     and (exists (select 1 from journal_lines jl    where btrim(jl.tag_area) = btrim(t.name))
       or exists (select 1 from trade_documents d   where btrim(d.tag_area)  = btrim(t.name))
       or exists (select 1 from staff_scopes s      where s.ref_id = t.id));
  if v_bad is not null then
    raise exception '370 rollback: these are in use on a voucher or a user restriction: %', v_bad;
  end if;

  -- children before parents
  delete from acct_tag_areas where id = any(v_ids) and not is_group;
  delete from acct_tag_areas where id = any(v_ids);

  select count(*) into v_n from acct_tag_areas where created_at = v_ts;
  if v_n <> 0 then raise exception '370 rollback: % row(s) left', v_n; end if;

  raise notice '370 rollback ok: tag areas removed';
end
$rb$;

commit;
