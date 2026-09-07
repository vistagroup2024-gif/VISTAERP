-- Everything the Customers / Agents / Suppliers screen could do, in the tree.
--
-- 302 gave the tree the half that matters most — say what an account is and the
-- party record appears with it. But that screen also carried a code, a phone, an
-- email, a credit limit, credit days, a sales target and an active flag, and it
-- could edit and delete. Retiring it before those exist here would lose them,
-- so they come across first: this is what makes the tree the one place rather
-- than the usual place.

-- ── acct_tree: carry the party's own fields ─────────────────────────────────
-- The tree already says which accounts are parties (302). Now it says what the
-- party record holds, so Party Details opens filled in without a second read.
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
    'party', case when pt.id is null then null else jsonb_build_object(
      'id', pt.id, 'code', pt.code, 'phone', pt.phone, 'email', pt.email,
      'currency', pt.currency, 'credit_limit', pt.credit_limit,
      'credit_days', pt.credit_days, 'sales_target', pt.sales_target,
      'is_active', pt.is_active) end,
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

-- ── acct_party_save: edit the party behind an account ───────────────────────
-- The name lives in two places, so it is written to both. Letting them drift
-- would mean the ledger calling somebody one thing and every booking screen
-- calling them another, with no way to tell which was meant.
create or replace function public.acct_party_save(
  p_account uuid, p_name text, p_code text, p_phone text, p_email text,
  p_currency text, p_credit_limit numeric, p_credit_days int,
  p_sales_target numeric, p_is_active boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare a accounts%rowtype; v_name text; v_currency text;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;

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
    is_active    = coalesce(p_is_active, true)
  where id = a.party_id;

  update accounts set name = v_name, currency = v_currency where id = a.id;
  return jsonb_build_object('account_id', a.id, 'party_id', a.party_id);
end $function$;

-- ── acct_delete: deleting a party account takes its party with it ───────────
-- The tree used to delete straight off the accounts table, which was fine while
-- an account was only ever an account. Now one can be a party, and deleting
-- half of a pair leaves a customer nothing posts to — so this does both, and
-- leans on delete_party for the refusals, which already knows every place a
-- party can be spoken for (bookings, invoices, bills, groups, BRNs, rate cards).
create or replace function public.acct_delete(p_account uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare a accounts%rowtype; n int;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;

  select * into a from accounts where id = p_account and company_id = auth_company_id();
  if not found then raise exception 'Account not found'; end if;

  select count(*) into n from accounts where parent_id = a.id;
  if n > 0 then raise exception 'This account has sub-accounts — move or remove them first'; end if;

  select count(*) into n from journal_lines where account_id = a.id;
  if n > 0 then raise exception 'This account has posted transactions — it cannot be deleted'; end if;

  -- The party first: it raises if the party is spoken for anywhere, and then
  -- nothing has been deleted yet. The account row is released by the party's
  -- own delete cascading party_id to null, so it is removed after.
  if a.party_id is not null then perform delete_party(a.party_id); end if;
  delete from accounts where id = a.id;
end $function$;

revoke all on function public.acct_party_save(uuid, text, text, text, text, text, numeric, int, numeric, boolean) from public, anon;
revoke all on function public.acct_delete(uuid) from public, anon;
grant execute on function public.acct_party_save(uuid, text, text, text, text, text, numeric, int, numeric, boolean) to authenticated;
grant execute on function public.acct_delete(uuid) to authenticated;
