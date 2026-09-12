-- Rollback of 364: the cost centre tree goes, and the four that existed before
-- go back to being loose top-level entries.
--
-- It refuses if any of the 19 it created is named on a voucher, a journal line
-- or an automation rule, because by then it is not an import artefact — deleting
-- it would leave a document or a rule pointing at a name nothing holds, which is
-- exactly the failure 364 was written to avoid.
--
-- Note that HOTEL and UMRAH VISA will be among the refusals: automation rules
-- already named them before 364 existed, and 364 is what made those names
-- resolve. Removing them puts those two rules back to dangling. If that is
-- really wanted, clear the rules' cost centre first on Invoice Automation.

begin;

do $rb$
declare v_co uuid; v_bad text; v_n int;
  v_made text[] := array['SERVICE CHARGES','MONTHLY CAR SERVICE CHARGES','OTHER SERVICES',
    'YUSRA COMPANY','WORK VISA','TRANSPORT','UMRAH PACKAGE','MAIN UMRAH PACKAGE','HOTEL',
    'AIR TICKET','UMRAH VISA','TRADING','DATES','TEXTILE','MAINS','MAIN','RENTAL',
    'CAR RENTAL','QURBANI'];
begin
  select company_id into v_co from profiles p
    join user_roles ur on ur.user_id = p.id where ur.role='admin' limit 1;

  select string_agg(distinct x, ', ') into v_bad from (
    select r.cost_center as x from acct_automation_rules r
     where upper(btrim(r.cost_center)) = any (select upper(y) from unnest(v_made) y)
    union all
    select t.cost_center from trade_documents t
     where upper(btrim(t.cost_center)) = any (select upper(y) from unnest(v_made) y)
    union all
    select l.cost_center from journal_lines l
     where upper(btrim(l.cost_center)) = any (select upper(y) from unnest(v_made) y)
  ) q;
  if v_bad is not null then
    raise exception '364 rollback: these are in use and cannot be removed: %', v_bad;
  end if;

  -- the four that existed before go back to the top of the tree, names untouched
  update acct_cost_centers set parent_id = null, is_group = false
   where company_id = v_co
     and name in ('CAR SALES INSTALLMENT','CAR TRADING','OUTSOURCE TRANSPORT','VISTA TRANSPORT');

  delete from acct_cost_centers
   where company_id = v_co
     and upper(btrim(name)) = any (select upper(y) from unnest(v_made) y);
  get diagnostics v_n = row_count;
  raise notice '364 rollback: removed % cost centre(s)', v_n;

  select count(*) into v_n from acct_cost_centers where company_id = v_co;
  if v_n <> 4 then raise exception '364 rollback: % cost centres left, expected the original 4', v_n; end if;
end $rb$;

commit;
