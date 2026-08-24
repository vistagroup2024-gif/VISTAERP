-- Create an account (group or leaf) with an auto hierarchical code, nature inherited
-- from the parent, and — if an opening balance is given — an opening journal posted
-- through the ledger against the Opening Balance Control account (9-01) so the trial
-- balance stays in balance. Returns {id, code}.
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

  -- Auto code = parent code + '-' + next 2-digit sibling sequence (or manual override).
  if coalesce(trim(p_code),'') <> '' then
    v_code := trim(p_code);
    if exists (select 1 from accounts where company_id = p_company and code = v_code) then
      raise exception 'Code % already exists', v_code;
    end if;
  else
    select coalesce(max((regexp_replace(code, '^.*-', ''))::int), 0) + 1 into v_seq
      from accounts where company_id = p_company
        and parent_id is not distinct from p_parent
        and code ~ '-[0-9]+$';
    if p_parent is not null then
      v_code := par.code || '-' || lpad(coalesce(v_seq,1)::text, 2, '0');
    else
      v_code := lpad(coalesce(v_seq,1)::text, 2, '0');
    end if;
  end if;

  insert into accounts(company_id, code, name, name_ar, type, is_postable, is_group,
                       parent_id, subtype, currency)
  values (p_company, v_code, trim(p_name), nullif(trim(coalesce(p_name_ar,'')),''), v_nature,
          not p_is_group, p_is_group, p_parent, nullif(trim(coalesce(p_subtype,'')),''),
          coalesce(nullif(trim(coalesce(p_currency,'')),''), 'SAR'))
  returning id into v_id;

  -- Opening balance → post an opening journal against 9-01 Opening Balance Control.
  if not p_is_group and coalesce(p_opening,0) <> 0 then
    select id into v_ctrl from accounts where company_id = p_company and code = '9-01';
    if v_ctrl is null then raise exception 'Opening Balance Control (9-01) missing — seed the chart first'; end if;
    perform gl_journal(p_company, current_date, 'Opening balance — ' || trim(p_name), 'OPENING',
      jsonb_build_array(
        jsonb_build_object('account', v_id::text,
          'debit',  case when p_opening_is_debit then abs(p_opening) else 0 end,
          'credit', case when p_opening_is_debit then 0 else abs(p_opening) end),
        jsonb_build_object('account', v_ctrl::text,
          'debit',  case when p_opening_is_debit then 0 else abs(p_opening) end,
          'credit', case when p_opening_is_debit then abs(p_opening) else 0 end)
      ));
  end if;

  return jsonb_build_object('id', v_id, 'code', v_code);
end $$;

grant execute on function acct_create(uuid,uuid,text,text,boolean,text,account_type,text,numeric,boolean,text) to authenticated;
