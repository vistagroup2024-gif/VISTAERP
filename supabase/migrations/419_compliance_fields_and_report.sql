-- Operations & Compliance Portal (item 14) — the fields the business asked
-- for, in the two places already decided: the vehicle master (acct_tag_areas,
-- the same VEHICLES / VISTA TRANSPORT tree the Transport Costing module
-- already reads its fleet from) and the Vista Car Customer group of the
-- chart of accounts, i.e. Party Details (parties, via acct_party_save) — a
-- customer, agent or supplier IS an account in the chart, and this is the
-- one place their details live.
--
-- Fields added (exactly as specified):
--   parties: iqama_no, iqama_expiry, driver_card_expiry, driver_license_expiry
--   acct_tag_areas: car_authorization_expiry, car_insurance_expiry,
--                   operation_card_expiry, fahas_expiry
--
-- These are plain columns available on every party / every tag area leaf —
-- the same generic-field shape TreeMaster's `extras` already uses for e.g.
-- Cost Centre's Sales Target, rather than restricting them to one subtree by
-- name (there is no clean way to scope a column to "only this branch of the
-- tree", and master data is the user's: they fill in what applies and leave
-- the rest blank).
alter table public.parties
  add column if not exists iqama_no text,
  add column if not exists iqama_expiry date,
  add column if not exists driver_card_expiry date,
  add column if not exists driver_license_expiry date;

alter table public.acct_tag_areas
  add column if not exists car_authorization_expiry date,
  add column if not exists car_insurance_expiry date,
  add column if not exists operation_card_expiry date,
  add column if not exists fahas_expiry date;

-- acct_party_save's signature changes (4 new optional params, appended with
-- defaults so nothing else calling it breaks) — drop-then-recreate rather
-- than a bare CREATE OR REPLACE, which would leave the old 10-arg overload
-- behind instead of replacing it.
drop function if exists public.acct_party_save(uuid, text, text, text, text, text, numeric, integer, numeric, boolean);

create or replace function public.acct_party_save(
  p_account uuid, p_name text, p_code text, p_phone text, p_email text, p_currency text,
  p_credit_limit numeric, p_credit_days integer, p_sales_target numeric, p_is_active boolean,
  p_iqama_no text default null, p_iqama_expiry date default null,
  p_driver_card_expiry date default null, p_driver_license_expiry date default null
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a accounts%rowtype; v_name text; v_currency text;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  perform staff_require_doc('coa', 'edit');

  select * into a from accounts where id = p_account and company_id = auth_company_id();
  if not found then raise exception 'Account not found'; end if;
  if a.party_id is null then raise exception 'This account is not a customer, agent or supplier'; end if;

  v_name := nullif(trim(coalesce(p_name,'')),'');
  if v_name is null then raise exception 'Name is required'; end if;
  v_currency := coalesce(nullif(trim(coalesce(p_currency,'')),''), 'SAR');

  update parties set
    name         = v_name,
    code         = nullif(trim(coalesce(p_code,'')),''),
    phone        = nullif(trim(coalesce(p_phone,'')),''),
    email        = nullif(trim(coalesce(p_email,'')),''),
    currency     = v_currency,
    credit_limit = coalesce(p_credit_limit, 0),
    credit_days  = coalesce(p_credit_days, 0),
    sales_target = coalesce(p_sales_target, 0),
    is_active    = coalesce(p_is_active, true),
    iqama_no     = nullif(trim(coalesce(p_iqama_no,'')),''),
    iqama_expiry = p_iqama_expiry,
    driver_card_expiry = p_driver_card_expiry,
    driver_license_expiry = p_driver_license_expiry
  where id = a.party_id;

  update accounts set name = v_name, currency = v_currency where id = a.id;
  return jsonb_build_object('account_id', a.id, 'party_id', a.party_id);
end $function$;

revoke all on function public.acct_party_save(uuid, text, text, text, text, text, numeric, integer, numeric, boolean, text, date, date, date) from public, anon;
grant execute on function public.acct_party_save(uuid, text, text, text, text, text, numeric, integer, numeric, boolean, text, date, date, date) to authenticated;

do $chk1$
declare v_argc int;
begin
  select pronargs into v_argc from pg_proc where proname='acct_party_save';
  if v_argc <> 14 then raise exception 'acct_party_save should take 14 args, has %', v_argc; end if;
  raise notice 'schema check passed: acct_party_save now has % args', v_argc;
end;
$chk1$;

-- The Compliance Portal's one data source: every compliance document that
-- has actually been filled in, across both masters, flattened into one
-- shape (entity, doc_name, expiry) so the portal can split expired from
-- not-yet-expired without caring which master a row came from. Invoker
-- (plain STABLE SQL, no SECURITY DEFINER) so RLS on both tables reaches it
-- directly, per this ERP's house convention for reports.
create or replace function public.report_compliance_documents(p_company uuid)
 RETURNS jsonb
 LANGUAGE sql STABLE
 SET search_path TO 'public'
AS $function$
with vdocs as (
  select id, name as entity, 'Car Authorization' as doc_name, car_authorization_expiry as expiry from acct_tag_areas where company_id = p_company and is_group = false and car_authorization_expiry is not null
  union all
  select id, name, 'Car Insurance', car_insurance_expiry from acct_tag_areas where company_id = p_company and is_group = false and car_insurance_expiry is not null
  union all
  select id, name, 'Operation Card', operation_card_expiry from acct_tag_areas where company_id = p_company and is_group = false and operation_card_expiry is not null
  union all
  select id, name, 'Fahas (Inspection)', fahas_expiry from acct_tag_areas where company_id = p_company and is_group = false and fahas_expiry is not null
),
cdocs as (
  select p.id, p.name as entity, 'Iqama' as doc_name, p.iqama_expiry as expiry from parties p where p.company_id = p_company and p.iqama_expiry is not null
  union all
  select p.id, p.name, 'Driver Card', p.driver_card_expiry from parties p where p.company_id = p_company and p.driver_card_expiry is not null
  union all
  select p.id, p.name, 'Driver License', p.driver_license_expiry from parties p where p.company_id = p_company and p.driver_license_expiry is not null
)
select jsonb_build_object(
  'vehicles', coalesce((select jsonb_agg(x order by x.expiry) from vdocs x), '[]'::jsonb),
  'customers', coalesce((select jsonb_agg(x order by x.expiry) from cdocs x), '[]'::jsonb)
);
$function$;

revoke all on function public.report_compliance_documents(uuid) from public, anon;
grant execute on function public.report_compliance_documents(uuid) to authenticated;

do $chk2$
declare
  v_company uuid := '96f6b539-b491-4df7-91a2-80c7c8e7491d';
  v_admin uuid := 'edf3fa71-27e2-4cb1-af62-9afd685abefe';
  v jsonb;
  v_direct_v int;
  v_direct_c int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  select public.report_compliance_documents(v_company) into v;

  select count(*) into v_direct_v from acct_tag_areas where company_id = v_company and is_group = false
    and (car_authorization_expiry is not null or car_insurance_expiry is not null or operation_card_expiry is not null or fahas_expiry is not null);
  select count(*) into v_direct_c from parties where company_id = v_company
    and (iqama_expiry is not null or driver_card_expiry is not null or driver_license_expiry is not null);

  if jsonb_array_length(v->'vehicles') <> v_direct_v then
    raise exception 'vehicles doc count % does not match distinct vehicles with a compliance field % (no test data exists yet in production, both should be 0)', jsonb_array_length(v->'vehicles'), v_direct_v;
  end if;
  if jsonb_array_length(v->'customers') <> v_direct_c then
    raise exception 'customers doc count % does not match distinct customers with a compliance field %', jsonb_array_length(v->'customers'), v_direct_c;
  end if;

  raise notice 'self-check passed: vehicles=%, customers=% (expected 0/0 — no compliance data entered in production yet)', jsonb_array_length(v->'vehicles'), jsonb_array_length(v->'customers');
end;
$chk2$;
