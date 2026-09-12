-- The Product Tree from the old software.
--
-- SOURCE: Product_Tree.xlsx, "VISTA SAUDIA / Tree 01-06-2026 To 12-09-2026".
-- 296 rows, two levels, the tree in the indentation of one column. No prices —
-- the amount columns of that export are empty — so this is names and structure.
--
-- THE EXPORT TRUNCATES NAMES AND THAT CANNOT BE UNDONE HERE. A child is cut at
-- 24 characters and a top-level row at 29, which is why the file says
-- "HYNDAI PALISADE 2021 BLU", "ANWAR AL MADINAH MOVENPI",
-- "Saja Makkah (Ex Le Méridien T" and ": Makkah Hotel - Madinah Hote". The full
-- names are not in the file. They come in as they are and want editing by hand;
-- inventing the missing characters would be worse.
--
-- 149 OF THE 296 ROWS SAT LOOSE AT THE TOP of the old tree with no group —
-- individual hotels, individual routes, and a few strays. They are filed by kind
-- here, as asked: anything that reads as a hotel under HOTEL, anything that
-- reads as a journey under TRAVEL ROUTE, the remainder under a new OTHER group.
-- That is a classification from a truncated name, so some will be in the wrong
-- place and want moving — 70 went to HOTEL, 56 to TRAVEL ROUTE, 22 to OTHER,
-- and six the classifier read wrongly were corrected by hand first (Badr Al
-- Massa Hotel, Rama Al Madinah and Tara Al Yasmin are hotels, not routes;
-- "Madinah + Bader Zyarat" and "Masjid E Ayesha" are journeys; UMRAH GUIDE is
-- neither).
--
-- NOTHING THAT ALREADY HAS A PRICE IS TOUCHED, and that is the one thing this
-- migration must not get wrong. Six items in the tree today carry real money:
--
--   UMRAH VISA (10 DAYS)      440 / 480
--   UMRAH VISA (15 DAYS)      440 / 490
--   UMRAH VISA (LONG STAY)    530 / 580
--   UMRAH VISA (MASAR)        440 / 460
--   UMRAH VISA (NON MASAR)    440 / 500
--   HYNDAI STARIA 2022 BLACK  80,000 purchase + 20,000 expense = 100,000
--
-- and visa_pick_product() resolves a visa invoice's line BY THE EXACT NAME of
-- the first five. Every node is found-or-created and a match is left completely
-- alone — not renamed, not re-priced, not moved. The check at the end re-reads
-- all six figures and calls visa_pick_product for all five visa types.
--
-- WHAT THE NAME MATCHING ACTUALLY DID, measured after the fact rather than
-- predicted. Matching ignores punctuation, case and a trailing S, and that
-- turned out to matter more than expected:
--
--   * "UMRAH VISA LONG STAY" in the file matched the PRICED
--     "UMRAH VISA (LONG STAY)" once the brackets were stripped, so it was
--     reused rather than added as a second unpriced copy. I had written in this
--     header that it would come in separately; it did not, and the better
--     outcome is the one that happened.
--   * Three further pairs collapsed to one item each on the same rule, all of
--     them the file disagreeing with itself: "MAK-MED-BADR Ziyarats" with
--     "MAK-MED-BADR Ziyarat", "JED-MAK-MED-MAK-JED" with
--     "JED - MAK - MED -MAK- JED", and "Consumables" with "Consumable".
--   * Five duplicate SIBLINGS in the file were already collapsed before this
--     ran — four vehicles whose names became identical once truncated, and one
--     route listed twice. They were distinct physical things in the old system
--     and there is nothing left in the export to tell them apart.
--
--   So 296 source rows become 10 groups and 274 new items: 8 rows collapsed as
--   the file's own duplicates, 5 matched something already here, and the rest
--   are new. 290 products in the tree afterwards.
--
-- HYNDAI STARIA 2022 BLACK IS DELIBERATELY IN TWO PLACES. The file lists it
-- under TRADING VEHICLES and again under VEHICLES — a car held for trading and
-- one in the fleet are different things in that system. The priced one keeps its
-- 100,000 under TRADING VEHICLE; the fleet one is a new, unpriced item. The
-- check names the priced one by its purchase rate for exactly this reason: an
-- earlier version of it read `select total_cost ... where name = ...`, found two
-- rows and aborted the whole migration. That is the check doing its job.
--
-- TRADING VEHICLES reuses the existing TRADING VEHICLE group: a trailing S is
-- ignored when matching, so the two systems' habit of disagreeing about plurals
-- does not double the group. The group keeps its existing singular name.
--
-- EVERYTHING COMES IN AS NON-STOCK, which is what the tree already is: there is
-- not one stock item in it today and not one stock movement driven by it. A
-- hotel night, a route and a visa are services; a car moves as a car_vehicles
-- row, not as inventory. Tick Stock Item on the ones that really are goods —
-- the dates, the textiles — when you want them in a warehouse.

begin;

create or replace function public._pt_norm(p text)
returns text language sql immutable set search_path to 'public' as $f$
  select case when right(x,1) = 'S' and length(x) > 1 then left(x, length(x)-1) else x end
  from (select btrim(regexp_replace(regexp_replace(upper(coalesce(p,'')),
                 '[^A-Z0-9 ]', ' ', 'g'), '\s+', ' ', 'g')) as x) q;
$f$;

do $pt$
declare
  v_rows text := $DATA$
G|10|TRADING VEHICLES
A|TRADING VEHICLES|HYNDAI STARIA 2022 BLACK
A|TRADING VEHICLES|HYNDAI STAREX 2020 BLACK
A|TRADING VEHICLES|HYNDAI SONATA 2022 GREY
A|TRADING VEHICLES|HYNDAI PALISADE 2021 BLU
A|TRADING VEHICLES|HYNDAI PALISADE 2021 GRE
A|TRADING VEHICLES|HYNDAI AZEERA 2022 SILVE
A|TRADING VEHICLES|HYNDAI STAREX 2020 SILVE
A|TRADING VEHICLES|HYNDAI STAREX 2021 SILVE
A|TRADING VEHICLES|HYNDAI STAREX 2021 WHITE
A|TRADING VEHICLES|HYNDAI STAREX 2020 WHITE
A|TRADING VEHICLES|HYNDAI STARIA 2022 SILVE
G|20|VEHICLES
A|VEHICLES|HYNDAI STAREX 2020 BLACK
A|VEHICLES|HYNDAI STAREX 2021 SILVE
A|VEHICLES|HYNDAI STAREX 2020 SILVE
A|VEHICLES|HYNDAI STARIA 2023 WHITE
A|VEHICLES|HYNDAI STARIA 2023 SILVE
A|VEHICLES|HYNDAI STARIA 2023 GREY
A|VEHICLES|HYNDAI STARIA 2023 BLACK
A|VEHICLES|HYNDAI STARIA 2025 BLACK
A|VEHICLES|HYNDAI STARIA 2024 SILVE
A|VEHICLES|HYNDAI STAREX 2021 BLUE
A|VEHICLES|HYNDAI STARIA 2022 GREY
A|VEHICLES|HYNDAI STARIA 2022 WHITE
A|VEHICLES|HYNDAI STARIA 2024 GREY
A|VEHICLES|HYNDAI STARIA 2024 WHITE
A|VEHICLES|HYNDAI STAREX 2020 WHITE
A|VEHICLES|HYNDAI STARIA 2022 SILVE
A|VEHICLES|HYNDAI STAREX 2020 BLUE
A|VEHICLES|HYNDAI STARIA 2025 SILVE
A|VEHICLES|HYNDAI STAREX 2021 WHITE
A|VEHICLES|HYNDAI STAREX 2021 BLACK
A|VEHICLES|HYNDAI STARIA 2022 BLACK
G|30|SERVICE VEHICLES
A|SERVICE VEHICLES|NUSUK REGISTER
A|SERVICE VEHICLES|MAKKAH PERMIT
A|SERVICE VEHICLES|TEST VEHICLE
G|40|HOTEL
A|HOTEL|Maysan Al Mashaer
A|HOTEL|Conrad Makkah
A|HOTEL|SAJA AL MADINAH
A|HOTEL|ARTAL INTERNATIONAL
A|HOTEL|ELAF AJYAD
A|HOTEL|ARAKAN AL MANAR
A|HOTEL|GRAND PLAZA BADAR AL MAQ
A|HOTEL|SAFWAT AL MADINAH
A|HOTEL|RUA AL HIJRAH
A|HOTEL|PULLMAN ZAMZAM MAKKAH
A|HOTEL|DOUBLETREE
A|HOTEL|KISWA TOWER
A|HOTEL|ANWAR AL MADINAH MOVENPI
A|HOTEL|MADINAH HILTON
A|HOTEL|HYATT REGENCY
A|HOTEL|Mukhtara Golden Madinah
A|HOTEL|DAR AL TAQWA
A|HOTEL|MARRIOTT JABAL OMAR
A|HOTEL|TAIBA FRONT MADINAH
A|HOTEL|SKYVIEW
A|HOTEL|ZILAL ALNUZALA
A|HOTEL|SHAZA REGENCY
A|HOTEL|SWISSOTEL MAKKAH
A|HOTEL|GRAND ZOWAR
A|HOTEL|GRAND PLAZA AL MADINAH H
A|HOTEL|MADEN MADINAH
A|HOTEL|Mysk Touch Madinah
A|HOTEL|FAJAR AL BADEA
A|HOTEL|VIOLET HOTEL
A|HOTEL|DURRAT UL EIMAN
A|HOTEL|MOVENPICK MAKKAH HAJAR T
A|HOTEL|MAKKAH HOTEL
A|HOTEL|Gulnar Taiba Hotel
A|HOTEL|VOCO MAKKAH
A|HOTEL|Casa Diora Jeddah
A|HOTEL|Saja Hotel Makkah (Ex Le
A|HOTEL|Waqf Outhman Bin Affan M
A|HOTEL|LE MERIDIEN TOWER MAKKAH
A|HOTEL|Tara Al Yasmin
A|HOTEL|Rama Al Madinah
A|HOTEL|Shaza Al Munawarah
A|HOTEL|Miramar Hotel
A|HOTEL|Rafa Hotel
A|HOTEL|Gadern Inn Hotel Suites
A|HOTEL|Ritz Al Madina Hotel
A|HOTEL|Saja Makkah Ex Le Meridien
A|HOTEL|Saja Makkah (Ex Le Méridien T
A|HOTEL|Al Hayatt International
A|HOTEL|Al Ansar Golden Tulip
A|HOTEL|Worth Peninsula Hotel
A|HOTEL|Nuzul Al Jawad Al Adham
A|HOTEL|Nama Mawaddah Hotel
A|HOTEL|Rua International Hotel
A|HOTEL|Concorde Hotel Dar Al Khair
A|HOTEL|Nusk Al Eiman Hotel
A|HOTEL|Al Safwa Tower 3
A|HOTEL|Dar Al Eimna Al Haram
A|HOTEL|Dar Al Eiman Al Haram
A|HOTEL|Al Safwah Orchid
A|HOTEL|The ODST Hotel Madinah
A|HOTEL|Address Jabal Omer
A|HOTEL|DOUBLETREE BY HILTON
A|HOTEL|Millennium Taiba Hotel
A|HOTEL|Dallah Taibah Hotel
A|HOTEL|Makkah Tower Hotel
A|HOTEL|Nawarat Al Shams 3
A|HOTEL|Funduq Bilal Makkah
A|HOTEL|Bir Al Eiman
A|HOTEL|Roudah Al Mokhtara
A|HOTEL|Al Safwah Tower 3
A|HOTEL|Rua AL Khair
A|HOTEL|Maysan Al Maqam Makkah
A|HOTEL|Comfort Hotel Riyadh Olaya
A|HOTEL|Al Safwa Royal Orchid
A|HOTEL|Province Al Sham Madinah
A|HOTEL|ODST Hotel
A|HOTEL|OLYAN AL KHALIL
A|HOTEL|KAYAN INTERNATIONAL
A|HOTEL|Royal Majestic Hotel
A|HOTEL|Emaar Grand Hotel
A|HOTEL|Hotel BRN
A|HOTEL|HOTELL
A|HOTEL|Astoneast Taiba Hotel
A|HOTEL|Andalus Golden Palace
A|HOTEL|Millennium Al Aqeeq
A|HOTEL|Anjum Hotel Makkah
A|HOTEL|Holiday Inn Makkah
A|HOTEL|Kunuz Taqwa
A|HOTEL|Hilton Convention Hotel
A|HOTEL|Hilton Convention
A|HOTEL|Hilton Suites
A|HOTEL|Hilton Suites Makkah
A|HOTEL|Emaar Andalusia Makkah
A|HOTEL|Radisson Blu Jeddah Corniche
A|HOTEL|Makarem Burj Al Madinah
A|HOTEL|Al Marwa Rayhaan By Rotana
A|HOTEL|Zowar International
A|HOTEL|AL Kiswah Tower
A|HOTEL|Swissotel Al Maqam
A|HOTEL|Swissotel Al Maqam Makkah
A|HOTEL|Park Inn Radisson Aziziyah Ma
A|HOTEL|Marawa Rayhaan By Rotana
A|HOTEL|Taiba Front Hotel
A|HOTEL|Al Safwah Tower 1
A|HOTEL|Peninsula Worth Hotel Madinah
A|HOTEL|Jayden Hotel Madinah
A|HOTEL|Winner Inn Al Rabeh
A|HOTEL|Badr Al Massa Hotel
G|50|TRAVEL ROUTE
A|TRAVEL ROUTE|Taif Ziyarat
A|TRAVEL ROUTE|Jeddah - Madinah
A|TRAVEL ROUTE|Riyadh - Jeddah
A|TRAVEL ROUTE|Madinah - Hail
A|TRAVEL ROUTE|Jeddah - Riyadh
A|TRAVEL ROUTE|Makkah - Taif Airport
A|TRAVEL ROUTE|Taif Airport - Makkah
A|TRAVEL ROUTE|Jeddah Hotel - Airport
A|TRAVEL ROUTE|Makkah Ziyarat
A|TRAVEL ROUTE|Madinah - Riyadh
A|TRAVEL ROUTE|Jeddah Airport - Makkah
A|TRAVEL ROUTE|Riyadh - Makkah
A|TRAVEL ROUTE|Makkah - Riyadh
A|TRAVEL ROUTE|Badar Ziyarat
A|TRAVEL ROUTE|Madinah - Makkah Via Bad
A|TRAVEL ROUTE|Makkah - Madinah Via Bad
A|TRAVEL ROUTE|Riyadh - Madinah
A|TRAVEL ROUTE|Makkah - Makkah
A|TRAVEL ROUTE|Makkah Hotel - Jeddah Ai
A|TRAVEL ROUTE|Madinah Hotel - Jeddah A
A|TRAVEL ROUTE|Madinah - Madinah
A|TRAVEL ROUTE|Makkah Hotel - Madinah H
A|TRAVEL ROUTE|Jeddah Tour
A|TRAVEL ROUTE|Madinah Hotel - Station
A|TRAVEL ROUTE|Makkah Hotel - Station
A|TRAVEL ROUTE|Makkah Station - Hotel
A|TRAVEL ROUTE|Jeddah - Yanbu
A|TRAVEL ROUTE|Madinah Station - Hotel
A|TRAVEL ROUTE|Madinah Hotel - Makkah H
A|TRAVEL ROUTE|Madinah Ziyarat
A|TRAVEL ROUTE|Madinah Hotel - Madinah
A|TRAVEL ROUTE|Madinah Airport - Madina
A|TRAVEL ROUTE|Jeddah Airport - Madinah
A|TRAVEL ROUTE|Masjid E Ayesha
A|TRAVEL ROUTE|Madinah + Bader Zyarat
A|TRAVEL ROUTE|Jeddah Airport - Jeddah Hotel
A|TRAVEL ROUTE|Al Ula Tour
A|TRAVEL ROUTE|Full Day Transport
A|TRAVEL ROUTE|Makkah Hotel - Abha
A|TRAVEL ROUTE|Abha - Jeddah
A|TRAVEL ROUTE|MAK-MED-BADR Ziyarats
A|TRAVEL ROUTE|MAK-MED-BADR Ziyarat
A|TRAVEL ROUTE|JED-MAK-MED-MAK-JED
A|TRAVEL ROUTE|Jeddah Airport - Taif Hotel
A|TRAVEL ROUTE|Taif Hotel - Makkah Hotel
A|TRAVEL ROUTE|Madinah Hotel - Jeddah City
A|TRAVEL ROUTE|Madinah Hotel - Jeddah Hotel
A|TRAVEL ROUTE|: Makkah Hotel - Madinah Hote
A|TRAVEL ROUTE|Madina Airport - Madina Hotel
A|TRAVEL ROUTE|JED-MAK-MED-MED APT
A|TRAVEL ROUTE|Jeddah Hotel - Makkah Hotel
A|TRAVEL ROUTE|Makkah Hotel - Jeddah Hotel
A|TRAVEL ROUTE|Jeddah - Makkah - Jeddah
A|TRAVEL ROUTE|Jeddah - Makkah - Taif Jeddah
A|TRAVEL ROUTE|JED-MAK-TAIF-MAK
A|TRAVEL ROUTE|OUTSOURCE TRANSPORT
A|TRAVEL ROUTE|TRANSPORT
A|TRAVEL ROUTE|Mak - Mad -mak
A|TRAVEL ROUTE|Med - Mak - Med
A|TRAVEL ROUTE|JED - MAK - MED
A|TRAVEL ROUTE|Makkah Ziyarat + Madinah Drop
A|TRAVEL ROUTE|Jeddah + Taif Tour
A|TRAVEL ROUTE|MAK - MED - MAK
A|TRAVEL ROUTE|MED - JED - MAK - MED
A|TRAVEL ROUTE|Riyadh Airport - Hotel
A|TRAVEL ROUTE|Riyadh Hotel - Airport
A|TRAVEL ROUTE|Riyadh Hotel - Dammam Airport
A|TRAVEL ROUTE|Madinah Airport To Al Ula
A|TRAVEL ROUTE|Madinah - Al Ula
A|TRAVEL ROUTE|Train Station Via Meeqat
A|TRAVEL ROUTE|Train Station -
A|TRAVEL ROUTE|Train Station - Makkah
A|TRAVEL ROUTE|Hajj Transport
A|TRAVEL ROUTE|RUH - MAK - JED
A|TRAVEL ROUTE|RUH - TAIF - JED
A|TRAVEL ROUTE|Riyadh - Dammam
A|TRAVEL ROUTE|Dammam - Riyadh
A|TRAVEL ROUTE|Other - Hajj Transport
A|TRAVEL ROUTE|Madinah Hotel - Makkah Hotel
A|TRAVEL ROUTE|MED APT - MED HTL - MAK - MED
A|TRAVEL ROUTE|Jeddah Airport - Jeddah City
A|TRAVEL ROUTE|MAK-MED-MAK-JED APT
A|TRAVEL ROUTE|Other - Jeddah Hotel To Jedda
A|TRAVEL ROUTE|Makkah - Taif Return
A|TRAVEL ROUTE|Madinah - Jeddah Hotel
A|TRAVEL ROUTE|Makkah - Jeddah Tour + Hotel
A|TRAVEL ROUTE|JED - MAK - MED - JED
A|TRAVEL ROUTE|JED - MAK - MED -MAK- JED
A|TRAVEL ROUTE|JED APT HAJJ - JED APT 1
G|60|TEXTILE PRODUCTS
A|TEXTILE PRODUCTS|AMS POLO
A|TEXTILE PRODUCTS|MODERN HOME ADULT BATHRO
G|70|DATES VISTA
A|DATES VISTA|QALMI
A|DATES VISTA|AMBER
A|DATES VISTA|MABROON
A|DATES VISTA|SUKKARY
A|DATES VISTA|AJWA
G|80|QURBANI
A|QURBANI|GOAT
G|90|VISA
A|VISA|DRIVER VIOLATIONS
A|VISA|NAQAL KAFALA
A|VISA|DRIVER IQAMA
A|VISA|WORK VISA
A|VISA|DRIVER CARD
A|VISA|IQAMA PRINT
A|VISA|OPERATION CARD
A|VISA|AQAD AJEER
A|VISA|TOURIST VISA
A|VISA|SEND TO CONSULATE
A|VISA|EXIT RE-ENTRY VISA
A|VISA|DRIVER LICENCE
A|VISA|UMRAH VISA LONG STAY
A|VISA|BRN
A|VISA|UMRAH VISA 5 STAR
A|VISA|UMRAH VISA (10 DAYS)
A|VISA|UMRAH VISA (15 DAYS)
A|VISA|UMRAH VISA (NON MASAR)
A|VISA|UMRAH VISA
A|VISA|DRIVER INSURANCE YEARLY
G|100|OTHER
A|OTHER|Isulator Power
A|OTHER|Raw Material
A|OTHER|COMPANY CHARGES
A|OTHER|Component
A|OTHER|Finished Goods
A|OTHER|Consumables
A|OTHER|Local Purchases
A|OTHER|Service Product
A|OTHER|Consumable
A|OTHER|Hi Wall Split Unit A/C
A|OTHER|Insulators
A|OTHER|AIR TICKET
A|OTHER|CUSTOMS VAT
A|OTHER|POLIO VACCINATION
A|OTHER|GPS
A|OTHER|CHANGE CHARGES
A|OTHER|Kkah
A|OTHER|SERVICE CHARGES
A|OTHER|CAR INSURANCE
A|OTHER|AIRLINE FOOD
A|OTHER|CANCELLATION CHARGES
A|OTHER|UMRAH GUIDE
$DATA$;
  v_co uuid; r record; v_grp uuid; v_id uuid; v_gname text;
  n_groups int := 0; n_items int := 0; n_reused int := 0; v_sort int;
begin
  select company_id into v_co from profiles p
    join user_roles ur on ur.user_id = p.id where ur.role = 'admin' limit 1;
  if v_co is null then raise exception '365: no company to build the tree in'; end if;

  for r in
    select split_part(l,'|',1) as kind,
           split_part(l,'|',2) as f2,
           btrim(substr(l, length(split_part(l,'|',1)||'|'||split_part(l,'|',2))+2)) as f3
      from regexp_split_to_table(btrim(v_rows), E'\n') l
     where btrim(l) <> ''
  loop
    if r.kind = 'G' then
      v_gname := r.f3;
      select id into v_grp from acct_products
       where company_id = v_co and parent_id is null and _pt_norm(name) = _pt_norm(v_gname);
      if v_grp is null then
        insert into acct_products(company_id, parent_id, name, is_group, is_stock, is_active, sort)
        values (v_co, null, v_gname, true, false, true, (r.f2)::int)
        returning id into v_grp;
        n_groups := n_groups + 1;
      else
        update acct_products set is_group = true, is_active = true, sort = (r.f2)::int
         where id = v_grp;
        n_reused := n_reused + 1;
      end if;
      v_sort := 0;
    else
      if v_grp is null then raise exception '365: item "%" arrived before its group', r.f3; end if;
      v_sort := v_sort + 10;
      select id into v_id from acct_products
       where company_id = v_co and parent_id = v_grp and _pt_norm(name) = _pt_norm(r.f3);
      if v_id is null then
        insert into acct_products(company_id, parent_id, name, is_group, is_stock, is_active,
                                  sort, purchase_rate, sell_rate, expense_rate)
        values (v_co, v_grp, r.f3, false, false, true, v_sort, 0, 0, 0);
        n_items := n_items + 1;
      else
        -- LEFT ALONE. A match may carry a price and a name something resolves by.
        n_reused := n_reused + 1;
      end if;
    end if;
  end loop;

  raise notice '365: % group(s) and % item(s) created, % reused', n_groups, n_items, n_reused;
end $pt$;

do $chk$
declare v_co uuid; v_n int; r record;
begin
  select company_id into v_co from profiles p
    join user_roles ur on ur.user_id = p.id where ur.role='admin' limit 1;

  -- 1. THE SIX PRICED ITEMS, unchanged to the halala
  for r in
    select * from (values
      ('UMRAH VISA (10 DAYS)',   440.00, 0.00,   480.00),
      ('UMRAH VISA (15 DAYS)',   440.00, 0.00,   490.00),
      ('UMRAH VISA (LONG STAY)', 530.00, 0.00,   580.00),
      ('UMRAH VISA (MASAR)',     440.00, 0.00,   460.00),
      ('UMRAH VISA (NON MASAR)', 440.00, 0.00,   500.00),
      ('HYNDAI STARIA 2022 BLACK', 80000.00, 20000.00, 0.00)
    ) as t(nm, pr, er, sr)
  loop
    if not exists (
      select 1 from acct_products p
       where p.company_id = v_co and p.name = r.nm and not p.is_group
         and p.purchase_rate = r.pr and p.expense_rate = r.er and p.sell_rate = r.sr)
    then
      raise exception '365: "%" no longer reads % / % / % — a priced item was disturbed',
        r.nm, r.pr, r.er, r.sr;
    end if;
  end loop;

  -- The source lists this car under BOTH TRADING VEHICLES and VEHICLES, so two
  -- items legitimately carry the name and only one of them is the priced one.
  if not exists (select 1 from acct_products
                  where company_id = v_co and name = 'HYNDAI STARIA 2022 BLACK'
                    and purchase_rate = 80000.00 and total_cost = 100000.00)
  then raise exception '365: the priced car no longer totals 100,000'; end if;

  -- 2. visa_pick_product must still resolve every visa type
  for r in select * from (values ('masar',0),('long_stay',0),('normal',8),('normal',12),('normal',30))
                  as t(vt, nights)
  loop
    if visa_pick_product(v_co, r.vt, r.nights) is null then
      raise exception '365: visa_pick_product no longer resolves % / % nights', r.vt, r.nights;
    end if;
  end loop;

  -- 3. no duplicate name under one parent, nothing orphaned, no item inside a leaf
  select count(*) into v_n from (
    select parent_id, _pt_norm(name) nm from acct_products where company_id=v_co
     group by 1,2 having count(*) > 1) d;
  if v_n <> 0 then raise exception '365: % duplicated name(s) under one parent', v_n; end if;
  select count(*) into v_n from acct_products c
   where c.parent_id is not null and not exists (select 1 from acct_products p where p.id=c.parent_id);
  if v_n <> 0 then raise exception '365: % orphaned item(s)', v_n; end if;
  select count(*) into v_n from acct_products c
   where c.parent_id is not null
     and (select is_group from acct_products p where p.id=c.parent_id) = false;
  if v_n <> 0 then raise exception '365: % item(s) sit inside something that is not a group', v_n; end if;

  -- 4. still not one stock item, so nothing started moving inventory
  select count(*) into v_n from acct_products where company_id=v_co and is_stock;
  if v_n <> 0 then raise exception '365: % item(s) became stock items', v_n; end if;

  -- 5. the costing row that exists still points at a live product
  select count(*) into v_n from acct_product_costing c
   where not exists (select 1 from acct_products p where p.id = c.product_id);
  if v_n <> 0 then raise exception '365: % costing row(s) lost their product', v_n; end if;

  -- 6. nothing posted, and no trade line lost its item
  select count(*) into v_n from journal_entries;
  if v_n <> 0 then raise exception '365: % journal entry(ies) appeared', v_n; end if;
  select count(*) into v_n from trade_document_lines l
   where l.product_id is not null
     and not exists (select 1 from acct_products p where p.id = l.product_id);
  if v_n <> 0 then raise exception '365: % trade line(s) lost their product', v_n; end if;

  raise notice '365: % products, % groups',
    (select count(*) from acct_products where company_id=v_co),
    (select count(*) from acct_products where company_id=v_co and is_group);
end $chk$;

drop function if exists public._pt_norm(text);

commit;
