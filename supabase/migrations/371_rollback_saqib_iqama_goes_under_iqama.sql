-- Rollback of 371 — puts SAQIB IQAMA back at the top level, where the
-- Tag_Area.xlsx export had it.
--
-- Its old sort was 80, which is what 370 gave it as the eighth row at the top.
-- Nothing else is touched. A tag area is stored on vouchers as TEXT, so moving
-- this row either way cannot orphan a voucher — the name does not change.

begin;

do $rb$
declare v_co uuid; v_id uuid; v_n int;
begin
  select id into v_co from companies order by created_at limit 1;

  select id into v_id from acct_tag_areas
   where company_id = v_co and upper(btrim(name)) = 'SAQIB IQAMA';
  if v_id is null then raise exception '371 rollback: there is no SAQIB IQAMA'; end if;

  update acct_tag_areas set parent_id = null, sort = 80 where id = v_id;

  select count(*) into v_n from acct_tag_areas
   where company_id = v_co and parent_id is null;
  if v_n <> 8 then raise exception '371 rollback: % rows at the top level, expected 8', v_n; end if;

  select count(*) into v_n from acct_tag_areas c
    join acct_tag_areas g on g.id = c.parent_id
   where upper(btrim(g.name)) = 'IQAMA';
  if v_n <> 19 then raise exception '371 rollback: IQAMA has % children, expected 19', v_n; end if;

  raise notice '371 rollback ok: SAQIB IQAMA is back at the top';
end
$rb$;

commit;
