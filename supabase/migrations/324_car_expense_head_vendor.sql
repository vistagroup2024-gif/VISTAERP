-- An expense head remembers who it is usually paid to.
--
-- Masters already held the usual AMOUNT for a head — "registration = 1,200" —
-- so that figure is typed once rather than every time. The vendor is the same
-- kind of fact and was not: registration always goes to the same traffic
-- department, customs clearing to the same clearing agent, and the operator was
-- picking it from a list of every payable, cash and bank account on every
-- single voucher.
--
-- So the head carries it too, and the Car Expense voucher fills it in the
-- moment a head is chosen — exactly the way the amount already arrives. It
-- stays editable, for the bill that came from somewhere else.
--
-- It is an ACCOUNT rather than a party id because that is what the voucher
-- credits and what its picker offers: every supplier in this ERP is an account
-- in the chart (a Payable with a parties row behind it), and the same field
-- also has to take a Cash or Bank account for the expense that was settled on
-- the spot. Pointing at the account is pointing at the one thing that is true
-- for all three.
--
-- Nothing is required. A head with no vendor behaves exactly as every head does
-- today: the voucher leaves the field on Vehicle Supplier Payable until
-- somebody chooses otherwise.

alter table acct_car_purchase_expenses
  add column if not exists credit_account uuid references accounts(id);

comment on column acct_car_purchase_expenses.credit_account is
  'Who this head is usually paid to. Copied onto a Car Expense voucher when the head is chosen, and editable there.';

-- The list the screens offer, so the master and the voucher cannot end up
-- offering different things. Payables are the suppliers; cash and bank are for
-- an expense settled on the spot.
create or replace function car_expense_credit_accounts()
returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'code', a.code, 'name', a.name, 'subtype', a.subtype)
    order by a.subtype, a.code), '[]'::jsonb)
  from accounts a
  where a.company_id = auth_company_id() and is_staff()
    and not a.is_group
    and a.subtype in ('Payable', 'Cash', 'Bank');
$function$;

revoke all on function car_expense_credit_accounts() from public, anon;
grant execute on function car_expense_credit_accounts() to authenticated;
