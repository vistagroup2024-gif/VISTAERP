-- Phase 5: recurring vouchers (schedule + generate_recurring). Mirror of applied migration.
create table if not exists recurring_schedules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  doc_type text not null default 'gl_journal',
  cadence text not null default 'monthly',
  next_run date not null,
  narration text,
  reference text,
  lines jsonb not null,
  auto_authorize boolean not null default true,
  active boolean not null default true,
  last_run date,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table recurring_schedules enable row level security;
drop policy if exists recurring_staff on recurring_schedules;
create policy recurring_staff on recurring_schedules for all to authenticated
  using (company_id = auth_company_id() and is_staff()) with check (company_id = auth_company_id() and is_staff());

create or replace function generate_recurring(p_company uuid, p_as_of date default current_date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s recurring_schedules%rowtype; v jsonb; n int := 0; res jsonb := '[]'::jsonb;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  for s in select * from recurring_schedules where company_id = p_company and active and next_run <= p_as_of order by next_run loop
    begin
      if s.auto_authorize then v := gl_post(p_company, s.next_run, s.narration, s.doc_type, 'recurring', s.reference, s.lines);
      else v := gl_submit(p_company, s.next_run, s.narration, s.doc_type, s.reference, s.lines); end if;
      res := res || jsonb_build_array(jsonb_build_object('name', s.name, 'result', v)); n := n + 1;
    exception when others then res := res || jsonb_build_array(jsonb_build_object('name', s.name, 'error', sqlerrm)); end;
    update recurring_schedules set last_run = s.next_run,
      next_run = case when s.cadence = 'weekly' then s.next_run + 7 else (s.next_run + interval '1 month')::date end where id = s.id;
  end loop;
  perform acct_log(p_company, 'recurring_run', 'gl_journal', to_char(p_as_of,'YYYY-MM-DD'), jsonb_build_object('generated', n));
  return jsonb_build_object('generated', n, 'details', res);
end $$;
grant execute on function generate_recurring(uuid,date) to authenticated;
