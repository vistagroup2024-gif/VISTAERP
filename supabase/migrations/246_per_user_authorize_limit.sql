-- 246_per_user_authorize_limit.sql
-- Per-user authorisation limit (#19): an authoriser may approve a pending voucher
-- only up to their limit; admins (super-admin) bypass all limits. NULL limit = no
-- cap (backward compatible with existing authorisers).
alter table profiles add column if not exists acct_authorize_limit numeric(18,2);

-- Enforce the limit inside voucher_approve.
create or replace function voucher_approve(p_pending uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pv pending_vouchers%rowtype; v_count int; v jsonb; v_lim numeric(18,2);
begin
  if not acct_can_authorize() then raise exception 'You are not allowed to authorise vouchers'; end if;
  select * into pv from pending_vouchers where id = p_pending and company_id = auth_company_id();
  if not found then raise exception 'Voucher not found'; end if;
  if pv.status <> 'pending' then raise exception 'Voucher is already %', pv.status; end if;
  if pv.created_by = auth.uid() and not is_admin() then
    raise exception 'You cannot authorise your own voucher (maker–checker)';
  end if;
  if not is_admin() then
    select acct_authorize_limit into v_lim from profiles where id = auth.uid();
    if v_lim is not null and pv.amount > v_lim then
      raise exception 'Amount % exceeds your authorisation limit of %', pv.amount, v_lim;
    end if;
  end if;

  insert into pending_voucher_approvals(pending_id, actor, action) values (p_pending, auth.uid(), 'approve')
    on conflict (pending_id, actor, action) do nothing;
  select count(*) into v_count from pending_voucher_approvals where pending_id = p_pending and action = 'approve';

  if v_count >= pv.approvals_needed then
    v := gl_post(pv.company_id, pv.entry_date, pv.narration, pv.doc_type, 'approved', pv.reference, pv.lines);
    update pending_vouchers set status = 'authorized', posted_entry_id = (v->>'entry_id')::uuid where id = p_pending;
    perform acct_log(pv.company_id, 'authorized', pv.doc_type, v->>'entry_no', jsonb_build_object('pending_id', p_pending));
    perform push_notification('staff', null, 'accounting', 'Voucher authorised & posted',
      pv.doc_type || ' ' || (v->>'entry_no') || ' posted', 'accounting', null);
    return jsonb_build_object('posted', true, 'entry_no', v->>'entry_no');
  end if;
  perform acct_log(pv.company_id, 'approval', pv.doc_type, p_pending::text, jsonb_build_object('count', v_count, 'needed', pv.approvals_needed));
  return jsonb_build_object('posted', false, 'remaining', pv.approvals_needed - v_count);
end $$;

-- Admin: list authorisers (admins + accounting.authorize) with their limits.
create or replace function acct_list_authorizers()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', p.id, 'name', coalesce(p.full_name, p.email), 'is_admin', ur.is_admin,
      'limit', p.acct_authorize_limit) order by coalesce(p.full_name, p.email)), '[]'::jsonb)
  from profiles p
  join (select user_id, bool_or(role = 'admin') as is_admin,
               bool_or(role in ('admin','accounting')) as staff
        from user_roles group by user_id) ur on ur.user_id = p.id
  where is_admin() and p.company_id = auth_company_id()
    and (ur.is_admin or coalesce((p.permissions->>'accounting.authorize')::boolean, false));
$$;

create or replace function acct_set_authorize_limit(p_user uuid, p_limit numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Only an admin can set authorisation limits'; end if;
  update profiles set acct_authorize_limit = p_limit where id = p_user and company_id = auth_company_id();
end $$;

grant execute on function acct_list_authorizers() to authenticated;
grant execute on function acct_set_authorize_limit(uuid, numeric) to authenticated;
