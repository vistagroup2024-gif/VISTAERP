-- An account in the tree can BE a customer, agent or supplier.
--
-- Until now the link only ran one way. Adding a party on the Customers /
-- Agents / Suppliers screen created its ledger account by itself
-- (ensure_party_account), but an account typed into the Chart of Accounts was
-- only ever an account: nothing anywhere created the parties row. That matters
-- because about thirty screens build their party dropdowns from `parties`, not
-- from the chart — the Visa Group agent, the Hotel Booking agent and supplier,
-- the Transport Rate Master agent list (and so the fare chart), the BRN
-- supplier, every trade voucher's party, Bill Record, Product Rates and the B2B
-- login. An agent added only in the tree was invisible to all of them.
--
-- So the tree gets the other direction: say what the account is, and the party
-- record is created in the same step.
--
-- Which turns out to be all it has to do. trg_party_ensure_ledger already
-- fires ensure_party_account for every new party, so inserting the party IS
-- what creates the ledger account — acct_create adopts the one the trigger
-- made rather than inserting a second. A first cut here did insert its own,
-- and left every party made from the tree owning two accounts, one of them
-- dead. One party, one account, one routine that creates it.
--
-- The trigger files a new party's account under the control group for its kind
-- (1-04-01 for a customer or agent, 2-01-01 for a supplier). Someone working in
-- the tree has already said where they want it, so it is moved there and
-- recoded to sit in that group's run — master data is the user's, and the group
-- they picked is part of what they said.
--
-- A supplier is a payable and a customer or agent is a receivable, because that
-- is how ensure_party_account finds the account again. That is checked, not
-- quietly corrected: it decides where the account lives in the chart, and it is
-- not this routine's to guess at.

-- ── acct_tree: say which accounts are parties ───────────────────────────────
-- The tree can then show it, and the screen knows which accounts still need it.
create or replace function public.acct_tree(p_company uuid)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'code', a.code, 'name', a.name, 'name_ar', a.name_ar,
    'nature', a.type, 'is_group', a.is_group, 'is_postable', a.is_postable,
    'parent_id', a.parent_id, 'path', a.path, 'currency', a.currency,
    'subtype', a.subtype, 'status', a.status, 'sort_order', a.sort_order,
    'party_type', pt.party_type,
    'own_debit', coalesce(s.debit,0), 'own_credit', coalesce(s.credit,0)
  ) order by a.path), '[]'::jsonb)
  from accounts a
  left join parties pt on pt.id = a.party_id
  left join (
    select l.account_id, sum(l.debit) debit, sum(l.credit) credit
    from journal_lines l join journal_entries e on e.id = l.entry_id
    where e.company_id = p_company and e.status = 'posted'
    group by l.account_id
  ) s on s.account_id = a.id
  where a.company_id = p_company;
$function$;

-- ── The one rule both paths obey ────────────────────────────────────────────
-- A supplier is a payable, a customer or an agent is a receivable. Kept in one
-- place so the create path and the link path cannot drift apart.
create or replace function public.party_subtype_for(p_party_type text)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select case when p_party_type = 'supplier' then 'Payable' else 'Receivable' end;
$function$;

-- ── acct_create: optionally create the party too ────────────────────────────
-- p_party_type is new and defaults to null, so every existing caller is
-- unaffected. Null means what it always meant: an ordinary ledger account.
--
-- A different argument list is a different function to Postgres, not a
-- replacement, so the eleven-argument version has to go: left in place, a call
-- naming the original eleven arguments would match both and PostgREST would
-- refuse it as ambiguous.
drop function if exists public.acct_create(uuid, uuid, text, text, boolean, text, account_type, text, numeric, boolean, text);

create or replace function public.acct_create(
  p_company uuid, p_parent uuid, p_name text, p_name_ar text, p_is_group boolean,
  p_subtype text, p_nature account_type, p_currency text, p_opening numeric,
  p_opening_is_debit boolean, p_code text default null, p_party_type text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  par accounts%rowtype; v_nature account_type; v_code text; v_seq int; v_id uuid; v_ctrl uuid;
  v_party uuid; v_want_subtype text; v_currency text;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if coalesce(trim(p_name),'') = '' then raise exception 'Account name is required'; end if;

  if p_party_type is not null then
    if p_party_type not in ('customer','supplier','b2b_agent') then
      raise exception 'Unknown party type %', p_party_type;
    end if;
    if p_is_group then raise exception 'A group cannot be a customer, agent or supplier'; end if;
    v_want_subtype := party_subtype_for(p_party_type);
    if coalesce(nullif(trim(coalesce(p_subtype,'')),''), v_want_subtype) <> v_want_subtype then
      raise exception 'A % account must be %, not %', p_party_type, v_want_subtype, p_subtype;
    end if;
    p_subtype := v_want_subtype;
  end if;

  if p_parent is not null then
    select * into par from accounts where id = p_parent and company_id = p_company;
    if not found then raise exception 'Parent group not found'; end if;
    if not par.is_group then raise exception 'Parent must be a group'; end if;
    v_nature := par.type;
  else
    v_nature := coalesce(p_nature, 'expense');
  end if;

  v_currency := coalesce(nullif(trim(coalesce(p_currency,'')),''), 'SAR');

  if p_party_type is not null then
    -- Inserting the party is enough to get the account: trg_party_ensure_ledger
    -- calls ensure_party_account for every new party, and has done since long
    -- before this. So the account is NOT inserted here — it is adopted. Adding
    -- a second insert alongside the trigger is exactly how you end up with a
    -- party owning two ledger accounts, one of which nothing ever posts to.
    insert into parties(company_id, party_type, name, currency, is_active)
    values (p_company, p_party_type::party_type, trim(p_name), v_currency, true)
    returning id into v_party;

    select id into v_id from accounts
     where company_id = p_company and party_id = v_party and subtype = v_want_subtype
     limit 1;
    if v_id is null then
      raise exception 'The ledger account for this % was not created — is the chart seeded?', p_party_type;
    end if;

    -- The trigger files it under the control group for its kind. Honour the
    -- group the user picked instead, and recode it to sit in that group's run.
    if p_parent is not null and (select parent_id from accounts where id = v_id) is distinct from p_parent then
      select coalesce(max((regexp_replace(code, '^.*-', ''))::int), 0) + 1 into v_seq
        from accounts where company_id = p_company and parent_id = p_parent and code ~ '-[0-9]+$';
      v_code := par.code || '-' || lpad(coalesce(v_seq,1)::text, greatest(2, length(coalesce(v_seq,1)::text)), '0');
      update accounts set parent_id = p_parent, code = v_code, type = v_nature where id = v_id;
      perform acct_rebuild_paths(p_company);
    else
      select code into v_code from accounts where id = v_id;
    end if;

    update accounts set name_ar = nullif(trim(coalesce(p_name_ar,'')),''), currency = v_currency
     where id = v_id;
  else
    if coalesce(trim(p_code),'') <> '' then
      v_code := trim(p_code);
      if exists (select 1 from accounts where company_id = p_company and code = v_code) then
        raise exception 'Code % already exists', v_code;
      end if;
    else
      select coalesce(max((regexp_replace(code, '^.*-', ''))::int), 0) + 1 into v_seq
        from accounts where company_id = p_company and parent_id is not distinct from p_parent and code ~ '-[0-9]+$';
      if p_parent is not null then v_code := par.code || '-' || lpad(coalesce(v_seq,1)::text, greatest(2, length(coalesce(v_seq,1)::text)), '0');
      else v_code := lpad(coalesce(v_seq,1)::text, greatest(2, length(coalesce(v_seq,1)::text)), '0'); end if;
    end if;

    insert into accounts(company_id, code, name, name_ar, type, is_postable, is_group, parent_id, subtype, currency)
    values (p_company, v_code, trim(p_name), nullif(trim(coalesce(p_name_ar,'')),''), v_nature,
            not p_is_group, p_is_group, p_parent, nullif(trim(coalesce(p_subtype,'')),''), v_currency)
    returning id into v_id;
  end if;

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
  return jsonb_build_object('id', v_id, 'code', v_code, 'party_id', v_party);
end $function$;

create or replace function public.acct_link_party(p_account uuid, p_party_type text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare a accounts%rowtype; v_party uuid; v_want_subtype text; v_spare uuid; v_lines int;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if p_party_type not in ('customer','supplier','b2b_agent') then
    raise exception 'Unknown party type %', p_party_type;
  end if;

  select * into a from accounts where id = p_account and company_id = auth_company_id();
  if not found then raise exception 'Account not found'; end if;
  if a.is_group then raise exception 'A group cannot be a customer, agent or supplier'; end if;
  if a.party_id is not null then raise exception 'This account is already linked to a party'; end if;

  v_want_subtype := party_subtype_for(p_party_type);
  if coalesce(a.subtype,'') <> v_want_subtype then
    raise exception 'A % account must be %, but this one is %',
      p_party_type, v_want_subtype, coalesce(nullif(a.subtype,''), 'not set');
  end if;

  insert into parties(company_id, party_type, name, currency, is_active, phone, tax_number, credit_limit, credit_days)
  values (a.company_id, p_party_type::party_type, a.name, coalesce(a.currency,'SAR'), true,
          a.phone, a.vat_no, coalesce(a.credit_limit,0), coalesce(a.credit_days,0))
  returning id into v_party;

  -- trg_party_ensure_ledger has just raised a fresh account for the new party,
  -- because it had no way to know one was already sitting here waiting. The
  -- point of this routine is to keep THIS account — its history, its place in
  -- the tree — so the spare goes, and only ever the spare: it is checked for
  -- postings first and would fail loudly rather than take any with it.
  select id into v_spare from accounts
   where company_id = a.company_id and party_id = v_party and id <> a.id limit 1;
  if v_spare is not null then
    select count(*) into v_lines from journal_lines where account_id = v_spare;
    if v_lines > 0 then
      raise exception 'The ledger account raised for this party already has postings — link it by hand';
    end if;
    delete from accounts where id = v_spare;
  end if;

  update accounts set party_id = v_party where id = a.id;
  return jsonb_build_object('account_id', a.id, 'party_id', v_party);
end $function$;

-- Staff-only, and no more than that: PUBLIC carries an EXECUTE grant on every
-- new function and anon is a member of it, so revoking from anon alone revokes
-- nothing (see migrations 292/293).
revoke all on function public.acct_create(uuid, uuid, text, text, boolean, text, account_type, text, numeric, boolean, text, text) from public, anon;
revoke all on function public.acct_link_party(uuid, text) from public, anon;
revoke all on function public.party_subtype_for(text) from public, anon;
grant execute on function public.acct_create(uuid, uuid, text, text, boolean, text, account_type, text, numeric, boolean, text, text) to authenticated;
grant execute on function public.acct_link_party(uuid, text) to authenticated;
grant execute on function public.party_subtype_for(text) to authenticated;
