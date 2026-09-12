-- SAQIB IQAMA goes under IQAMA, where it belongs.
--
-- The Tag_Area.xlsx export had it sitting loose at the top level, and 370
-- imported it where the file put it rather than where it looked like it should
-- go — an import that starts correcting its source stops being an import. This
-- is the correction, made separately and on purpose, so the two are not
-- confused with each other: 370 says what the old software had, 371 says what
-- was asked for afterwards.
--
-- It is filed LAST among the twenty, at sort 200, because the nineteen already
-- there run 10 to 190 and this one was not in that list. Use the ⤒ ↑ ↓ ⤓
-- buttons to put it somewhere else in the order.
--
-- Nothing else moves, and nothing is renamed. A tag area is stored on vouchers
-- as TEXT, so re-parenting a row cannot orphan anything: the name is what a
-- voucher carries and the name has not changed.

begin;

do $mv$
declare
  v_co     uuid;
  v_iqama  uuid;
  v_saqib  uuid;
  v_kids   int;
begin
  select id into v_co from companies order by created_at limit 1;

  select id into v_iqama from acct_tag_areas
   where company_id = v_co and is_group and upper(btrim(name)) = 'IQAMA';
  if v_iqama is null then raise exception '371: there is no IQAMA group'; end if;

  select id into v_saqib from acct_tag_areas
   where company_id = v_co and upper(btrim(name)) = 'SAQIB IQAMA';
  if v_saqib is null then raise exception '371: there is no SAQIB IQAMA'; end if;

  if v_saqib = v_iqama then raise exception '371: those are the same row'; end if;

  update acct_tag_areas
     set parent_id = v_iqama,
         sort      = 200
   where id = v_saqib;

  select count(*) into v_kids from acct_tag_areas where parent_id = v_iqama;
  raise notice '371: IQAMA now has % children', v_kids;
end
$mv$;

do $chk$
declare
  v_co uuid; v_n int; v_parent text; v_sort int;
begin
  select id into v_co from companies order by created_at limit 1;

  -- it is under IQAMA, and last
  select g.name, c.sort into v_parent, v_sort
    from acct_tag_areas c join acct_tag_areas g on g.id = c.parent_id
   where c.company_id = v_co and upper(btrim(c.name)) = 'SAQIB IQAMA';
  if v_parent is null then raise exception '371: SAQIB IQAMA still has no parent'; end if;
  if upper(btrim(v_parent)) <> 'IQAMA' then
    raise exception '371: SAQIB IQAMA is under %, not IQAMA', v_parent;
  end if;
  if v_sort <> 200 then raise exception '371: its sort is %, expected 200', v_sort; end if;

  -- IQAMA has twenty now
  select count(*) into v_n from acct_tag_areas c
    join acct_tag_areas g on g.id = c.parent_id
   where g.company_id = v_co and upper(btrim(g.name)) = 'IQAMA';
  if v_n <> 20 then raise exception '371: IQAMA has % children, expected 20', v_n; end if;

  -- the top level lost exactly that one row: 8 became 7
  select count(*) into v_n from acct_tag_areas where company_id = v_co and parent_id is null;
  if v_n <> 7 then raise exception '371: % rows at the top level, expected 7', v_n; end if;

  -- NONE is still the only loose leaf up there
  select count(*) into v_n from acct_tag_areas
   where company_id = v_co and parent_id is null and not is_group;
  if v_n <> 1 then raise exception '371: % loose top-level leaves, expected just NONE', v_n; end if;

  -- nothing was added, removed or renamed
  select count(*) into v_n from acct_tag_areas where company_id = v_co;
  if v_n <> 129 then raise exception '371: % tag areas, expected 129', v_n; end if;
  select count(*) into v_n from acct_tag_areas where company_id = v_co and is_group;
  if v_n <> 8 then raise exception '371: % groups, expected 8', v_n; end if;

  -- no name repeated inside IQAMA now that there are twenty
  select count(*) into v_n from (
    select upper(btrim(c.name)) nm from acct_tag_areas c
      join acct_tag_areas g on g.id = c.parent_id
     where upper(btrim(g.name)) = 'IQAMA'
     group by upper(btrim(c.name)) having count(*) > 1) d;
  if v_n <> 0 then raise exception '371: % duplicated name(s) inside IQAMA', v_n; end if;

  raise notice '371 ok: SAQIB IQAMA is the twentieth iqama';
end
$chk$;

commit;
