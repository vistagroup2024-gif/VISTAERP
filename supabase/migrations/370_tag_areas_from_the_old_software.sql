-- Tag Areas from the old software.
--
-- SOURCE: Tag_Area.xlsx, "VISTA SAUDIA / Tree 01-01-2023 To 12-09-2026".
-- 129 rows, three levels, the tree carried in column-B indentation at five
-- spaces per level — the same export shape as the chart of accounts and the
-- product tree before it. No amounts: the other columns are all empty.
--
-- THIS EXPORT IS NOT TRUNCATED, which the last two were. The longest name is
-- 28 characters (REPAIR & MAINTENANCE EXPENSE) and nothing sits at 24 or 29,
-- the two lengths the chart and product exports cut at. So every name here is
-- whole and none of them wants editing by hand afterwards. There are no
-- duplicate names anywhere in the file either.
--
-- WHAT IT BUILDS: 8 groups and 121 leaves.
--
--   DRAWING EXPENSE      34   household and personal drawings
--   IQAMA                19   one per employee's iqama
--   QURBANI               3   SADQA / DUM / HAJJ
--   CAR TRADING          14   cars held for resale, by plate or colour
--   VEHICLES              2   VISTA TRANSPORT (4) + OUTSOURCE VEHICLES (8)
--   VISTA VEHICLES       37   the owned fleet, by plate
--
-- and two rows sitting loose at the TOP level with no group, which is how the
-- file has them and how they come in:
--
--   NONE          — see the warning below
--   SAQIB IQAMA   — plainly belongs under IQAMA with the other nineteen, but
--                   the old software has it at the top. It is imported where
--                   the file puts it rather than where it looks like it should
--                   go; guessing is how an import starts inventing. Select it
--                   and press "Move to group" to file it.
--
-- A TAG AREA NAMED "NONE" IS WORTH KNOWING ABOUT. The Ledger renders an
-- untagged line as "NONE" already (`r.tag_area ?? "NONE"` in LedgerReport), so
-- once this row exists a line deliberately tagged NONE and a line with no tag
-- at all read identically in that column. It is in the source and the old
-- software evidently used it, so it is imported; delete it if the blank is
-- what you want to mean "no tag".
--
-- NOTHING DEPENDS ON THESE NAMES IN CODE, which is why this is a safe import
-- to do in one go. Cost centres are the opposite — is_car_cost_center() names
-- 'CAR TRADING' and 'CAR SALES INSTALLMENT' as literals — but no routine and
-- no component names a tag area. Every picker reads the table and filters to
-- is_group = false and is_active = true, so the 8 group rows will not be
-- offered on a voucher; only the 121 leaves will. (The CAR TRADING here is a
-- tag area and has nothing to do with the cost centre of the same name; they
-- are different dimensions on different tables.)
--
-- Tag areas are stored on vouchers as TEXT, not as a reference, so the names
-- are the thing that matters and renaming one later does not follow the
-- vouchers already written. The table is EMPTY today (0 rows) and no journal
-- line or trade document carries a tag area yet, so there is nothing here to
-- collide with and no history to break.
--
-- Every node is FIND-OR-CREATE, scoped to its own parent, so running this twice
-- changes nothing the second time. `sort` is written in file order (10, 20,
-- 30 …) so the tree reads the way the old software listed it — and the ⤒ ↑ ↓ ⤓
-- buttons added in 369 can change that afterwards.

begin;

do $build$
declare
  v_co     uuid;
  v_line   text;
  v_parts  text[];
  v_depth  int;
  v_group  boolean;
  v_sort   int;
  v_name   text;
  v_stack  uuid[] := '{}';
  v_parent uuid;
  v_id     uuid;
  v_made   int := 0;
  v_found  int := 0;
begin
  select id into v_co from companies order by created_at limit 1;
  if v_co is null then raise exception '370: no company'; end if;

  for v_line in
    select unnest(string_to_array($DATA$
0|1|10|DRAWING EXPENSE
1|0|10|HOME SETUP
1|0|20|QURBANI EXPENSE
1|0|30|SCHOOL FEE EXPENSE
1|0|40|TRAVELLING EXPENSE
1|0|50|SHOPPING EXPENSE
1|0|60|CAR MAINTAINANCE
1|0|70|VEGATABLE EXPENSE
1|0|80|VIOLATION EXPENSE
1|0|90|CHICKEN EXPENSE
1|0|100|MEAT EXPENSE
1|0|110|FRUIT EXPENSE
1|0|120|REPAIR & MAINTENANCE EXPENSE
1|0|130|PERSONAL EXPENSE
1|0|140|CAR INSURANCE
1|0|150|LINE WATER EXPENSE
1|0|160|DRINKING WATER EXPENSE
1|0|170|MOBILE EXPENSE
1|0|180|INTERNET EXPENSE
1|0|190|HOTEL EXPENSE
1|0|200|MEDICAL EXPENSE
1|0|210|MAID SALARY
1|0|220|HOME RENOVATION
1|0|230|GIFTS
1|0|240|DINE OUT
1|0|250|GAS EXPENSE
1|0|260|GROCERY EXPENSE
1|0|270|ELECTRICITY EXPENSE
1|0|280|PETROL EXPENSE
1|0|290|VISA EXPENSE
1|0|300|HOUSE RENT
1|0|310|TRAIN TICKETS
1|0|320|AIR TICKETS
1|0|330|GUEST EXPENSE
1|0|340|MONTHLY DRAWING
0|1|20|IQAMA
1|0|10|ABDUL GAFFAR IQAMA
1|0|20|ASIM AHMED IQAMA
1|0|30|ABU ZAR IQAMA
1|0|40|MUZAMMIL IQAMA
1|0|50|MUHAMMAD BILAL IQAMA
1|0|60|MUHAMMAD ALI IQAMA
1|0|70|IMAM BAKHSH IQAMA
1|0|80|MUGHEES IQAMA
1|0|90|FAISAL IQAMA
1|0|100|MUHAMMAD REHAN IQAMA
1|0|110|ABDUL REHMAN IQAMA
1|0|120|ZAFAR IQAMA
1|0|130|FIAZ IQAMA
1|0|140|MUHAMMAD ABBAS AQAD AJEER
1|0|150|MUHAMMAD SALMAN IQAMA
1|0|160|RIAZ AHMED IQAMA
1|0|170|MUHAMMAD YOUSUF IQAMA
1|0|180|RAHAT NAZAR IQAMA
1|0|190|QAISAR IQAMA
0|1|30|QURBANI
1|0|10|SADQA QURBANI
1|0|20|DUM QURBANI
1|0|30|HAJJ QURBANI
0|1|40|CAR TRADING
1|0|10|STARIA 2022 SILVER
1|0|20|STAREX (167780)
1|0|30|PALISADE 2021 GREY
1|0|40|SONATA 2022 GREY
1|0|50|AZEERA 2022 SILVER
1|0|60|PALISADE 2021 BLUE
1|0|70|STAREX (47360)
1|0|80|STAREX (35970)
1|0|90|STAREX (154890)
1|0|100|STAREX (123107)
1|0|110|STARIA SILVER
1|0|120|STAREX ( 147421)
1|0|130|STAREX (132238)
1|0|140|STARIA (15841)
0|1|50|VEHICLES
1|1|10|VISTA TRANSPORT
2|0|10|STAREX (ATA 4086)
2|0|20|STARIA (STA 6390)
2|0|30|STAREX (KDA 6681)
2|0|40|STARIA ( LUXURY )
1|1|20|OUTSOURCE VEHICLES
2|0|10|TRAIN
2|0|20|CAMRY (OUT SOURCE)
2|0|30|HI ACE (outsource)
2|0|40|GMC ( OUT SOURCE )
2|0|50|STAREX (OUTSOURCE)
2|0|60|BUS
2|0|70|COASTER
2|0|80|STARIA ( OUTSOURCE)
0|1|60|VISTA VEHICLES
1|0|10|STARIA (XSA 2468)
1|0|20|STARIA (STA 6613)
1|0|30|STAREX (KDA 6680)
1|0|40|STAREX (HSA 1441)
1|0|50|STAREX (SXA 8182)
1|0|60|STARIA (STA 6610)
1|0|70|STARIA (STA 5596)
1|0|80|STARIA (UXA 6582)
1|0|90|STARIA (STA 6391)
1|0|100|STAREX (STA 5069)
1|0|110|STAREX (SXA 7323)
1|0|120|STARIA (ATA 3173)
1|0|130|STARIA ( STA 6861)
1|0|140|STARIA (BTA 9934)
1|0|150|STAREX (ATA 4398)
1|0|160|STARIA (STA 5940)
1|0|170|STARIA ( STA 5592 )
1|0|180|STARIA (ATA 4382)
1|0|190|STARIA (STA 6389)
1|0|200|STARIA (STA 5135)
1|0|210|STAREX (SSA 9315)
1|0|220|STAREX (SXA 7101)
1|0|230|STAREX (SXA 8183)
1|0|240|STAREX (KDA 6682)
1|0|250|STARIA (SXA 8449)
1|0|260|STARIA (USA 8676)
1|0|270|STAREX (SXA 7279)
1|0|280|STAREX (SXA 7022)
1|0|290|STARIA (USA 8675)
1|0|300|STAREX (KDA 6683)
1|0|310|STAREX (STA 5340)
1|0|320|STAREX (HSA 1375)
1|0|330|STAREX (SXA 7019)
1|0|340|STAREX (SXA 7020)
1|0|350|STAREX (USA 8460)
1|0|360|STARIA (USA 8486)
1|0|370|STAREX (USA 8677)
0|0|70|NONE
0|0|80|SAQIB IQAMA
$DATA$, E'\n'))
  loop
    if btrim(v_line) = '' then continue; end if;

    v_parts := string_to_array(v_line, '|');
    v_depth := v_parts[1]::int;
    v_group := v_parts[2] = '1';
    v_sort  := v_parts[3]::int;
    -- the name may itself contain nothing exotic, but join the tail back
    -- anyway rather than assuming exactly four fields
    v_name  := btrim(array_to_string(v_parts[4:array_length(v_parts,1)], '|'));
    if v_name = '' then raise exception '370: a row with no name: %', v_line; end if;

    -- the stack holds the id of the last node seen at each depth
    if v_depth = 0 then
      v_parent := null;
    else
      if array_length(v_stack, 1) < v_depth then
        raise exception '370: % is at depth % with no parent above it', v_name, v_depth;
      end if;
      v_parent := v_stack[v_depth];
    end if;

    select id into v_id from acct_tag_areas
     where company_id = v_co
       and parent_id is not distinct from v_parent
       and upper(btrim(name)) = upper(v_name);

    if v_id is null then
      insert into acct_tag_areas(company_id, parent_id, name, is_group, is_active, sort)
      values (v_co, v_parent, v_name, v_group, true, v_sort)
      returning id into v_id;
      v_made := v_made + 1;
    else
      v_found := v_found + 1;
    end if;

    -- remember it as the parent for the next deeper row, and forget anything
    -- deeper than this from a previous branch
    v_stack := v_stack[1:v_depth] || array[v_id];
  end loop;

  raise notice '370: % created, % already there', v_made, v_found;
end
$build$;

-- ---------------------------------------------------------------------------
-- Post-conditions. Each one is a way this could have gone wrong.
-- ---------------------------------------------------------------------------
do $chk$
declare
  v_co    uuid;
  v_total int;
  v_grp   int;
  v_leaf  int;
  v_n     int;
  v_bad   text;
  r       record;
begin
  select id into v_co from companies order by created_at limit 1;

  select count(*), count(*) filter (where is_group), count(*) filter (where not is_group)
    into v_total, v_grp, v_leaf from acct_tag_areas where company_id = v_co;
  if v_total <> 129 then raise exception '370: % rows, expected 129', v_total; end if;
  if v_grp   <> 8   then raise exception '370: % groups, expected 8', v_grp; end if;
  if v_leaf  <> 121 then raise exception '370: % leaves, expected 121', v_leaf; end if;

  -- the six top-level groups and their exact child counts, plus the two
  -- sub-groups under VEHICLES
  for r in
    select * from (values
      ('DRAWING EXPENSE', 34), ('IQAMA', 19), ('QURBANI', 3),
      ('CAR TRADING', 14), ('VEHICLES', 2), ('VISTA VEHICLES', 37),
      ('VISTA TRANSPORT', 4), ('OUTSOURCE VEHICLES', 8)
    ) as t(nm, kids)
  loop
    select count(*) into v_n
      from acct_tag_areas c
      join acct_tag_areas g on g.id = c.parent_id
     where g.company_id = v_co and upper(btrim(g.name)) = r.nm;
    if v_n <> r.kids then
      raise exception '370: % has % child(ren), expected %', r.nm, v_n, r.kids;
    end if;
  end loop;

  -- VISTA TRANSPORT and OUTSOURCE VEHICLES sit under VEHICLES, not at the top
  select count(*) into v_n
    from acct_tag_areas c
    join acct_tag_areas g on g.id = c.parent_id
   where g.company_id = v_co and upper(btrim(g.name)) = 'VEHICLES'
     and upper(btrim(c.name)) in ('VISTA TRANSPORT', 'OUTSOURCE VEHICLES')
     and c.is_group;
  if v_n <> 2 then raise exception '370: the two vehicle sub-groups are not under VEHICLES'; end if;

  -- the two loose top-level leaves came in as leaves, at the top
  select count(*) into v_n from acct_tag_areas
   where company_id = v_co and parent_id is null and not is_group
     and upper(btrim(name)) in ('NONE', 'SAQIB IQAMA');
  if v_n <> 2 then raise exception '370: NONE / SAQIB IQAMA are not top-level leaves'; end if;

  -- exactly 8 things at the top: 6 groups + those 2
  select count(*) into v_n from acct_tag_areas where company_id = v_co and parent_id is null;
  if v_n <> 8 then raise exception '370: % rows at the top level, expected 8', v_n; end if;

  -- no name repeated inside one parent, and nothing untrimmed or empty
  select string_agg(nm, ', ') into v_bad from (
    select upper(btrim(name)) as nm from acct_tag_areas where company_id = v_co
     group by parent_id, upper(btrim(name)) having count(*) > 1) d;
  if v_bad is not null then raise exception '370: duplicated within a parent: %', v_bad; end if;

  select count(*) into v_n from acct_tag_areas
   where company_id = v_co and (name <> btrim(name) or btrim(name) = '');
  if v_n <> 0 then raise exception '370: % name(s) untrimmed or blank', v_n; end if;

  -- nothing is truncated at the two lengths the earlier exports cut at
  select count(*) into v_n from acct_tag_areas
   where company_id = v_co and length(name) in (24, 29);
  if v_n <> 0 then
    raise exception '370: % name(s) are exactly 24 or 29 chars — check for truncation', v_n;
  end if;

  -- every row carries a sort, so the arrows have something to move
  select count(*) into v_n from acct_tag_areas where company_id = v_co and coalesce(sort,0) = 0;
  if v_n <> 0 then raise exception '370: % row(s) have no sort', v_n; end if;

  -- and this import touched NOTHING else
  select count(*) into v_n from accounts;
  if v_n <> 679 then raise exception '370: accounts moved to %, was 679', v_n; end if;
  select count(*) into v_n from acct_products;
  if v_n <> 290 then raise exception '370: products moved to %, was 290', v_n; end if;
  select count(*) into v_n from acct_cost_centers;
  if v_n <> 22 then raise exception '370: cost centres moved to %, was 22', v_n; end if;
  select count(*) into v_n from journal_entries;
  if v_n <> 0 then raise exception '370: % journal entr(ies) appeared', v_n; end if;
  select count(*) into v_n from stock_movements;
  if v_n <> 0 then raise exception '370: % stock movement(s) appeared', v_n; end if;
  select count(*) into v_n from parties;
  if v_n <> 305 then raise exception '370: parties moved to %, was 305', v_n; end if;

  raise notice '370 ok: % tag areas (% groups, % leaves)', v_total, v_grp, v_leaf;
end
$chk$;

commit;
