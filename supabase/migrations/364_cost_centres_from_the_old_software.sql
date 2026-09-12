-- The cost centre tree from the old software.
--
-- Six groups, sixteen cost centres inside them and QURBANI on its own at the
-- top, exactly as the old screen lists them:
--
--   SERVICE CHARGES   MONTHLY CAR SERVICE CHARGES, OTHER SERVICES,
--                     YUSRA COMPANY, WORK VISA
--   TRANSPORT         VISTA TRANSPORT
--   UMRAH PACKAGE     MAIN UMRAH PACKAGE, OUTSOURCE TRANSPORT, HOTEL,
--                     AIR TICKET, UMRAH VISA
--   TRADING           CAR SALES INSTALLMENT, CAR TRADING, DATES, TEXTILE
--   MAINS             MAIN
--   RENTAL            CAR RENTAL
--   QURBANI           (a cost centre, not a group)
--
-- Four of them already exist as loose top-level entries — CAR SALES INSTALLMENT,
-- CAR TRADING, OUTSOURCE TRANSPORT and VISTA TRANSPORT. They are MOVED into
-- their group, not re-created, and their names are not touched. That is not
-- tidiness, it is the only safe option:
--
--   * A cost centre is stored on a voucher and on a journal line as TEXT, not
--     as a reference. Rename one and every document carrying the old spelling
--     is pointing at nothing, silently.
--   * is_car_cost_center() hard-codes 'CAR SALES INSTALLMENT' and 'CAR TRADING',
--     and so does CAR_COST_CENTERS in lib/tradeDocs.ts. Those two names are how
--     the ERP knows to show the car costing block and to route a car purchase to
--     Vehicle Inventory. They are not free to change here.
--   * FOUR LIVE INVOICE AUTOMATION RULES match a cost centre by name, and one of
--     them names 'OUTSOURCE TRANSPORT'. The old screen spells it "OUT SOURCE
--     TRANSPORT", with a space. Renaming it to match the screenshot would leave
--     that rule pointing at a cost centre that no longer exists, and an
--     automation rule that quietly stops matching is the worst kind of broken.
--     So the existing spelling wins and the screenshot's spelling does not get
--     applied. Renaming the cost centre and the rule that names it together, in
--     one transaction, is the way to do it — but not as a side effect of
--     building a tree.
--
-- IT ALSO REPAIRS TWO DANGLING REFERENCES. Automation rules already name HOTEL
-- and UMRAH VISA as their cost centre and neither existed as a cost centre at
-- all — the rules were matching on a name nothing in the master held. Both are
-- in the screenshot and both are created here, so those two rules now point at
-- something real. The check at the end proves every name an automation rule
-- uses resolves to a live, selectable cost centre.
--
-- The six groups show as headings on Masters -> Cost Centers and are NOT
-- offered on a voucher: every picker in the ERP already reads
-- `.eq("is_group", false)`. A group is a place to file things, not a thing to
-- post to.

begin;

do $cc$
declare
  v_co uuid;
  v_grp uuid;
  v_sort int := 0;
  v_created int := 0; v_moved int := 0;
  -- group name -> the leaves under it, in screen order
  v_tree jsonb := jsonb_build_array(
    jsonb_build_object('g', 'SERVICE CHARGES', 'kids', jsonb_build_array(
      'MONTHLY CAR SERVICE CHARGES', 'OTHER SERVICES', 'YUSRA COMPANY', 'WORK VISA')),
    jsonb_build_object('g', 'TRANSPORT', 'kids', jsonb_build_array(
      'VISTA TRANSPORT')),
    jsonb_build_object('g', 'UMRAH PACKAGE', 'kids', jsonb_build_array(
      'MAIN UMRAH PACKAGE', 'OUTSOURCE TRANSPORT', 'HOTEL', 'AIR TICKET', 'UMRAH VISA')),
    jsonb_build_object('g', 'TRADING', 'kids', jsonb_build_array(
      'CAR SALES INSTALLMENT', 'CAR TRADING', 'DATES', 'TEXTILE')),
    jsonb_build_object('g', 'MAINS', 'kids', jsonb_build_array(
      'MAIN')),
    jsonb_build_object('g', 'RENTAL', 'kids', jsonb_build_array(
      'CAR RENTAL'))
  );
  g jsonb; k text; v_kid uuid; v_ksort int;
begin
  select company_id into v_co from profiles p
    join user_roles ur on ur.user_id = p.id where ur.role = 'admin' limit 1;
  if v_co is null then raise exception '364: no company to build the tree in'; end if;

  for g in select * from jsonb_array_elements(v_tree) loop
    v_sort := v_sort + 10;

    -- the group: found by name or made
    select id into v_grp from acct_cost_centers
     where company_id = v_co and upper(btrim(name)) = upper(g->>'g');
    if v_grp is null then
      insert into acct_cost_centers(company_id, name, is_group, is_active, sales_target, sort, parent_id)
      values (v_co, g->>'g', true, true, 0, v_sort, null)
      returning id into v_grp;
      v_created := v_created + 1;
    else
      update acct_cost_centers
         set is_group = true, parent_id = null, sort = v_sort
       where id = v_grp;
    end if;

    v_ksort := 0;
    for k in select jsonb_array_elements_text(g->'kids') loop
      v_ksort := v_ksort + 10;
      select id into v_kid from acct_cost_centers
       where company_id = v_co and upper(btrim(name)) = upper(k);
      if v_kid is null then
        insert into acct_cost_centers(company_id, name, is_group, is_active, sales_target, sort, parent_id)
        values (v_co, k, false, true, 0, v_ksort, v_grp);
        v_created := v_created + 1;
      else
        -- MOVED, never renamed: the name is what vouchers and automation rules
        -- carry, so only its place in the tree changes.
        update acct_cost_centers
           set parent_id = v_grp, is_group = false, is_active = true, sort = v_ksort
         where id = v_kid and parent_id is distinct from v_grp;
        if found then v_moved := v_moved + 1; end if;
      end if;
    end loop;
  end loop;

  -- QURBANI sits at the top of the tree as a cost centre in its own right
  v_sort := v_sort + 10;
  if not exists (select 1 from acct_cost_centers
                  where company_id = v_co and upper(btrim(name)) = 'QURBANI') then
    insert into acct_cost_centers(company_id, name, is_group, is_active, sales_target, sort, parent_id)
    values (v_co, 'QURBANI', false, true, 0, v_sort, null);
    v_created := v_created + 1;
  end if;

  raise notice '364: created %, moved %', v_created, v_moved;
end $cc$;

do $chk$
declare v_co uuid; v_n int; v_t text; v_bad text;
begin
  select company_id into v_co from profiles p
    join user_roles ur on ur.user_id = p.id where ur.role='admin' limit 1;

  -- 1. the shape is the screen's shape
  select count(*) into v_n from acct_cost_centers where company_id=v_co;
  if v_n <> 23 then raise exception '364: % cost centres, expected 23', v_n; end if;
  select count(*) into v_n from acct_cost_centers where company_id=v_co and is_group;
  if v_n <> 6 then raise exception '364: % groups, expected 6', v_n; end if;

  -- 2. every group holds what the screen says it holds
  for v_t, v_n in
    select g, n from (values
      ('SERVICE CHARGES', 4), ('TRANSPORT', 1), ('UMRAH PACKAGE', 5),
      ('TRADING', 4), ('MAINS', 1), ('RENTAL', 1)) as t(g, n)
  loop
    if (select count(*) from acct_cost_centers c
         where c.company_id = v_co
           and c.parent_id = (select id from acct_cost_centers p
                               where p.company_id = v_co and upper(btrim(p.name)) = v_t)) <> v_n
    then raise exception '364: % does not hold % cost centre(s)', v_t, v_n; end if;
  end loop;

  -- 3. QURBANI is a top-level cost centre, not a group
  if not exists (select 1 from acct_cost_centers where company_id=v_co
                  and upper(btrim(name))='QURBANI' and not is_group and parent_id is null)
  then raise exception '364: QURBANI is not a top-level cost centre'; end if;

  -- 4. THE TWO NAMES THE CODE HARD-CODES ARE UNCHANGED, and still selectable
  for v_t in select unnest(array['CAR SALES INSTALLMENT','CAR TRADING']) loop
    if not exists (select 1 from acct_cost_centers
                    where company_id=v_co and name = v_t and not is_group and is_active)
    then raise exception '364: "%" was renamed or hidden — is_car_cost_center() reads it by name', v_t; end if;
    if not is_car_cost_center(v_t) then
      raise exception '364: is_car_cost_center() no longer recognises "%"', v_t;
    end if;
  end loop;

  -- 5. EVERY cost centre an automation rule names must resolve to a live,
  -- selectable cost centre. Two of them did not before this migration.
  select string_agg(distinct r.cost_center, ', ') into v_bad
    from acct_automation_rules r
   where r.cost_center is not null
     and not exists (select 1 from acct_cost_centers c
                      where c.company_id = v_co and not c.is_group and c.is_active
                        and upper(btrim(c.name)) = upper(btrim(r.cost_center)));
  if v_bad is not null then
    raise exception '364: automation rule(s) name a cost centre that does not exist: %', v_bad;
  end if;

  -- 6. no cost centre lost a name, and the tree is a tree
  if exists (select 1 from acct_cost_centers where company_id=v_co and coalesce(btrim(name),'') = '')
  then raise exception '364: a cost centre has no name'; end if;
  select count(*) into v_n from acct_cost_centers c
   where c.parent_id is not null
     and not exists (select 1 from acct_cost_centers p where p.id = c.parent_id);
  if v_n <> 0 then raise exception '364: % orphaned cost centre(s)', v_n; end if;
  select count(*) into v_n from acct_cost_centers c
   where c.parent_id is not null and (select is_group from acct_cost_centers p where p.id=c.parent_id) = false;
  if v_n <> 0 then raise exception '364: % cost centre(s) sit inside something that is not a group', v_n; end if;

  -- 7. nothing was posted and no voucher lost its cost centre
  select count(*) into v_n from journal_entries;
  if v_n <> 0 then raise exception '364: % journal entry(ies) appeared', v_n; end if;
  select count(*) into v_n from trade_documents t
   where t.cost_center is not null
     and not exists (select 1 from acct_cost_centers c
                      where c.company_id = v_co and upper(btrim(c.name)) = upper(btrim(t.cost_center)));
  if v_n <> 0 then raise exception '364: % document(s) now name a cost centre that is gone', v_n; end if;

  raise notice '364: 23 cost centres, 6 groups, every automation rule resolves';
end $chk$;

commit;
