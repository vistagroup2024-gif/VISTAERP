-- Rollback of 376: the three routines as they were. The data corrections
-- (vehicle statuses, the prorated first-month charge) are not undone — they
-- are what the rule says and were wrong before.
begin;

create or replace function public.trial_balance(p_company uuid, p_from date, p_to date)
returns jsonb
language sql stable security definer
set search_path to 'public'
as $function$
  with agg as (
    select a.id, a.code, a.name, a.type as nature,
      coalesce(sum(l.debit - l.credit) filter (where p_from is null or e.entry_date < p_from),0) as opening_net,
      coalesce(sum(l.debit)  filter (where (p_from is null or e.entry_date >= p_from) and (p_to is null or e.entry_date <= p_to)),0) as period_debit,
      coalesce(sum(l.credit) filter (where (p_from is null or e.entry_date >= p_from) and (p_to is null or e.entry_date <= p_to)),0) as period_credit
    from accounts a
    left join journal_lines l on l.account_id = a.id
    left join journal_entries e on e.id = l.entry_id and e.company_id = p_company and e.status = 'posted'
    where a.company_id = p_company and a.is_postable
      and (staff_scope_ids('account') is null or a.id = any(staff_scope_ids('account')))
    group by a.id, a.code, a.name, a.type
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'code', code, 'name', name, 'nature', nature,
    'opening_debit',  case when opening_net > 0 then opening_net else 0 end,
    'opening_credit', case when opening_net < 0 then -opening_net else 0 end,
    'period_debit', period_debit, 'period_credit', period_credit,
    'closing_net', opening_net + period_debit - period_credit
  ) order by code), '[]'::jsonb)
  from agg
  where opening_net <> 0 or period_debit <> 0 or period_credit <> 0;
$function$;

create or replace function public.car_gen_charges_vehicle(p_vehicle uuid, p_asof date default current_date, p_contract uuid default null, p_customer uuid default null)
returns integer
language plpgsql security definer
set search_path to 'public'
as $function$
declare m date; v_end date; n int := 0; v car_vehicles%rowtype;
begin
  select * into v from car_vehicles
    where id = p_vehicle and ownership = 'vista' and purchase_date is not null;
  if not found then return 0; end if;
  v_end := date_trunc('month', p_asof)::date;
  m := date_trunc('month', v.purchase_date)::date;
  while m <= v_end loop
    insert into car_service_charges(company_id, vehicle_id, contract_id, customer_id, charge_month, due_date, amount)
    values (v.company_id, v.id, coalesce(p_contract, v.contract_id), coalesce(p_customer, v.current_customer_id),
            m, (m + interval '1 month')::date, coalesce(v.monthly_charge, 1000))
    on conflict (vehicle_id, charge_month) do nothing;
    if found then n := n + 1; end if;
    m := (m + interval '1 month')::date;
  end loop;
  return n;
end $function$;

create or replace function public.trade_doc_mark_delivered(p_id uuid, p_delivered boolean, p_date date default null)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $function$
declare d trade_documents; v_co uuid; v_date date;
begin
  if not is_staff() then raise exception 'Not signed in'; end if;
  v_co := auth_company_id();
  select * into d from trade_documents where id = p_id and company_id = v_co;
  if not found then raise exception 'Document not found'; end if;
  if d.doc_type <> 'delivery_note' then
    raise exception 'Only a Delivery Note records a delivery';
  end if;
  perform staff_require_trade_right(p_id, 'edit');
  if p_delivered then
    v_date := coalesce(p_date, d.delivered_date, current_date);
    if v_date > current_date then
      raise exception 'A delivery cannot be dated in the future';
    end if;
    if v_date < d.doc_date then
      raise exception 'The goods cannot have arrived before the note that sent them (%)', d.doc_date;
    end if;
    update trade_documents
       set delivered = true, delivered_date = v_date,
           delivered_by = auth.uid(), delivered_at = now(), updated_at = now()
     where id = p_id;
  else
    update trade_documents
       set delivered = false, delivered_date = null,
           delivered_by = null, delivered_at = null, updated_at = now()
     where id = p_id;
  end if;
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_co, auth.uid(),
          case when p_delivered then 'delivery_confirmed' else 'delivery_unconfirmed' end,
          'trade_document', p_id,
          jsonb_build_object('doc_no', d.doc_no, 'delivered_date', v_date,
                             'car_contract', d.source_car_contract));
  return jsonb_build_object('ok', true, 'delivered', p_delivered, 'delivered_date', v_date);
end $function$;

commit;
