-- ============================================================
-- VISTA ERP - 004 Seed company + demo data
-- ============================================================
do $$
declare
  v_company uuid;
  v_branch  uuid;
  v_supplier uuid;
  v_agent   uuid;
  v_hotel_mk uuid;
  v_hotel_md uuid;
  v_rt_quad uuid;
  v_rt_triple uuid;
  v_season uuid;
  v_pkg uuid;
begin
  insert into companies(name, legal_name, base_currency, phone, email)
  values ('Vista Group','Vista Group Umrah Services & Trading','PKR','+92','info@vistagroup.com')
  returning id into v_company;

  insert into branches(company_id, name, code) values (v_company,'Head Office','HO') returning id into v_branch;

  insert into parties(company_id, party_type, name, code, currency)
  values (v_company,'supplier','Al Safwah Hotels (KSA)','SUP-001','SAR') returning id into v_supplier;

  insert into parties(company_id, party_type, name, code, currency, credit_limit)
  values (v_company,'b2b_agent','Demo Travel Agency','AGT-001','PKR', 1000000) returning id into v_agent;

  insert into parties(company_id, party_type, name, code, currency)
  values (v_company,'customer','Walk-in Customer','CUS-001','PKR');

  insert into seasons(company_id,name,start_date,end_date)
  values (v_company,'Ramadan 2026','2026-02-18','2026-03-19') returning id into v_season;

  insert into hotels(company_id,name,city,rating,distance_haram_m,supplier_id)
  values (v_company,'Makkah Towers','makkah',5,300,v_supplier) returning id into v_hotel_mk;
  insert into hotels(company_id,name,city,rating,distance_haram_m,supplier_id)
  values (v_company,'Madinah Plaza','madinah',4,250,v_supplier) returning id into v_hotel_md;

  insert into room_types(hotel_id,name,capacity) values (v_hotel_mk,'Quad',4) returning id into v_rt_quad;
  insert into room_types(hotel_id,name,capacity) values (v_hotel_mk,'Triple',3) returning id into v_rt_triple;
  insert into room_types(hotel_id,name,capacity) values (v_hotel_md,'Quad',4);

  insert into room_rates(room_type_id,season_id,currency,cost_price,sell_price)
  values (v_rt_quad,v_season,'SAR',180,250),(v_rt_triple,v_season,'SAR',220,300);

  insert into allotments(company_id,hotel_id,room_type_id,season_id,rooms_held,start_date,end_date,release_date,cost_price,currency)
  values (v_company,v_hotel_mk,v_rt_quad,v_season,50,'2026-02-18','2026-03-19','2026-02-01',180,'SAR');

  insert into packages(company_id,name,code,description,duration_days,base_currency,status,valid_from,valid_to)
  values (v_company,'Economy Umrah 14 Nights','PKG-ECO-14','14 nights Umrah: visa, transport, hotels (Makkah+Madinah), air ticket',14,'PKR','active','2026-02-01','2026-03-31')
  returning id into v_pkg;

  insert into package_items(package_id,service_type,description,supplier_id,hotel_id,room_type_id,qty,nights,cost_currency,cost_price,sell_currency,sell_price,sort_order)
  values
    (v_pkg,'visa','Umrah Visa',v_supplier,null,null,1,null,'SAR',300,'PKR',95000,1),
    (v_pkg,'air_ticket','Return Air Ticket (LHE-JED-LHE)',null,null,null,1,null,'USD',450,'PKR',130000,2),
    (v_pkg,'hotel','Makkah Hotel - Quad (9 nights)',v_supplier,v_hotel_mk,v_rt_quad,1,9,'SAR',180,'PKR',60000,3),
    (v_pkg,'transport','Airport & Ziyarat Transport',v_supplier,null,null,1,null,'SAR',150,'PKR',15000,4);
end $$;
