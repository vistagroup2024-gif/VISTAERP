-- Route the four cash/journal voucher wrappers through gl_submit so the approval
-- workflow applies uniformly (they post immediately when no rule requires approval,
-- else they are saved pending). Return shape is {pending, ...} either way.
create or replace function gl_receipt(
  p_company uuid, p_date date, p_cash_bank uuid, p_narration text, p_reference text, p_lines jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare ln jsonb; arr jsonb := '[]'::jsonb; total numeric(18,2) := 0; amt numeric(18,2);
begin
  for ln in select * from jsonb_array_elements(p_lines) loop
    amt := round(coalesce((ln->>'amount')::numeric,0),2);
    if amt = 0 then continue; end if;
    total := total + amt;
    arr := arr || jsonb_build_array(jsonb_build_object('account_id', ln->>'account', 'debit', 0, 'credit', amt, 'description', ln->>'remarks'));
  end loop;
  arr := jsonb_build_array(jsonb_build_object('account_id', p_cash_bank::text, 'debit', total, 'credit', 0, 'description', p_narration)) || arr;
  return gl_submit(p_company, p_date, p_narration, 'gl_receipt', p_reference, arr);
end $$;

create or replace function gl_payment(
  p_company uuid, p_date date, p_cash_bank uuid, p_narration text, p_reference text, p_lines jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare ln jsonb; arr jsonb := '[]'::jsonb; total numeric(18,2) := 0; amt numeric(18,2);
begin
  for ln in select * from jsonb_array_elements(p_lines) loop
    amt := round(coalesce((ln->>'amount')::numeric,0),2);
    if amt = 0 then continue; end if;
    total := total + amt;
    arr := arr || jsonb_build_array(jsonb_build_object('account_id', ln->>'account', 'debit', amt, 'credit', 0, 'description', ln->>'remarks'));
  end loop;
  arr := jsonb_build_array(jsonb_build_object('account_id', p_cash_bank::text, 'debit', 0, 'credit', total, 'description', p_narration)) || arr;
  return gl_submit(p_company, p_date, p_narration, 'gl_payment', p_reference, arr);
end $$;

create or replace function gl_contra(
  p_company uuid, p_date date, p_from uuid, p_to uuid, p_amount numeric, p_narration text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare arr jsonb;
begin
  arr := jsonb_build_array(
    jsonb_build_object('account_id', p_to::text,   'debit', p_amount, 'credit', 0, 'description', p_narration),
    jsonb_build_object('account_id', p_from::text, 'debit', 0, 'credit', p_amount, 'description', p_narration));
  return gl_submit(p_company, p_date, p_narration, 'gl_contra', null, arr);
end $$;

create or replace function gl_journal(
  p_company uuid, p_date date, p_narration text, p_reference text, p_lines jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare ln jsonb; arr jsonb := '[]'::jsonb;
begin
  for ln in select * from jsonb_array_elements(p_lines) loop
    arr := arr || jsonb_build_array(jsonb_build_object(
      'account_id', ln->>'account',
      'debit',  round(coalesce((ln->>'debit')::numeric,0),2),
      'credit', round(coalesce((ln->>'credit')::numeric,0),2),
      'description', ln->>'remarks',
      'cost_center', ln->>'cost_center', 'tag_area', ln->>'tag_area'));
  end loop;
  return gl_submit(p_company, p_date, p_narration, 'gl_journal', p_reference, arr);
end $$;

-- acct_create's opening balance is a system entry — post it directly (never gate it
-- behind approval), otherwise a gl_journal approval rule would leave it unposted.
create or replace function acct_create(
  p_company uuid, p_parent uuid, p_name text, p_name_ar text,
  p_is_group boolean, p_subtype text, p_nature account_type,
  p_currency text, p_opening numeric, p_opening_is_debit boolean, p_code text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  par accounts%rowtype; v_nature account_type; v_code text; v_seq int; v_id uuid; v_ctrl uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if coalesce(trim(p_name),'') = '' then raise exception 'Account name is required'; end if;
  if p_parent is not null then
    select * into par from accounts where id = p_parent and company_id = p_company;
    if not found then raise exception 'Parent group not found'; end if;
    if not par.is_group then raise exception 'Parent must be a group'; end if;
    v_nature := par.type;
  else
    v_nature := coalesce(p_nature, 'expense');
  end if;
  if coalesce(trim(p_code),'') <> '' then
    v_code := trim(p_code);
    if exists (select 1 from accounts where company_id = p_company and code = v_code) then
      raise exception 'Code % already exists', v_code;
    end if;
  else
    select coalesce(max((regexp_replace(code, '^.*-', ''))::int), 0) + 1 into v_seq
      from accounts where company_id = p_company and parent_id is not distinct from p_parent and code ~ '-[0-9]+$';
    if p_parent is not null then v_code := par.code || '-' || lpad(coalesce(v_seq,1)::text, 2, '0');
    else v_code := lpad(coalesce(v_seq,1)::text, 2, '0'); end if;
  end if;
  insert into accounts(company_id, code, name, name_ar, type, is_postable, is_group, parent_id, subtype, currency)
  values (p_company, v_code, trim(p_name), nullif(trim(coalesce(p_name_ar,'')),''), v_nature,
          not p_is_group, p_is_group, p_parent, nullif(trim(coalesce(p_subtype,'')),''),
          coalesce(nullif(trim(coalesce(p_currency,'')),''), 'SAR'))
  returning id into v_id;
  if not p_is_group and coalesce(p_opening,0) <> 0 then
    select id into v_ctrl from accounts where company_id = p_company and code = '9-01';
    if v_ctrl is null then raise exception 'Opening Balance Control (9-01) missing — seed the chart first'; end if;
    perform gl_post(p_company, current_date, 'Opening balance — ' || trim(p_name), 'gl_journal', 'opening', 'OPENING',
      jsonb_build_array(
        jsonb_build_object('account_id', v_id::text,
          'debit',  case when p_opening_is_debit then abs(p_opening) else 0 end,
          'credit', case when p_opening_is_debit then 0 else abs(p_opening) end),
        jsonb_build_object('account_id', v_ctrl::text,
          'debit',  case when p_opening_is_debit then 0 else abs(p_opening) end,
          'credit', case when p_opening_is_debit then abs(p_opening) else 0 end)
      ));
  end if;
  return jsonb_build_object('id', v_id, 'code', v_code);
end $$;
