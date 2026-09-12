-- An importer for the old software's ledger.
--
-- THIS CAPABILITY DID NOT EXIST. Nothing in this ERP could load historical
-- journal lines in bulk: `bank_import` reads bank statements, and every other
-- door into the ledger raises ONE voucher at a time through gl_submit. Bringing
-- 2023-2026 across from the old software needs a bulk loader, so here is one.
--
-- IT IS INTERNAL AND STAYS INTERNAL, and making that true took more than
-- leaving it ungranted. A routine that writes straight into journal_entries
-- with an arbitrary date, bypassing gl_submit and therefore bypassing the
-- approval-rule gate, must not be callable from a browser. It is a migration
-- tool for a one-off job, not a feature.
--
-- "LEAVING IT UNGRANTED IS WHAT MAKES IT INTERNAL" IS NOT TRUE IN THIS
-- DATABASE, and this migration's own check is what proved it. CLAUDE.md says a
-- new internal engine needs no grant; in fact this project carries
--
--   alter default privileges ... grant execute on functions
--     to anon, authenticated, service_role
--
-- (four such entries in pg_default_acl, from postgres and supabase_admin), so
-- every new function is created ALREADY GRANTED to anon AND authenticated —
-- explicitly, not through PUBLIC. `revoke ... from public, anon` therefore
-- closes anon and leaves every logged-in user holding EXECUTE. The revoke below
-- names authenticated as well, and the post-condition asserts all three are
-- shut rather than assuming the revoke did it.
--
-- IT DRY-RUNS BY DEFAULT. p_dry_run is true unless you say otherwise, so the
-- first thing it does with a new file is tell you what it would do and what is
-- wrong with it, having written nothing.
--
-- WHAT IT TAKES: a json array, one object per LEDGER LINE, exactly as the old
-- software exports them:
--
--   [{"entry_no":"JV-0012","date":"2024-03-11","code":"1150-004",
--     "debit":"1500.00","credit":"0","narration":"...","reference":"INV-88",
--     "cost_center":"CAR TRADING","tag_area":"STARIA (STA 6390)"}, ...]
--
-- Lines are grouped into entries by (entry_no, date) — one old voucher becomes
-- one ERP journal entry, which is the whole point: the ledger reads as vouchers
-- rather than as a flat list of lines. `code` is matched against accounts.code.
-- cost_center and tag_area are optional and are stored as the text they are.
--
-- WHAT IT REFUSES, AND WHY EACH ONE MATTERS:
--
--   * an account code that is not in the chart — the alternative is a line
--     silently dropped or dumped into a suspense account, and a ledger that is
--     quietly short is worse than an import that stops;
--   * an entry whose debits and credits do not agree — gl_post does NOT check
--     this (only the Journal screen does, client-side), so a bulk loader that
--     skipped the check could put the trial balance out and nothing would say
--     so;
--   * a line with debit AND credit both set, or both zero;
--   * a group posting to a GROUP account or to one that is not postable;
--   * a date in the future;
--   * an entry_no it has already imported — so a re-run after a correction
--     does not duplicate what already came in.
--
-- Everything it refuses is REPORTED WITH ITS LINE, all of them at once, not
-- one error at a time: a 20,000-line file with fifty bad codes should tell you
-- all fifty on the first pass.
--
-- HOW IT MARKS WHAT IT WROTE: source = 'history_import', reference = the old
-- entry_no. That is what makes it idempotent, what lets the rollback find
-- exactly its own rows, and what keeps the old voucher number visible in the
-- ERP next to the ERP's own.
--
-- ONE THING IT DELIBERATELY DOES NOT DO: reconstruct document types. A 2024
-- sales invoice arrives as a journal entry carrying its lines, not as a Sales
-- Invoice with item lines and stock movements — a ledger export does not
-- contain the items, so inventing them is not on the table. The history is
-- the ledger; the live documents start on go-live day.
--
-- AND WHAT MUST BE LEFT OUT OF THE FILE: anything the ERP will post for
-- itself. The car module posts its own invoices and receipts once
-- acct_automation_rules car.contract / car.receipt are enabled, so those
-- entries must NOT also be in the import, or every car figure doubles. The
-- importer cannot know which is which, so the exclusion happens when the file
-- is prepared — and that is why this routine reports the cost centres it is
-- about to load: CAR TRADING or CAR SALES INSTALLMENT showing up in the report
-- is the sign the file still has car entries in it.

begin;

create or replace function public.gl_history_import(
  p_rows    jsonb,
  p_dry_run boolean default true
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_co       uuid;
  v_problems text[] := '{}';
  v_entries  int := 0;
  v_lines    int := 0;
  v_dr       numeric(18,2) := 0;
  v_cr       numeric(18,2) := 0;
  v_skipped  int := 0;
  v_entry    uuid;
  v_no       text;
  g          record;
  l          record;
  v_ccs      text;
begin
  select id into v_co from companies order by created_at limit 1;
  if v_co is null then raise exception 'gl_history_import: no company'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'gl_history_import: pass a json array of lines';
  end if;

  -- Flatten the payload once, with a row number so every complaint can name
  -- the line it came from. Dropped first because `on commit drop` only fires at
  -- COMMIT: call this twice in one transaction — which the checks below do, and
  -- which a real import run doing a dry run then a live run also does — and the
  -- second call would find the table still there.
  drop table if exists _imp;
  create temp table _imp on commit drop as
  select (ord)::int                                          as ln,
         btrim(coalesce(r->>'entry_no', ''))                  as entry_no,
         nullif(btrim(coalesce(r->>'date','')), '')           as date_txt,
         btrim(coalesce(r->>'code', ''))                      as code,
         coalesce(nullif(btrim(coalesce(r->>'debit','')), ''), '0')  as debit_txt,
         coalesce(nullif(btrim(coalesce(r->>'credit','')), ''), '0') as credit_txt,
         nullif(btrim(coalesce(r->>'narration','')), '')      as narration,
         nullif(btrim(coalesce(r->>'reference','')), '')      as reference,
         nullif(btrim(coalesce(r->>'cost_center','')), '')    as cost_center,
         nullif(btrim(coalesce(r->>'tag_area','')), '')       as tag_area
    from jsonb_array_elements(p_rows) with ordinality t(r, ord);

  -- ── validation, all of it, before anything is written ──────────────────
  select array_agg(msg order by ln) into v_problems from (
    select ln, format('line %s: no entry_no', ln) as msg from _imp where entry_no = ''
    union all
    select ln, format('line %s: no date', ln) from _imp where date_txt is null
    union all
    select ln, format('line %s: date %L is not a date', ln, date_txt) from _imp
     where date_txt is not null and date_txt !~ '^\d{4}-\d{2}-\d{2}$'
    union all
    select ln, format('line %s: no account code', ln) from _imp where code = ''
    union all
    select ln, format('line %s: %L is not a real number', ln, debit_txt) from _imp
     where debit_txt !~ '^-?\d+(\.\d+)?$'
    union all
    select ln, format('line %s: %L is not a real number', ln, credit_txt) from _imp
     where credit_txt !~ '^-?\d+(\.\d+)?$'
  ) d;
  if coalesce(array_length(v_problems,1),0) > 0 then
    return jsonb_build_object('ok', false, 'stage', 'shape',
                              'problems', to_jsonb(v_problems));
  end if;

  -- now it is safe to cast
  alter table _imp add column dt date;
  alter table _imp add column dr numeric(18,2);
  alter table _imp add column cr numeric(18,2);
  alter table _imp add column acct uuid;
  update _imp set dt = date_txt::date,
                  dr = round(debit_txt::numeric, 2),
                  cr = round(credit_txt::numeric, 2);
  update _imp i set acct = a.id
    from accounts a
   where a.company_id = v_co and btrim(a.code) = i.code
     and not a.is_group and a.is_postable;

  select array_agg(msg order by ln) into v_problems from (
    select ln, format('line %s: account code %L is not a postable account in the chart', ln, code) as msg
      from _imp where acct is null
    union all
    select ln, format('line %s: debit and credit are both set (%s / %s)', ln, dr, cr)
      from _imp where dr <> 0 and cr <> 0
    union all
    select ln, format('line %s: both debit and credit are zero', ln)
      from _imp where dr = 0 and cr = 0
    union all
    select ln, format('line %s: negative amount (%s / %s) — use the other column instead', ln, dr, cr)
      from _imp where dr < 0 or cr < 0
    union all
    select ln, format('line %s: date %s is in the future', ln, dt)
      from _imp where dt > current_date
  ) d;
  if coalesce(array_length(v_problems,1),0) > 0 then
    return jsonb_build_object('ok', false, 'stage', 'lines',
                              'problems', to_jsonb(v_problems));
  end if;

  -- every entry must balance to the fils
  select array_agg(msg) into v_problems from (
    select format('entry %L on %s is out of balance by %s (Dr %s / Cr %s)',
                  entry_no, dt, round(sum(dr) - sum(cr), 2), sum(dr), sum(cr)) as msg
      from _imp group by entry_no, dt
     having round(sum(dr) - sum(cr), 2) <> 0
  ) d;
  if coalesce(array_length(v_problems,1),0) > 0 then
    return jsonb_build_object('ok', false, 'stage', 'balance',
                              'problems', to_jsonb(v_problems));
  end if;

  -- the cost centres in the file, so a car entry left in it is visible
  select string_agg(distinct cost_center, ', ' order by cost_center) into v_ccs
    from _imp where cost_center is not null;

  -- ── write, unless this is a dry run ────────────────────────────────────
  for g in
    select entry_no, dt, min(ln) as first_ln,
           sum(dr) as dr, sum(cr) as cr, count(*) as n,
           max(coalesce(narration, '')) as memo, max(coalesce(reference,'')) as ref
      from _imp group by entry_no, dt order by dt, min(ln)
  loop
    -- already imported? leave it alone rather than duplicate it
    if exists (select 1 from journal_entries
                where company_id = v_co and source = 'history_import'
                  and reference = g.entry_no and entry_date = g.dt) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_entries := v_entries + 1;
    v_lines   := v_lines + g.n;
    v_dr      := v_dr + g.dr;
    v_cr      := v_cr + g.cr;

    if p_dry_run then continue; end if;

    insert into journal_entries(company_id, entry_no, entry_date, memo, status,
                                source, reference, created_by)
    values (v_co, next_doc_number(v_co, 'journal'), g.dt,
            nullif(g.memo, ''), 'posted', 'history_import', g.entry_no, auth.uid())
    returning id into v_entry;

    insert into journal_lines(entry_id, account_id, description, debit, credit,
                              cost_center, tag_area)
    select v_entry, i.acct, i.narration, i.dr, i.cr, i.cost_center, i.tag_area
      from _imp i
     where i.entry_no = g.entry_no and i.dt = g.dt
     order by i.ln;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'dry_run', p_dry_run,
    'entries', v_entries,
    'lines', v_lines,
    'skipped_already_imported', v_skipped,
    'total_debit', v_dr,
    'total_credit', v_cr,
    'earliest', (select min(dt) from _imp),
    'latest', (select max(dt) from _imp),
    'accounts_touched', (select count(distinct acct) from _imp),
    'cost_centres_in_file', v_ccs,
    'problems', '[]'::jsonb);
end $function$;

-- Internal. authenticated is named explicitly because the default privileges
-- above granted it, so omitting it would leave this open to every staff user.
revoke all on function public.gl_history_import(jsonb, boolean)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Post-conditions. The importer is EXERCISED here, not just created — a loader
-- nobody has run is a loader nobody knows the behaviour of. Every test row
-- written is removed again before this transaction commits.
-- ---------------------------------------------------------------------------
do $chk$
declare
  v_co   uuid;
  v_code text;
  v_code2 text;
  r      jsonb;
  v_n    int;
  v_before int;
begin
  select id into v_co from companies order by created_at limit 1;
  select count(*) into v_before from journal_entries;

  select code into v_code  from accounts where company_id = v_co and not is_group and is_postable order by code limit 1;
  select code into v_code2 from accounts where company_id = v_co and not is_group and is_postable order by code desc limit 1;

  -- 1. an unknown account code is refused, and names the line
  r := gl_history_import(jsonb_build_array(
        jsonb_build_object('entry_no','T1','date','2024-01-01','code','NOPE-999','debit','10','credit','0'),
        jsonb_build_object('entry_no','T1','date','2024-01-01','code',v_code,'debit','0','credit','10')));
  if (r->>'ok')::boolean then raise exception '372: an unknown account code was accepted'; end if;
  if r->>'stage' <> 'lines' or r->'problems'->>0 !~ 'NOPE-999' then
    raise exception '372: the unknown code was not reported properly: %', r;
  end if;

  -- 2. an out-of-balance entry is refused
  r := gl_history_import(jsonb_build_array(
        jsonb_build_object('entry_no','T2','date','2024-01-01','code',v_code,'debit','10','credit','0'),
        jsonb_build_object('entry_no','T2','date','2024-01-01','code',v_code2,'debit','0','credit','7')));
  if (r->>'ok')::boolean then raise exception '372: an unbalanced entry was accepted'; end if;
  if r->>'stage' <> 'balance' then raise exception '372: imbalance not caught: %', r; end if;

  -- 3. a future date is refused
  r := gl_history_import(jsonb_build_array(
        jsonb_build_object('entry_no','T3','date', to_char(current_date + 1,'YYYY-MM-DD'),'code',v_code,'debit','5','credit','0'),
        jsonb_build_object('entry_no','T3','date', to_char(current_date + 1,'YYYY-MM-DD'),'code',v_code2,'debit','0','credit','5')));
  if (r->>'ok')::boolean then raise exception '372: a future-dated entry was accepted'; end if;

  -- 4. debit and credit on the same line is refused
  r := gl_history_import(jsonb_build_array(
        jsonb_build_object('entry_no','T4','date','2024-01-01','code',v_code,'debit','5','credit','5')));
  if (r->>'ok')::boolean then raise exception '372: a two-sided line was accepted'; end if;

  -- 5. a good pair DRY RUNS clean and writes nothing
  r := gl_history_import(jsonb_build_array(
        jsonb_build_object('entry_no','T5','date','2024-02-02','code',v_code,'debit','123.45','credit','0',
                           'narration','opening test','cost_center','CAR TRADING'),
        jsonb_build_object('entry_no','T5','date','2024-02-02','code',v_code2,'debit','0','credit','123.45')));
  if not (r->>'ok')::boolean then raise exception '372: a valid pair was refused: %', r; end if;
  if (r->>'entries')::int <> 1 or (r->>'lines')::int <> 2 then
    raise exception '372: dry run counted % entries / % lines', r->>'entries', r->>'lines';
  end if;
  if (r->>'total_debit')::numeric <> 123.45 then raise exception '372: dry run total wrong: %', r; end if;
  if r->>'cost_centres_in_file' <> 'CAR TRADING' then
    raise exception '372: the cost centre warning does not report what is in the file: %', r;
  end if;
  select count(*) into v_n from journal_entries;
  if v_n <> v_before then raise exception '372: a DRY RUN wrote % entr(ies)', v_n - v_before; end if;

  -- 6. the same payload for real writes one entry with two lines
  r := gl_history_import(jsonb_build_array(
        jsonb_build_object('entry_no','T5','date','2024-02-02','code',v_code,'debit','123.45','credit','0',
                           'narration','opening test','cost_center','CAR TRADING'),
        jsonb_build_object('entry_no','T5','date','2024-02-02','code',v_code2,'debit','0','credit','123.45')),
        false);
  if (r->>'entries')::int <> 1 then raise exception '372: the real run wrote % entries', r->>'entries'; end if;
  select count(*) into v_n from journal_entries
   where source = 'history_import' and reference = 'T5' and entry_date = '2024-02-02';
  if v_n <> 1 then raise exception '372: % imported entr(ies) found, expected 1', v_n; end if;
  select count(*) into v_n from journal_lines jl
    join journal_entries je on je.id = jl.entry_id
   where je.source = 'history_import' and je.reference = 'T5';
  if v_n <> 2 then raise exception '372: % imported line(s), expected 2', v_n; end if;

  -- 7. running it AGAIN skips it instead of duplicating
  r := gl_history_import(jsonb_build_array(
        jsonb_build_object('entry_no','T5','date','2024-02-02','code',v_code,'debit','123.45','credit','0'),
        jsonb_build_object('entry_no','T5','date','2024-02-02','code',v_code2,'debit','0','credit','123.45')),
        false);
  if (r->>'entries')::int <> 0 or (r->>'skipped_already_imported')::int <> 1 then
    raise exception '372: a re-run did not skip: %', r;
  end if;
  select count(*) into v_n from journal_entries
   where source = 'history_import' and reference = 'T5';
  if v_n <> 1 then raise exception '372: a re-run duplicated the entry (% now)', v_n; end if;

  -- 8. the ledger sees it as an opening balance for a later window
  if coalesce((acct_ledger(v_co,
        array[(select id from accounts where company_id = v_co and code = v_code)],
        '2024-03-01', '2024-03-31')->>'opening')::numeric, 0) <> 123.45 then
    raise exception '372: the imported entry does not reach acct_ledger as opening';
  end if;

  -- clean up: this migration leaves no imported rows behind
  delete from journal_lines where entry_id in (
    select id from journal_entries where source = 'history_import' and reference = 'T5');
  delete from journal_entries where source = 'history_import' and reference = 'T5';

  select count(*) into v_n from journal_entries;
  if v_n <> v_before then
    raise exception '372: % test entr(ies) left behind', v_n - v_before;
  end if;
  select count(*) into v_n from journal_entries where source = 'history_import';
  if v_n <> 0 then raise exception '372: % history rows left behind', v_n; end if;

  -- and it is not callable from a browser
  if has_function_privilege('anon', 'public.gl_history_import(jsonb,boolean)', 'execute') then
    raise exception '372: anon can call the importer';
  end if;
  if has_function_privilege('authenticated', 'public.gl_history_import(jsonb,boolean)', 'execute') then
    raise exception '372: authenticated can call the importer — it must stay internal';
  end if;

  raise notice '372 ok: importer refuses bad codes, imbalance, future dates and two-sided lines; dry-runs clean; writes once; skips a re-run; reaches acct_ledger';
end
$chk$;

commit;
